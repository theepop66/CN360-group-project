from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import threading
import time
from typing import Any, Callable
from urllib.parse import urlsplit
import uuid

from .config import Settings


LOGGER = logging.getLogger(__name__)


class FrameEncodingError(RuntimeError):
    """Raised when OpenCV cannot encode a frame as JPEG."""


@dataclass(frozen=True, slots=True)
class FrameSnapshot:
    session_id: str
    sequence: int
    captured_at: str
    captured_monotonic: float
    width: int
    height: int
    raw_frame: Any
    stream_jpeg: bytes


class CameraService:
    """Own one OpenCV capture in a producer thread and share its latest frame."""

    def __init__(
        self,
        settings: Settings,
        *,
        opencv_module: Any | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] | None = None,
        session_id: str | None = None,
    ) -> None:
        self.settings = settings
        self._opencv = opencv_module
        self._monotonic = monotonic
        self._wall_clock = wall_clock or (lambda: datetime.now(timezone.utc))
        self.session_id = session_id or uuid.uuid4().hex
        self._condition = threading.Condition()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._latest: FrameSnapshot | None = None
        self._sequence = 0
        self._state = "stopped"
        self._last_error: str | None = None

    def _cv2(self) -> Any:
        if self._opencv is None:
            try:
                import cv2  # type: ignore
            except ImportError as error:
                raise RuntimeError(
                    "OpenCV is not installed; run pip install -r requirements.txt"
                ) from error
            self._opencv = cv2
        return self._opencv

    def start(self) -> None:
        self._cv2()  # Fail at startup instead of looping forever without OpenCV.
        with self._condition:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._state = "starting"
            self._last_error = None
            self._thread = threading.Thread(
                target=self._run,
                name="camera-producer",
                daemon=True,
            )
            self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        with self._condition:
            thread = self._thread
            if thread is None:
                self._stop_event.set()
                self._state = "stopped"
                self._condition.notify_all()
                return
            self._stop_event.set()
            self._state = "stopping"
            self._condition.notify_all()

        if thread is not threading.current_thread():
            thread.join(timeout=timeout)

        with self._condition:
            if not thread.is_alive():
                self._thread = None
                self._state = "stopped"
            else:
                LOGGER.warning("Camera producer did not stop within %.1f seconds", timeout)
            self._condition.notify_all()

    @property
    def is_started(self) -> bool:
        with self._condition:
            return self._thread is not None and self._thread.is_alive()

    def _set_failure(self, message: str) -> None:
        LOGGER.warning("Camera unavailable: %s", message)
        with self._condition:
            self._state = "unavailable"
            self._last_error = message
            self._condition.notify_all()

    def _configure_capture(self, capture: Any) -> None:
        cv2 = self._cv2()
        properties = (
            (cv2.CAP_PROP_FRAME_WIDTH, self.settings.camera_width),
            (cv2.CAP_PROP_FRAME_HEIGHT, self.settings.camera_height),
            (cv2.CAP_PROP_FPS, self.settings.camera_fps),
        )
        if hasattr(cv2, "CAP_PROP_BUFFERSIZE"):
            properties += ((cv2.CAP_PROP_BUFFERSIZE, 1),)

        for property_id, value in properties:
            try:
                capture.set(property_id, value)
            except Exception:
                LOGGER.debug("Camera backend ignored property %s", property_id)

    def _open_capture(self) -> Any:
        cv2 = self._cv2()
        source = self.settings.camera_source
        network_schemes = {"http", "https", "rtsp", "rtsps", "tcp", "udp"}
        is_network_source = (
            isinstance(source, str)
            and urlsplit(source).scheme.lower() in network_schemes
        )
        if is_network_source:
            # Open/read timeout properties must be supplied at construction and
            # are honored by OpenCV's FFmpeg and GStreamer network backends.
            parameters = [
                int(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC),
                round(self.settings.camera_open_timeout_seconds * 1000),
                int(cv2.CAP_PROP_READ_TIMEOUT_MSEC),
                round(self.settings.camera_read_timeout_seconds * 1000),
            ]
            return cv2.VideoCapture(source, cv2.CAP_ANY, parameters)
        return cv2.VideoCapture(source)

    def _resize_for_stream(self, frame: Any, width: int, height: int) -> Any:
        target_width = min(width, self.settings.stream_width)
        if target_width == width:
            return frame

        target_height = max(1, round(height * target_width / width))
        cv2 = self._cv2()
        interpolation = getattr(cv2, "INTER_AREA", 3)
        return cv2.resize(frame, (target_width, target_height), interpolation=interpolation)

    def _encode_jpeg(self, frame: Any, quality: int) -> bytes:
        cv2 = self._cv2()
        success, encoded = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)],
        )
        if not success or encoded is None:
            raise FrameEncodingError("OpenCV failed to encode JPEG")
        return encoded.tobytes()

    def _publish(self, frame: Any) -> None:
        # Capture age starts as soon as read() hands us the frame. Resize/JPEG
        # work must not make an old image appear newer than it is.
        captured_monotonic = self._monotonic()
        captured_at = (
            self._wall_clock()
            .astimezone(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        try:
            height, width = (int(value) for value in frame.shape[:2])
            stream_frame = self._resize_for_stream(frame, width, height)
            stream_jpeg = self._encode_jpeg(
                stream_frame,
                self.settings.stream_jpeg_quality,
            )
        except Exception as error:
            self._set_failure(f"frame processing failed: {error}")
            return

        with self._condition:
            self._sequence += 1
            self._latest = FrameSnapshot(
                session_id=self.session_id,
                sequence=self._sequence,
                captured_at=captured_at,
                captured_monotonic=captured_monotonic,
                width=width,
                height=height,
                raw_frame=frame,
                stream_jpeg=stream_jpeg,
            )
            self._state = "running"
            self._last_error = None
            self._condition.notify_all()

    def _run(self) -> None:
        cv2 = self._cv2()
        frame_interval = 1.0 / self.settings.camera_fps

        while not self._stop_event.is_set():
            capture = None
            try:
                capture = self._open_capture()
                if capture is None or not capture.isOpened():
                    raise RuntimeError("could not open camera source")
                self._configure_capture(capture)

                while not self._stop_event.is_set():
                    started_at = self._monotonic()
                    success, frame = capture.read()
                    if not success or frame is None:
                        raise RuntimeError("camera read failed")

                    self._publish(frame)
                    remaining = frame_interval - (self._monotonic() - started_at)
                    if remaining > 0 and self._stop_event.wait(remaining):
                        break
            except Exception as error:
                self._set_failure(str(error))
            finally:
                if capture is not None:
                    try:
                        capture.release()
                    except Exception:
                        LOGGER.exception("Could not release camera source")

            if not self._stop_event.is_set():
                self._stop_event.wait(self.settings.camera_retry_seconds)

        with self._condition:
            self._state = "stopped"
            self._condition.notify_all()

    def wait_for_frame(
        self,
        *,
        after_sequence: int | None = None,
        timeout: float,
        max_age: float | None = None,
    ) -> FrameSnapshot | None:
        deadline = self._monotonic() + timeout
        with self._condition:
            while True:
                snapshot = self._latest
                is_new = snapshot is not None and (
                    after_sequence is None or snapshot.sequence > after_sequence
                )
                is_fresh = snapshot is not None and (
                    max_age is None
                    or self._monotonic() - snapshot.captured_monotonic <= max_age
                )
                if is_new and is_fresh and self._state == "running":
                    return snapshot

                remaining = deadline - self._monotonic()
                if remaining <= 0 or (
                    self._stop_event.is_set() and self._state == "stopped"
                ):
                    return None
                self._condition.wait(remaining)

    def encode_capture(self, snapshot: FrameSnapshot) -> bytes:
        try:
            return self._encode_jpeg(
                snapshot.raw_frame,
                self.settings.capture_jpeg_quality,
            )
        except FrameEncodingError:
            raise
        except Exception as error:
            raise FrameEncodingError(str(error)) from error

    def health_report(self) -> dict[str, Any]:
        with self._condition:
            snapshot = self._latest
            state = self._state
            last_error = self._last_error

        age_seconds = None
        if snapshot is not None:
            age_seconds = max(0.0, self._monotonic() - snapshot.captured_monotonic)
        fresh = age_seconds is not None and age_seconds <= self.settings.frame_stale_seconds
        healthy = state == "running" and fresh

        return {
            "healthy": healthy,
            "sessionId": self.session_id,
            "state": state,
            "fresh": fresh,
            "frameSequence": snapshot.sequence if snapshot else 0,
            "frameAgeMs": round(age_seconds * 1000) if age_seconds is not None else None,
            "width": snapshot.width if snapshot else None,
            "height": snapshot.height if snapshot else None,
            "lastError": last_error,
        }
