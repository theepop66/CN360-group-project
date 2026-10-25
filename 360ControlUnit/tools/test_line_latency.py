"""Run with: python -m unittest tools/test_line_latency.py  (or pytest)."""

import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from line_latency import Collector, collect, main, percentile, summarise  # noqa: E402


def snapshot(recorded, rows, window=3000):
    return {"verdict_window_ms": window, "recorded": recorded, "cycles": rows}


def row(item, latency, outcome="pass"):
    return {"item_id": item, "latency_ms": latency, "outcome": outcome}


class SummaryTests(unittest.TestCase):
    def test_percentiles_match_the_benchmark_rule(self):
        self.assertEqual(percentile([100.0, 200.0, 300.0], 0.5), 200.0)
        self.assertAlmostEqual(percentile([100.0, 200.0, 300.0], 0.95), 290.0)
        self.assertIsNone(percentile([], 0.5))

    def test_repeated_snapshots_count_each_item_once(self):
        c = Collector()
        self.assertEqual(c.add(snapshot(2, [row(1, 900), row(2, 1100)])), 2)
        self.assertEqual(c.add(snapshot(3, [row(1, 900), row(2, 1100), row(3, 1200, "reject")])), 1)
        self.assertEqual(c.add(snapshot(3, [row(1, 900), row(2, 1100), row(3, 1200, "reject")])), 0)
        self.assertEqual(len(c.rows), 3)
        self.assertEqual(c.missed, 0)

    def test_items_lost_between_polls_are_reported(self):
        c = Collector()
        c.add(snapshot(32, [row(i, 1000) for i in range(1, 33)]))
        # 40 more finished; the board only shows its newest 32.
        c.add(snapshot(72, [row(i, 1000) for i in range(41, 73)]))
        self.assertEqual(c.missed, 8)

    def test_board_restart_starts_a_new_session(self):
        c = Collector()
        c.add(snapshot(5, [row(i, 1000) for i in range(1, 6)]))
        c.add(snapshot(2, [row(1, 800), row(2, 850)]))  # ids reused after reboot
        self.assertEqual(len(c.rows), 7)

    def test_timeouts_are_kept_out_of_percentiles_and_miss_the_deadline(self):
        c = Collector()
        c.add(snapshot(4, [row(1, 1000), row(2, 1200, "reject"), row(3, 3000, "timeout"), row(4, 1400)]))
        s = summarise(c, None)
        self.assertEqual(s["outcomes"], {"pass": 2, "reject": 1, "timeout": 1})
        self.assertEqual(s["verdict_latency_ms"]["samples"], 3)
        self.assertEqual(s["verdict_latency_ms"]["p50"], 1200.0)
        self.assertEqual(s["verdict_latency_ms"]["max"], 1400.0)
        self.assertEqual(s["deadline_ms"], 3000, "defaults to the board's Verdict Window")
        self.assertEqual(s["within_deadline"], 3)
        self.assertAlmostEqual(s["within_deadline_rate"], 0.75)

    def test_explicit_deadline(self):
        c = Collector()
        c.add(snapshot(3, [row(1, 900), row(2, 1150), row(3, 1300)]))
        s = summarise(c, 1100)
        self.assertEqual(s["within_deadline"], 1)


class CollectTests(unittest.TestCase):
    def test_items_already_on_the_board_are_not_counted(self):
        snaps = iter([
            snapshot(10, [row(i, 500) for i in range(1, 11)]),  # baseline
            snapshot(11, [row(i, 500) for i in range(1, 12)]),
            snapshot(12, [row(i, 500) for i in range(1, 13)]),
        ])
        c = collect(lambda: next(snaps), items=2, duration=None, interval=0, sleep=lambda _: None, log=lambda _: None)
        self.assertEqual(sorted(k[1] for k in c.rows), [11, 12])

    def test_stops_after_repeated_poll_failures(self):
        calls = {"n": 0}

        def fetch():
            calls["n"] += 1
            if calls["n"] == 1:
                return snapshot(0, [])
            raise OSError("unreachable")

        c = collect(fetch, items=5, duration=None, interval=0, sleep=lambda _: None, log=lambda _: None)
        self.assertEqual(len(c.rows), 0)
        self.assertEqual(calls["n"], 11)


class FakeBoard(BaseHTTPRequestHandler):
    snapshots = []

    def do_GET(self):  # noqa: N802
        body = json.dumps(self.snapshots.pop(0) if len(self.snapshots) > 1 else self.snapshots[0]).encode()
        self.send_response(200 if self.path == "/cycles" else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class EndToEndTests(unittest.TestCase):
    def test_cli_against_a_fake_board_over_http(self):
        FakeBoard.snapshots = [
            snapshot(0, []),
            snapshot(2, [row(1, 1050), row(2, 1250, "reject")]),
            snapshot(3, [row(1, 1050), row(2, 1250, "reject"), row(3, 3000, "timeout")]),
        ]
        server = HTTPServer(("127.0.0.1", 0), FakeBoard)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "latency.json"
                code = main(["--esp32", f"http://127.0.0.1:{server.server_port}", "--items", "3",
                             "--interval", "0.01", "--output", str(out)])
                self.assertEqual(code, 0)
                report = json.loads(out.read_text())
        finally:
            server.shutdown()
        self.assertEqual(report["items"], 3)
        self.assertEqual(report["outcomes"]["timeout"], 1)
        self.assertEqual(report["verdict_latency_ms"]["max"], 1250.0)


if __name__ == "__main__":
    unittest.main()
