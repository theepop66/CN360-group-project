from __future__ import annotations

from collections import deque
import threading
from typing import Any


class FakeFrame:
    def __init__(self, width: int = 1920, height: int = 1080, marker: str = "frame") -> None:
        self.shape = (height, width, 3)
        self.marker = marker


class FakeEncodedBuffer:
    def __init__(self, value: bytes) -> None:
        self.value = value

    def tobytes(self) -> bytes:
        return self.value


class FakeCapture:
    def __init__(
        self,
        frames: list[FakeFrame | None],
        *,
        opened: bool = True,
        repeat_last: bool = False,
    ) -> None:
        self.frames = deque(frames)
        self.opened = opened
        self.repeat_last = repeat_last
        self.last_frame: FakeFrame | None = None
        self.released = False
        self.properties: list[tuple[int, float]] = []
        self.read_count = 0
        self._lock = threading.Lock()

    def isOpened(self) -> bool:
        return self.opened

    def set(self, property_id: int, value: float) -> bool:
        self.properties.append((property_id, value))
        return True

    def read(self) -> tuple[bool, FakeFrame | None]:
        with self._lock:
            self.read_count += 1
            if self.frames:
                frame = self.frames.popleft()
                if frame is not None:
                    self.last_frame = frame
                    return True, frame
                return False, None
            if self.repeat_last and self.last_frame is not None:
                return True, self.last_frame
            return False, None

    def release(self) -> None:
        self.released = True


class FakeCV2:
    CAP_PROP_FRAME_WIDTH = 3
    CAP_PROP_FRAME_HEIGHT = 4
    CAP_PROP_FPS = 5
    CAP_PROP_BUFFERSIZE = 38
    CAP_PROP_OPEN_TIMEOUT_MSEC = 53
    CAP_PROP_READ_TIMEOUT_MSEC = 54
    CAP_ANY = 0
    IMWRITE_JPEG_QUALITY = 1
    INTER_AREA = 3

    def __init__(self, captures: list[FakeCapture]) -> None:
        self.captures = deque(captures)
        self.created_captures: list[FakeCapture] = []
        self.encode_failures_remaining = 0
        self.encode_qualities: list[int] = []
        self.encoded_shapes: list[tuple[int, int, int]] = []
        self.capture_calls: list[tuple[Any, ...]] = []

    def VideoCapture(self, *arguments: Any) -> FakeCapture:
        self.capture_calls.append(arguments)
        if not self.captures:
            capture = FakeCapture([], opened=False)
        else:
            capture = self.captures.popleft()
        self.created_captures.append(capture)
        return capture

    def resize(
        self,
        frame: FakeFrame,
        dimensions: tuple[int, int],
        *,
        interpolation: int,
    ) -> FakeFrame:
        del interpolation
        width, height = dimensions
        return FakeFrame(width, height, marker=frame.marker)

    def imencode(
        self,
        _extension: str,
        frame: FakeFrame,
        parameters: list[int],
    ) -> tuple[bool, FakeEncodedBuffer | None]:
        self.encode_qualities.append(parameters[-1])
        self.encoded_shapes.append(frame.shape)
        if self.encode_failures_remaining > 0:
            self.encode_failures_remaining -= 1
            return False, None
        value = b"\xff\xd8" + frame.marker.encode("ascii") + b"\xff\xd9"
        return True, FakeEncodedBuffer(value)


class StubCamera:
    def __init__(self, snapshot: Any, capture_jpeg: bytes) -> None:
        self.snapshot = snapshot
        self.capture_jpeg = capture_jpeg
        self.available = True
        self.capture_encoding_error: Exception | None = None
        self.stop_calls = 0

    def wait_for_frame(
        self,
        *,
        timeout: float,
        max_age: float | None = None,
        after_sequence: int | None = None,
    ) -> Any:
        del timeout, max_age
        if not self.available:
            return None
        if after_sequence is not None and after_sequence >= self.snapshot.sequence:
            return None
        return self.snapshot

    def encode_capture(self, _snapshot: Any) -> bytes:
        if self.capture_encoding_error:
            raise self.capture_encoding_error
        return self.capture_jpeg

    def health_report(self) -> dict[str, Any]:
        return {
            "healthy": self.available,
            "sessionId": self.snapshot.session_id,
            "state": "running" if self.available else "unavailable",
            "fresh": self.available,
            "frameSequence": self.snapshot.sequence if self.available else 0,
            "frameAgeMs": 5 if self.available else None,
            "width": self.snapshot.width if self.available else None,
            "height": self.snapshot.height if self.available else None,
            "lastError": None if self.available else "camera unavailable",
        }

    def stop(self) -> None:
        self.stop_calls += 1
