from __future__ import annotations

import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

import pytest

from pi_stream.camera import CameraService
from pi_stream.config import Settings
from pi_stream.push import (
    FramePusher,
    PushTransportError,
    build_multipart_body,
    http_post_status,
)

from .fakes import FakeCapture, FakeCV2, FakeFrame


class _RecordingHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        server = self.server
        with server.records_lock:
            failing = server.failures_remaining > 0
            if failing:
                server.failures_remaining -= 1
        status = 500 if failing else 200
        with server.records_lock:
            server.records.append(
                {
                    "path": self.path,
                    "content_type": self.headers.get("Content-Type") or "",
                    "body": self.rfile.read(length),
                    "status": status,
                }
            )
        self.send_response(status)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format: str, *args: object) -> None:
        del format, args


@pytest.fixture()
def fake_n8n() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingHandler)
    server.records = []
    server.records_lock = threading.Lock()
    server.failures_remaining = 0
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


def webhook_url(server: ThreadingHTTPServer) -> str:
    host, port = server.server_address[:2]
    return f"http://{host}:{port}/webhook/image-ingestion"


def push_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "camera_width": 640,
        "camera_height": 480,
        "camera_fps": 120,
        "stream_width": 320,
        "camera_retry_seconds": 0.01,
        "frame_stale_seconds": 1,
        "initial_frame_wait_seconds": 0.5,
        "capture_wait_seconds": 0.5,
        "push_interval_seconds": 0.05,
        "push_timeout_seconds": 2,
        "push_retry_seconds": 0.05,
        "push_max_attempts": 3,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def parse_multipart(
    body: bytes, content_type: str
) -> tuple[dict[str, str], bytes]:
    boundary = content_type.split("boundary=", 1)[1].strip()
    parts = body.split(f"--{boundary}".encode("ascii"))
    fields: dict[str, str] = {}
    image = b""
    for part in parts[1:-1]:
        part = part.strip(b"\r\n")
        header_blob, _, content = part.partition(b"\r\n\r\n")
        name = re.search(r'name="([^"]+)"', header_blob.decode("ascii")).group(1)
        if name == "image":
            image = content
        else:
            fields[name] = content.decode("utf-8")
    return fields, image


def test_push_requires_a_configured_webhook_url() -> None:
    settings = push_settings()
    camera = CameraService(settings, opencv_module=FakeCV2([]))

    with pytest.raises(ValueError, match="N8N_WEBHOOK_URL"):
        FramePusher(settings, camera)


def test_build_multipart_body_contains_fields_and_file() -> None:
    body = build_multipart_body(
        {"image_id": "abc-1", "timestamp": "2026-09-13T10:00:00.000Z"},
        file_name="capture.jpg",
        file_bytes=b"\xff\xd8x\xff\xd9",
        boundary="bound123",
    )

    fields, image = parse_multipart(
        body, "multipart/form-data; boundary=bound123"
    )

    assert fields == {
        "image_id": "abc-1",
        "timestamp": "2026-09-13T10:00:00.000Z",
    }
    assert image == b"\xff\xd8x\xff\xd9"
    assert body.endswith(b"--bound123--\r\n")


def test_http_post_status_reports_status_and_transport_errors(fake_n8n) -> None:
    fake_n8n.failures_remaining = 1
    url = webhook_url(fake_n8n)

    with pytest.raises(PushTransportError):
        http_post_status(
            "http://127.0.0.1:1/webhook",
            b"",
            content_type="application/octet-stream",
            timeout=1,
        )

    assert (
        http_post_status(url, b"", content_type="application/octet-stream", timeout=2)
        == 500
    )
    assert (
        http_post_status(url, b"", content_type="application/octet-stream", timeout=2)
        == 200
    )


def test_interval_push_sends_traceable_multipart_captures(fake_n8n) -> None:
    capture = FakeCapture([FakeFrame(640, 480, "push")], repeat_last=True)
    cv2 = FakeCV2([capture])
    settings = push_settings(n8n_webhook_url=webhook_url(fake_n8n))
    camera = CameraService(settings, opencv_module=cv2)
    pusher = FramePusher(settings, camera)

    camera.start()
    pusher.start()
    try:
        assert wait_for(lambda: len(fake_n8n.records) >= 2)
        with fake_n8n.records_lock:
            records = list(fake_n8n.records[:2])

        assert records[0]["path"] == "/webhook/image-ingestion"
        assert records[0]["content_type"].startswith(
            "multipart/form-data; boundary="
        )
        (fields_first, image), (fields_second, _) = [
            parse_multipart(record["body"], record["content_type"])
            for record in records
        ]
        assert fields_first["session_id"] == camera.session_id
        assert fields_first["image_id"] == (
            f"{camera.session_id}-{fields_first['frame_sequence']}"
        )
        assert fields_second["image_id"] == (
            f"{camera.session_id}-{fields_second['frame_sequence']}"
        )
        assert int(fields_second["frame_sequence"]) > int(
            fields_first["frame_sequence"]
        )
        assert fields_first["image_id"] != fields_second["image_id"]
        assert fields_first["trigger"] == "interval"
        assert fields_first["width"] == "640"
        assert fields_first["height"] == "480"
        assert re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z",
            fields_first["timestamp"],
        )
        assert image == b"\xff\xd8push\xff\xd9"
        assert 95 in cv2.encode_qualities
        assert (480, 640, 3) in cv2.encoded_shapes

        status = pusher.status()
        assert status["totalPushed"] >= 1
        assert status["lastStatus"] == 200
        assert status["lastLatencyMs"] is not None
        assert status["lastLatencyMs"] >= 0
        assert status["lastPushAt"] is not None
        assert status["lastError"] is None
    finally:
        pusher.stop()
        camera.stop()


