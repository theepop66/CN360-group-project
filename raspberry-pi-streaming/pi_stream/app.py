from __future__ import annotations

from typing import Iterator

from flask import Flask, Response, jsonify

from . import __version__
from .camera import CameraService, FrameEncodingError, FrameSnapshot
from .config import Settings


MJPEG_BOUNDARY = "frame"


def _no_cache(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


def _error(message: str, status_code: int) -> tuple[Response, int]:
    response = jsonify({"status": "error", "error": message})
    return _no_cache(response), status_code


def _mjpeg_chunk(snapshot: FrameSnapshot) -> bytes:
    jpeg = snapshot.stream_jpeg
    return (
        f"--{MJPEG_BOUNDARY}\r\n"
        "Content-Type: image/jpeg\r\n"
        f"Content-Length: {len(jpeg)}\r\n"
        f"X-Camera-Session: {snapshot.session_id}\r\n"
        f"X-Frame-Sequence: {snapshot.sequence}\r\n"
        "\r\n"
    ).encode("ascii") + jpeg + b"\r\n"


def create_app(settings: Settings, camera: CameraService) -> Flask:
    app = Flask(__name__)
    app.extensions["camera_service"] = camera
    app.config["CAMERA_SETTINGS"] = settings

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        response.headers["Access-Control-Allow-Origin"] = settings.cors_allowed_origin
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Vary"] = "Origin"
        return response

    @app.get("/")
    def index() -> Response:
        return jsonify(
            {
                "service": "cn360-raspberry-pi-streaming",
                "version": __version__,
                "endpoints": {
                    "stream": "/stream.mjpg",
                    "capture": "/capture",
                    "health": "/health",
                    "info": "/info",
                },
            }
        )

    @app.get("/health")
    def health() -> tuple[Response, int]:
        report = camera.health_report()
        status_code = 200 if report["healthy"] else 503
        response = jsonify(
            {
                "status": "ok" if report["healthy"] else "unavailable",
                "camera": report,
            }
        )
        return _no_cache(response), status_code

    @app.get("/info")
    def info() -> Response:
        report = camera.health_report()
        response = jsonify(
            {
                "service": "cn360-raspberry-pi-streaming",
                "version": __version__,
                "camera": {
                    "source": settings.public_camera_source(),
                    "sessionId": report["sessionId"],
                    "requestedWidth": settings.camera_width,
                    "requestedHeight": settings.camera_height,
                    "requestedFps": settings.camera_fps,
                    "openTimeoutSeconds": settings.camera_open_timeout_seconds,
                    "readTimeoutSeconds": settings.camera_read_timeout_seconds,
                    "actualWidth": report["width"],
                    "actualHeight": report["height"],
                    "streamWidth": settings.stream_width,
                    "streamJpegQuality": settings.stream_jpeg_quality,
                    "captureJpegQuality": settings.capture_jpeg_quality,
                },
                "mjpegBoundary": MJPEG_BOUNDARY,
                "endpoints": ["/stream.mjpg", "/capture", "/health", "/info"],
            }
        )
        return _no_cache(response)

    @app.get("/capture")
    def capture() -> Response | tuple[Response, int]:
        snapshot = camera.wait_for_frame(
            timeout=settings.capture_wait_seconds,
            max_age=settings.frame_stale_seconds,
        )
        if snapshot is None:
            return _error("no fresh camera frame is available", 503)

        try:
            jpeg = camera.encode_capture(snapshot)
        except FrameEncodingError as error:
            return _error(f"could not encode capture: {error}", 500)

        filename_timestamp = (
            snapshot.captured_at.replace("-", "").replace(":", "").replace(".", "")
        )
        response = Response(jpeg, mimetype="image/jpeg")
        response.headers["Content-Length"] = str(len(jpeg))
        response.headers["Content-Disposition"] = (
            f'inline; filename="capture-{filename_timestamp}.jpg"'
        )
        response.headers["X-Frame-Sequence"] = str(snapshot.sequence)
        response.headers["X-Camera-Session"] = snapshot.session_id
        response.headers["X-Captured-At"] = snapshot.captured_at
        response.headers["X-Frame-Width"] = str(snapshot.width)
        response.headers["X-Frame-Height"] = str(snapshot.height)
        return _no_cache(response)

    @app.get("/stream.mjpg")
    def stream() -> Response | tuple[Response, int]:
        first = camera.wait_for_frame(
            timeout=settings.initial_frame_wait_seconds,
            max_age=settings.frame_stale_seconds,
        )
        if first is None:
            return _error("camera stream is not ready", 503)

        def frames() -> Iterator[bytes]:
            current = first
            yield _mjpeg_chunk(current)
            while True:
                next_frame = camera.wait_for_frame(
                    after_sequence=current.sequence,
                    timeout=settings.frame_stale_seconds,
                    max_age=settings.frame_stale_seconds,
                )
                if next_frame is not None:
                    current = next_frame
                    yield _mjpeg_chunk(current)
                    continue

                # Keep the multipart connection open across a recoverable
                # outage. The producer will wake this loop when a fresh frame
                # arrives; only a stopped service terminates the response.
                if camera.health_report()["state"] == "stopped":
                    return

        response = Response(
            frames(),
            mimetype=f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}",
            direct_passthrough=True,
        )
        response.headers["X-Accel-Buffering"] = "no"
        return _no_cache(response)

    return app
