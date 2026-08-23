from __future__ import annotations

from datetime import datetime, timezone

from pi_stream.app import create_app
from pi_stream.camera import FrameEncodingError, FrameSnapshot
from pi_stream.config import Settings

from .fakes import FakeFrame, StubCamera


STREAM_JPEG = b"\xff\xd8stream\xff\xd9"
CAPTURE_JPEG = b"\xff\xd8capture\xff\xd9"


def make_client(*, camera_source: int | str = 0):
    settings = Settings(
        camera_source=camera_source,
        initial_frame_wait_seconds=0.01,
        capture_wait_seconds=0.01,
    )
    snapshot = FrameSnapshot(
        session_id="session-a",
        sequence=7,
        captured_at="2026-08-23T12:00:00.000Z",
        captured_monotonic=1.0,
        width=1920,
        height=1080,
        raw_frame=FakeFrame(marker="raw"),
        stream_jpeg=STREAM_JPEG,
    )
    camera = StubCamera(snapshot, CAPTURE_JPEG)
    app = create_app(settings, camera)  # type: ignore[arg-type]
    app.config.update(TESTING=True)
    return app.test_client(), camera


def test_capture_returns_high_resolution_jpeg_and_metadata() -> None:
    client, _camera = make_client()

    response = client.get("/capture")

    assert response.status_code == 200
    assert response.content_type == "image/jpeg"
    assert response.data == CAPTURE_JPEG
    assert response.headers["X-Frame-Sequence"] == "7"
    assert response.headers["X-Camera-Session"] == "session-a"
    assert response.headers["X-Captured-At"] == "2026-08-23T12:00:00.000Z"
    assert response.headers["X-Frame-Width"] == "1920"
    assert response.headers["X-Frame-Height"] == "1080"
    assert response.headers["Cache-Control"].startswith("no-store")


def test_capture_returns_503_when_no_fresh_frame_exists() -> None:
    client, camera = make_client()
    camera.available = False

    response = client.get("/capture")

    assert response.status_code == 503
    assert response.json == {
        "status": "error",
        "error": "no fresh camera frame is available",
    }


def test_capture_returns_500_when_jpeg_encoding_fails() -> None:
    client, camera = make_client()
    camera.capture_encoding_error = FrameEncodingError("encoder failed")

    response = client.get("/capture")

    assert response.status_code == 500
    assert response.json["error"] == "could not encode capture: encoder failed"


def test_stream_uses_exact_mjpeg_boundary_and_does_not_stop_shared_camera() -> None:
    client, camera = make_client()

    response = client.get("/stream.mjpg", buffered=False)
    first_chunk = next(response.response)
    response.close()

    assert response.status_code == 200
    assert response.content_type == "multipart/x-mixed-replace; boundary=frame"
    expected_prefix = (
        "--frame\r\n"
        "Content-Type: image/jpeg\r\n"
        f"Content-Length: {len(STREAM_JPEG)}\r\n"
    ).encode("ascii")
    expected_chunk = (
        expected_prefix
        + b"X-Camera-Session: session-a\r\n"
        + b"X-Frame-Sequence: 7\r\n\r\n"
        + STREAM_JPEG
        + b"\r\n"
    )
    assert first_chunk == expected_chunk
    assert response.headers["X-Accel-Buffering"] == "no"
    assert response.headers.get("Content-Length") is None
    assert response.headers["Cache-Control"].startswith("no-store")
    assert camera.stop_calls == 0


def test_stream_returns_503_before_a_first_frame_exists() -> None:
    client, camera = make_client()
    camera.available = False

    response = client.get("/stream.mjpg")

    assert response.status_code == 503
    assert response.json["error"] == "camera stream is not ready"


def test_existing_stream_resumes_after_a_temporary_camera_outage() -> None:
    client, camera = make_client()
    first = camera.snapshot
    recovered = FrameSnapshot(
        session_id="session-a",
        sequence=8,
        captured_at="2026-08-23T12:00:01.000Z",
        captured_monotonic=2.0,
        width=1920,
        height=1080,
        raw_frame=FakeFrame(marker="recovered"),
        stream_jpeg=b"\xff\xd8recovered\xff\xd9",
    )
    original_wait = camera.wait_for_frame
    follow_up_frames = iter([None, recovered])

    def wait_with_outage(**kwargs):
        if kwargs.get("after_sequence") is None:
            return original_wait(**kwargs)
        return next(follow_up_frames)

    camera.wait_for_frame = wait_with_outage
    response = client.get("/stream.mjpg", buffered=False)

    first_chunk = next(response.response)
    recovered_chunk = next(response.response)
    response.close()

    assert b"X-Frame-Sequence: 7" in first_chunk
    assert b"X-Frame-Sequence: 8" in recovered_chunk
    assert recovered.stream_jpeg in recovered_chunk


def test_two_stream_clients_are_independent_and_share_the_same_camera() -> None:
    first_client, camera = make_client()
    second_client = first_client.application.test_client()

    first_response = first_client.get("/stream.mjpg", buffered=False)
    second_response = second_client.get("/stream.mjpg", buffered=False)
    first_chunk = next(first_response.response)
    second_chunk = next(second_response.response)

    first_response.close()
    assert b"X-Frame-Sequence: 7" in second_chunk
    assert first_chunk == second_chunk
    assert camera.stop_calls == 0
    second_response.close()


def test_health_reflects_camera_availability() -> None:
    client, camera = make_client()

    healthy = client.get("/health")
    camera.available = False
    unavailable = client.get("/health")

    assert healthy.status_code == 200
    assert healthy.json["status"] == "ok"
    assert healthy.headers["Cache-Control"].startswith("no-store")
    assert healthy.headers["Access-Control-Allow-Origin"] == "*"
    assert unavailable.status_code == 503
    assert unavailable.json["status"] == "unavailable"
    assert unavailable.headers["Cache-Control"].startswith("no-store")


def test_info_redacts_camera_credentials_and_lists_contract_endpoints() -> None:
    client, _camera = make_client(
        camera_source="rtsp://user:secret@camera.local/live?token=hidden"
    )

    response = client.get("/info")

    assert response.status_code == 200
    assert response.json["camera"]["source"] == "rtsp://camera.local/live"
    assert response.json["camera"]["sessionId"] == "session-a"
    assert response.json["mjpegBoundary"] == "frame"
    assert "/stream.mjpg" in response.json["endpoints"]


def test_cors_origin_can_be_restricted_to_the_hud() -> None:
    settings = Settings(cors_allowed_origin="https://hud.example.test")
    snapshot = FrameSnapshot(
        session_id="session-a",
        sequence=1,
        captured_at="2026-08-23T12:00:00.000Z",
        captured_monotonic=1.0,
        width=1920,
        height=1080,
        raw_frame=FakeFrame(marker="raw"),
        stream_jpeg=STREAM_JPEG,
    )
    camera = StubCamera(snapshot, CAPTURE_JPEG)
    app = create_app(settings, camera)  # type: ignore[arg-type]
    app.config.update(TESTING=True)

    response = app.test_client().get("/health")

    assert response.headers["Access-Control-Allow-Origin"] == "https://hud.example.test"