def test_push_retries_the_same_frame_and_recovers(fake_n8n) -> None:
    fake_n8n.failures_remaining = 2
    capture = FakeCapture([FakeFrame(640, 480, "retry")], repeat_last=True)
    settings = push_settings(n8n_webhook_url=webhook_url(fake_n8n))
    camera = CameraService(settings, opencv_module=FakeCV2([capture]))
    pusher = FramePusher(settings, camera)

    camera.start()
    pusher.start()
    try:
        assert wait_for(lambda: pusher.status()["totalPushed"] >= 1)
        with fake_n8n.records_lock:
            records = list(fake_n8n.records[:3])

        assert [record["status"] for record in records] == [500, 500, 200]
        image_ids = [
            parse_multipart(record["body"], record["content_type"])[0]["image_id"]
            for record in records
        ]
        assert image_ids[0] == image_ids[1] == image_ids[2]
        assert pusher.status()["consecutiveFailures"] == 0
    finally:
        pusher.stop()
        camera.stop()


def test_push_recovers_after_the_webhook_is_unreachable() -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    url = f"http://127.0.0.1:{port}/webhook/image-ingestion"
    capture = FakeCapture([FakeFrame(640, 480, "outage")], repeat_last=True)
    settings = push_settings(
        n8n_webhook_url=url,
        push_max_attempts=2,
        push_retry_seconds=0.05,
    )
    camera = CameraService(settings, opencv_module=FakeCV2([capture]))
    pusher = FramePusher(settings, camera)

    camera.start()
    pusher.start()
    try:
        assert wait_for(lambda: pusher.status()["totalDropped"] >= 1)
        assert pusher.is_started

        server = ThreadingHTTPServer(("127.0.0.1", port), _RecordingHandler)
        server.records = []
        server.records_lock = threading.Lock()
        server.failures_remaining = 0
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            assert wait_for(lambda: pusher.status()["totalPushed"] >= 1)
        finally:
            server.shutdown()
            server.server_close()
    finally:
        pusher.stop()
        camera.stop()


def test_push_survives_a_camera_outage_and_resumes(fake_n8n) -> None:
    first = FakeCapture([FakeFrame(640, 480, "before"), None])
    recovered = FakeCapture([FakeFrame(640, 480, "after")], repeat_last=True)
    settings = push_settings(
        n8n_webhook_url=webhook_url(fake_n8n),
        push_interval_seconds=0.02,
    )
    camera = CameraService(settings, opencv_module=FakeCV2([first, recovered]))
    pusher = FramePusher(settings, camera)

    camera.start()
    pusher.start()
    try:
        assert wait_for(lambda: len(fake_n8n.records) >= 1)

        def recovered_push_seen() -> bool:
            with fake_n8n.records_lock:
                return any(b"after" in record["body"] for record in fake_n8n.records)

        assert wait_for(recovered_push_seen)
        assert pusher.is_started
        assert pusher.status()["totalPushed"] >= 1
    finally:
        pusher.stop()
        camera.stop()


class _StalledCapture:
    """Delivers one frame, then blocks in read() until released."""

    def __init__(self, frame: FakeFrame) -> None:
        self._frame = frame
        self._delivered = False
        self._lock = threading.Lock()
        self._release_event = threading.Event()

    def isOpened(self) -> bool:
        return True

    def set(self, property_id: int, value: float) -> bool:
        return True

    def read(self) -> tuple[bool, FakeFrame | None]:
        with self._lock:
            if not self._delivered:
                self._delivered = True
                return True, self._frame
        self._release_event.wait()
        return False, None

    def release(self) -> None:
        self._release_event.set()


def test_pusher_does_not_resend_an_already_sent_frame(fake_n8n) -> None:
    capture = _StalledCapture(FakeFrame(640, 480, "once"))
    settings = push_settings(n8n_webhook_url=webhook_url(fake_n8n))
    camera = CameraService(settings, opencv_module=FakeCV2([capture]))
    pusher = FramePusher(settings, camera)

    camera.start()
    pusher.start()
    try:
        assert wait_for(lambda: pusher.status()["totalPushed"] >= 1)
        time.sleep(0.2)
        with fake_n8n.records_lock:
            record_count = len(fake_n8n.records)

        assert record_count == 1
        assert pusher.status()["totalPushed"] == 1
        assert pusher.is_started
    finally:
        pusher.stop()
        capture.release()
        camera.stop()


def test_request_push_sends_immediately_without_an_interval(fake_n8n) -> None:
    capture = FakeCapture([FakeFrame(640, 480, "trigger")], repeat_last=True)
    settings = push_settings(
        n8n_webhook_url=webhook_url(fake_n8n),
        push_interval_seconds=0,
    )
    camera = CameraService(settings, opencv_module=FakeCV2([capture]))
    pusher = FramePusher(settings, camera)

    camera.start()
    pusher.start()
    try:
        time.sleep(0.1)
        with fake_n8n.records_lock:
            assert fake_n8n.records == []

        pusher.request_push()
        assert wait_for(lambda: len(fake_n8n.records) >= 1)
        with fake_n8n.records_lock:
            record = fake_n8n.records[0]
        fields, _ = parse_multipart(record["body"], record["content_type"])
        assert fields["trigger"] == "manual"
    finally:
        pusher.stop()
        camera.stop()
