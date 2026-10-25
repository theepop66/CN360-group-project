"""Report line latency from the control unit: sensor detection -> verdict.

The ESP32 keeps its last 32 finished items on GET /cycles (item_id,
latency_ms, outcome). This script polls that while items run down the line and
reports p50 / p95 / max with sample counts, as issue #24 asks.

    python tools/line_latency.py --esp32 http://192.168.1.50 --items 50 --output latency.json

What is measured: from the debounced IR detection on the ESP32 to the moment
it accepts a verdict, so it includes the notify to n8n, frame capture, model,
decision and the verdict POST. Servo travel (rejectOutMs) comes after this and
is fixed. Items that hit the Verdict Window are counted as timeouts; their
latency is the window, not a real verdict time, so they are kept out of the
percentiles and reported on their own.

Standard library only. Does not send any command to the ESP32.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Collector:
    """Merges repeated /cycles snapshots into one list of distinct items."""

    window_ms: int | None = None
    rows: dict[tuple[int, int], dict[str, Any]] = field(default_factory=dict)
    ignored: set[tuple[int, int]] = field(default_factory=set)
    session: int = 0
    last_recorded: int = -1
    missed: int = 0

    def add(self, snapshot: dict[str, Any], *, baseline: bool = False) -> int:
        """Merge one snapshot; returns how many new items it contained.

        A baseline snapshot only marks what was already on the board, so those
        items are never counted in this run.
        """
        recorded = int(snapshot.get("recorded", 0))
        cycles = snapshot.get("cycles") or []
        if self.window_ms is None and snapshot.get("verdict_window_ms") is not None:
            self.window_ms = int(snapshot["verdict_window_ms"])
        if recorded < self.last_recorded:
            self.session += 1  # the board restarted; item ids start again
            self.last_recorded = -1
        if self.last_recorded >= 0:
            # The board only keeps its newest items; anything finished between
            # polls beyond that is lost, and is reported rather than hidden.
            self.missed += max(0, (recorded - self.last_recorded) - len(cycles))
        before = len(self.rows)
        for row in cycles:
            key = (self.session, int(row["item_id"]))
            if baseline:
                self.ignored.add(key)
            elif key not in self.ignored:
                self.rows.setdefault(key, row)
        self.last_recorded = recorded
        return len(self.rows) - before


def percentile(ordered: list[float], fraction: float) -> float | None:
    """Linear-interpolated percentile, matching model-service/scripts/benchmark.py."""
    if not ordered:
        return None
    position = (len(ordered) - 1) * fraction
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def summarise(collector: Collector, deadline_ms: float | None) -> dict[str, Any]:
    rows = list(collector.rows.values())
    verdicts = sorted(float(r["latency_ms"]) for r in rows if r["outcome"] != "timeout")
    outcomes = {name: sum(1 for r in rows if r["outcome"] == name) for name in ("pass", "reject", "timeout")}
    deadline = deadline_ms if deadline_ms is not None else collector.window_ms
    within = sum(1 for value in verdicts if deadline is not None and value <= deadline)
    return {
        "items": len(rows),
        "outcomes": outcomes,
        "missed_between_polls": collector.missed,
        "verdict_latency_ms": {
            "samples": len(verdicts),
            "p50": percentile(verdicts, 0.5),
            "p95": percentile(verdicts, 0.95),
            "max": verdicts[-1] if verdicts else None,
            "min": verdicts[0] if verdicts else None,
        },
        "deadline_ms": deadline,
        "within_deadline": within,
        "within_deadline_rate": within / len(rows) if rows and deadline is not None else None,
        "verdict_window_ms": collector.window_ms,
        "note": "detection -> verdict accepted on the ESP32; timeouts excluded from percentiles and counted as misses of the deadline",
        "cycles": rows,
    }


def fetch_json(url: str, timeout: float) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        data: dict[str, Any] = json.loads(response.read().decode("utf-8"))
        return data


def collect(
    fetch: Callable[[], dict[str, Any]],
    *,
    items: int | None,
    duration: float | None,
    interval: float,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    log: Callable[[str], None] = print,
) -> Collector:
    collector = Collector()
    started = clock()
    errors = 0
    # The first snapshot is the baseline: items already on the board before the
    # run started are not part of this measurement.
    collector.add(fetch(), baseline=True)
    while True:
        sleep(interval)
        try:
            new = collector.add(fetch())
            errors = 0
        except (urllib.error.URLError, OSError, ValueError) as exc:
            errors += 1
            log(f"poll failed ({errors}): {exc}")
            if errors >= 10:
                log("giving up after 10 failed polls in a row")
                break
            continue
        if new:
            log(f"{len(collector.rows)} items so far")
        if items is not None and len(collector.rows) >= items:
            break
        if duration is not None and clock() - started >= duration:
            break
    return collector


def report_text(summary: dict[str, Any]) -> str:
    lat = summary["verdict_latency_ms"]

    def ms(value: float | None) -> str:
        return "n/a" if value is None else f"{value:.0f} ms"

    rate = summary["within_deadline_rate"]
    lines = [
        f"items: {summary['items']} (pass {summary['outcomes']['pass']}, reject {summary['outcomes']['reject']}, "
        f"timeout {summary['outcomes']['timeout']}); missed between polls: {summary['missed_between_polls']}",
        f"detection -> verdict over {lat['samples']} verdicts: p50 {ms(lat['p50'])}, p95 {ms(lat['p95'])}, max {ms(lat['max'])}",
        f"within {ms(summary['deadline_ms'])}: {summary['within_deadline']}/{summary['items']}"
        + (f" ({rate * 100:.1f}%)" if rate is not None else ""),
    ]
    if summary["missed_between_polls"]:
        lines.append("warning: some items finished between polls and were not seen; poll faster")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--esp32", required=True, help="control unit base URL, e.g. http://192.168.1.50")
    stop = parser.add_mutually_exclusive_group(required=True)
    stop.add_argument("--items", type=int, help="stop after this many new items")
    stop.add_argument("--duration", type=float, help="stop after this many seconds")
    parser.add_argument("--interval", type=float, default=1.0, help="seconds between polls (default 1)")
    parser.add_argument("--deadline-ms", type=float, help="deadline to score against (default: the board's Verdict Window)")
    parser.add_argument("--output", help="write the full JSON report here")
    args = parser.parse_args(argv)
    if (args.items is not None and args.items < 1) or (args.duration is not None and args.duration <= 0) or args.interval <= 0:
        parser.error("items, duration and interval must be positive")

    url = args.esp32.rstrip("/") + "/cycles"
    try:
        collector = collect(lambda: fetch_json(url, timeout=3), items=args.items, duration=args.duration, interval=args.interval)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print(f"cannot read {url}: {exc}", file=sys.stderr)
        return 2
    summary = summarise(collector, args.deadline_ms)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2)
    print(report_text(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
