from __future__ import annotations

from datetime import datetime, timezone
import logging
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable

from .camera import CameraService, FrameEncodingError, FrameSnapshot
from .config import Settings


LOGGER = logging.getLogger(__name__)


class PushTransportError(RuntimeError):
    """Raised when the n8n webhook cannot be reached at all."""


def http_post_status(
    url: str,
    body: bytes,
    *,
    content_type: str,
    timeout: float,
) -> int:
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": content_type},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
            return int(response.status)
    except urllib.error.HTTPError as error:
        error.read()
        return int(error.code)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise PushTransportError(str(error)) from error


def build_multipart_body(
    fields: dict[str, str],
    *,
    file_name: str,
    file_bytes: bytes,
    boundary: str,
) -> bytes:
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n'
                "\r\n"
                f"{value}\r\n"
            ).encode("utf-8")
        )
    chunks.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{file_name}"\r\n'
            "Content-Type: image/jpeg\r\n"
            "\r\n"
        ).encode("ascii")
    )
    chunks.append(file_bytes)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks)


def _file_safe(value: str) -> str:
    return value.replace("-", "").replace(":", "").replace(".", "")


class FramePusher:
    """Push fresh camera frames to the n8n image-ingestion webhook.

    The pusher runs in its own thread, never blocks the camera producer, and
    treats the webhook as unreliable: failed sends are retried a bounded
    number of times, then the frame is dropped and the next fresh frame is
    used. A stopped camera or webhook simply pauses pushing until it returns.
    """

    def __init__(
        self,
        settings: Settings,
        camera: CameraService,
        *,
        http_post: Callable[..., int] | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if not settings.n8n_webhook_url:
            raise ValueError("FramePusher requires a configured N8N_WEBHOOK_URL")
        self.settings = settings
        self.camera = camera
        self._http_post = http_post or http_post_status
        self._monotonic = monotonic
        self._condition = threading.Condition()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._trigger_requested = False
        self._last_session: str | None = None
        self._last_sequence = 0
        self._total_pushed = 0
        self._total_dropped = 0
        self._consecutive_failures = 0
        self._last_image_id: str | None = None
        self._last_push_at: str | None = None
        self._last_status: int | None = None
        self._last_latency_ms: float | None = None
        self._last_error: str | None = None

    def start(self) -> None:
        with self._condition:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="frame-pusher",
                daemon=True,
            )
            self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        with self._condition:
            thread = self._thread
            if thread is None:
                return
            self._stop_event.set()
            self._condition.notify_all()

        if thread is not threading.current_thread():
            thread.join(timeout=timeout)

        with self._condition:
            if not thread.is_alive():
                self._thread = None

    @property
    def is_started(self) -> bool:
        with self._condition:
            return self._thread is not None and self._thread.is_alive()

    def request_push(self) -> None:
        with self._condition:
            self._trigger_requested = True
            self._condition.notify_all()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            triggered = self._wait_for_cycle()
            if self._stop_event.is_set():
                return
            snapshot = self._acquire_frame()
            if snapshot is None:
                self._stop_event.wait(self.settings.push_retry_seconds)
                continue
            self._send(snapshot, trigger="manual" if triggered else "interval")

    def _wait_for_cycle(self) -> bool:
        interval = self.settings.push_interval_seconds
        with self._condition:
            deadline = self._monotonic() + interval if interval > 0 else None
            while not self._stop_event.is_set():
                if self._trigger_requested:
                    self._trigger_requested = False
                    return True
                if deadline is None:
                    self._condition.wait(timeout=1.0)
                    continue
                remaining = deadline - self._monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
        return False

    def _acquire_frame(self) -> FrameSnapshot | None:
        with self._condition:
            last_session = self._last_session
            last_sequence = self._last_sequence

        # A restarted producer gets a new session id and its sequence counter
        # starts again from one, so a new session is always "newer".
        current_session = getattr(self.camera, "session_id", None)
        if current_session is not None and current_session != last_session:
            after_sequence = None
        else:
            after_sequence = last_sequence if last_session is not None else None

        snapshot = self.camera.wait_for_frame(
            after_sequence=after_sequence,
            timeout=self.settings.capture_wait_seconds,
            max_age=self.settings.frame_stale_seconds,
        )
        if snapshot is None:
            return None
        if snapshot.session_id == last_session and snapshot.sequence <= last_sequence:
            return None
        return snapshot

    def _send(self, snapshot: FrameSnapshot, *, trigger: str) -> None:
        image_id = f"{snapshot.session_id}-{snapshot.sequence}"
        try:
            jpeg = self.camera.encode_capture(snapshot)
        except FrameEncodingError as error:
            self._mark_consumed(snapshot)
            self._record_failure(f"capture encoding failed: {error}")
            self._record_dropped(image_id)
            LOGGER.error("Dropping %s: %s", image_id, error)
            return

        boundary = uuid.uuid4().hex
        body = build_multipart_body(
            {
                "image_id": image_id,
                "timestamp": snapshot.captured_at,
                "session_id": snapshot.session_id,
                "frame_sequence": str(snapshot.sequence),
                "width": str(snapshot.width),
                "height": str(snapshot.height),
                "source": str(self.settings.public_camera_source()),
                "trigger": trigger,
            },
            file_name=f"capture-{_file_safe(snapshot.captured_at)}.jpg",
            file_bytes=jpeg,
            boundary=boundary,
        )
        content_type = f"multipart/form-data; boundary={boundary}"
        max_attempts = self.settings.push_max_attempts

        for attempt in range(1, max_attempts + 1):
            status: int | None = None
            transport_error: str | None = None
            try:
                status = self._http_post(
                    self.settings.n8n_webhook_url,
                    body,
                    content_type=content_type,
                    timeout=self.settings.push_timeout_seconds,
                )
            except PushTransportError as error:
                transport_error = str(error)

            if status is not None and 200 <= status < 300:
                latency_ms = (
                    self._monotonic() - snapshot.captured_monotonic
                ) * 1000.0
                self._mark_consumed(snapshot)
                self._record_success(image_id, status, latency_ms)
                LOGGER.info(
                    "Pushed %s to n8n (HTTP %s, %.0f ms after capture)",
                    image_id,
                    status,
                    latency_ms,
                )
                return

            if transport_error is not None:
                LOGGER.warning(
                    "Push of %s failed (attempt %d/%d): %s",
                    image_id,
                    attempt,
                    max_attempts,
                    transport_error,
                )
                self._record_failure(transport_error)
            else:
                LOGGER.warning(
                    "Push of %s rejected (attempt %d/%d): HTTP %s",
                    image_id,
                    attempt,
                    max_attempts,
                    status,
                )
                self._record_failure(f"HTTP {status}")

            if attempt < max_attempts and self._stop_event.wait(
                self.settings.push_retry_seconds
            ):
                return

        self._mark_consumed(snapshot)
        self._record_dropped(image_id)
        LOGGER.error(
            "Dropping %s after %d failed push attempts", image_id, max_attempts
        )

    def _mark_consumed(self, snapshot: FrameSnapshot) -> None:
        with self._condition:
            self._last_session = snapshot.session_id
            self._last_sequence = snapshot.sequence

    def _record_success(
        self, image_id: str, status: int, latency_ms: float
    ) -> None:
        with self._condition:
            self._total_pushed += 1
            self._consecutive_failures = 0
            self._last_image_id = image_id
            self._last_push_at = (
                datetime.now(timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            )
            self._last_status = status
            self._last_latency_ms = round(latency_ms, 1)
            self._last_error = None

    def _record_failure(self, error: str) -> None:
        with self._condition:
            self._consecutive_failures += 1
            self._last_error = error

    def _record_dropped(self, image_id: str) -> None:
        with self._condition:
            self._total_dropped += 1

    def status(self) -> dict[str, Any]:
        with self._condition:
            thread = self._thread
            return {
                "enabled": True,
                "running": thread is not None and thread.is_alive(),
                "intervalSeconds": self.settings.push_interval_seconds,
                "totalPushed": self._total_pushed,
                "totalDropped": self._total_dropped,
                "consecutiveFailures": self._consecutive_failures,
                "lastImageId": self._last_image_id,
                "lastPushAt": self._last_push_at,
                "lastStatus": self._last_status,
                "lastLatencyMs": self._last_latency_ms,
                "lastError": self._last_error,
            }
