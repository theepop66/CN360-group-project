from __future__ import annotations

import threading

from pi_stream.camera import CameraService
from pi_stream.config import Settings

from .fakes import FakeCV2, FakeCapture, FakeFrame


def fast_settings() -> Settings:
    return Settings(
        camera_width=640,
        camera_height=480,
        camera_fps=120,
        stream_width=320,
        camera_retry_seconds=0.01,
        frame_stale_seconds=1,
        initial_frame_wait_seconds=0.5,
        capture_wait_seconds=0.5,
    )


def test_start_and_stop_are_idempotent_and_release_the_camera() -> None:
    capture = FakeCapture([FakeFrame(640, 480, "one")], repeat_last=True)
    cv2 = FakeCV2([capture])
    service = CameraService(fast_settings(), opencv_module=cv2)

    service.start()
    service.start()
    snapshot = service.wait_for_frame(timeout=0.5, max_age=1)

    assert snapshot is not None
    assert snapshot.width == 640
    assert snapshot.height == 480
    assert snapshot.session_id == service.session_id
    assert len(cv2.created_captures) == 1

    service.stop()
    service.stop()

    assert capture.released is True
    assert service.is_started is False


def test_read_failure_releases_and_reconnects_to_a_new_capture() -> None:
    failed = FakeCapture([None])
    recovered = FakeCapture([FakeFrame(640, 480, "recovered")], repeat_last=True)
    cv2 = FakeCV2([failed, recovered])
    service = CameraService(fast_settings(), opencv_module=cv2)

    service.start()
    try:
        snapshot = service.wait_for_frame(timeout=1, max_age=1)
        assert snapshot is not None
        assert b"recovered" in snapshot.stream_jpeg
        assert failed.released is True
        assert len(cv2.created_captures) == 2
    finally:
        service.stop()


def test_encoding_failure_does_not_publish_a_corrupt_frame() -> None:
    capture = FakeCapture(
        [FakeFrame(640, 480, "bad"), FakeFrame(640, 480, "good")],
        repeat_last=True,
    )
    cv2 = FakeCV2([capture])
    cv2.encode_failures_remaining = 1
    service = CameraService(fast_settings(), opencv_module=cv2)

    service.start()
    try:
        snapshot = service.wait_for_frame(timeout=0.5, max_age=1)
        assert snapshot is not None
        assert b"good" in snapshot.stream_jpeg
        assert b"bad" not in snapshot.stream_jpeg
    finally:
        service.stop()


def test_capture_uses_full_resolution_and_higher_quality() -> None:
    capture = FakeCapture([FakeFrame(640, 480, "full")], repeat_last=True)
    cv2 = FakeCV2([capture])
    service = CameraService(fast_settings(), opencv_module=cv2)

    service.start()
    try:
        snapshot = service.wait_for_frame(timeout=0.5, max_age=1)
        assert snapshot is not None
    finally:
        service.stop()

    encoded = service.encode_capture(snapshot)
    assert b"full" in encoded
    assert 80 in cv2.encode_qualities
    assert cv2.encode_qualities[-1] == 95
    assert cv2.encoded_shapes[-1] == (480, 640, 3)


def test_network_sources_receive_open_and_read_timeouts() -> None:
    capture = FakeCapture([FakeFrame(640, 480, "network")], repeat_last=True)
    cv2 = FakeCV2([capture])
    settings = Settings(
        camera_source="rtsp://camera.local/live",
        camera_width=640,
        camera_height=480,
        camera_fps=120,
        camera_open_timeout_seconds=1.25,
        camera_read_timeout_seconds=2.5,
        stream_width=320,
        camera_retry_seconds=0.01,
        frame_stale_seconds=1,
        initial_frame_wait_seconds=0.5,
        capture_wait_seconds=0.5,
    )
    service = CameraService(settings, opencv_module=cv2)

    service.start()
    try:
        assert service.wait_for_frame(timeout=0.5, max_age=1) is not None
    finally:
        service.stop()

    assert cv2.capture_calls[0] == (
        "rtsp://camera.local/live",
        cv2.CAP_ANY,
        [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
            1250,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC,
            2500,
        ],
    )


def test_local_device_paths_do_not_receive_network_only_timeout_parameters() -> None:
    capture = FakeCapture([FakeFrame(640, 480, "local")], repeat_last=True)
    cv2 = FakeCV2([capture])
    settings = Settings(
        camera_source="/dev/video0",
        camera_width=640,
        camera_height=480,
        camera_fps=120,
        stream_width=320,
        camera_retry_seconds=0.01,
        frame_stale_seconds=1,
        initial_frame_wait_seconds=0.5,
        capture_wait_seconds=0.5,
    )
    service = CameraService(settings, opencv_module=cv2)

    service.start()
    try:
        assert service.wait_for_frame(timeout=0.5, max_age=1) is not None
    finally:
        service.stop()

    assert cv2.capture_calls[0] == ("/dev/video0",)


def test_multiple_consumers_use_one_camera_instance() -> None:
    capture = FakeCapture([FakeFrame(640, 480, "shared")], repeat_last=True)
    cv2 = FakeCV2([capture])
    service = CameraService(fast_settings(), opencv_module=cv2)
    results = []

    service.start()
    try:
        first = service.wait_for_frame(timeout=0.5, max_age=1)
        assert first is not None
        barrier = threading.Barrier(3)

        def consume() -> None:
            barrier.wait()
            results.append(
                service.wait_for_frame(
                    after_sequence=first.sequence,
                    timeout=0.5,
                    max_age=1,
                )
            )

        consumers = [threading.Thread(target=consume) for _ in range(2)]
        for consumer in consumers:
            consumer.start()
        barrier.wait()
        for consumer in consumers:
            consumer.join(timeout=1)

        assert len(results) == 2
        assert all(result is not None for result in results)
        assert len(cv2.created_captures) == 1
    finally:
        service.stop()


def test_stopped_service_wakes_waiters_and_does_not_serve_cached_frames() -> None:
    capture = FakeCapture([FakeFrame(640, 480, "cached")], repeat_last=True)
    cv2 = FakeCV2([capture])
    service = CameraService(fast_settings(), opencv_module=cv2)

    service.start()
    snapshot = service.wait_for_frame(timeout=0.5, max_age=1)
    assert snapshot is not None

    waiter_started = threading.Event()
    waiter_result = []

    def wait_for_future_frame() -> None:
        waiter_started.set()
        waiter_result.append(
            service.wait_for_frame(
                after_sequence=snapshot.sequence + 1_000_000,
                timeout=10,
                max_age=1,
            )
        )

    waiter = threading.Thread(target=wait_for_future_frame)
    waiter.start()
    assert waiter_started.wait(timeout=0.5)
    service.stop()
    waiter.join(timeout=1)

    assert waiter_result == [None]
    assert service.wait_for_frame(timeout=0.01, max_age=1) is None


def test_stop_before_start_wakes_a_waiter() -> None:
    service = CameraService(fast_settings(), opencv_module=FakeCV2([]))
    waiter_started = threading.Event()
    result = []

    def wait() -> None:
        waiter_started.set()
        result.append(service.wait_for_frame(timeout=10, max_age=1))

    waiter = threading.Thread(target=wait)
    waiter.start()
    assert waiter_started.wait(timeout=0.5)
    service.stop()
    waiter.join(timeout=1)

    assert result == [None]


def test_frame_age_includes_stream_encoding_time() -> None:
    clock = [100.0]
    cv2 = FakeCV2([])
    original_encode = cv2.imencode

    def delayed_encode(*args, **kwargs):
        clock[0] += 2.0
        return original_encode(*args, **kwargs)

    cv2.imencode = delayed_encode
    service = CameraService(
        fast_settings(),
        opencv_module=cv2,
        monotonic=lambda: clock[0],
    )

    service._publish(FakeFrame(640, 480, "slow"))
    report = service.health_report()

    assert report["frameAgeMs"] == 2000
    assert report["healthy"] is False


def test_freshness_boundary_and_recovery_are_deterministic() -> None:
    clock = [50.0]
    service = CameraService(
        fast_settings(),
        opencv_module=FakeCV2([]),
        monotonic=lambda: clock[0],
    )
    service._publish(FakeFrame(640, 480, "first"))

    clock[0] = 51.0
    assert service.health_report()["healthy"] is True
    clock[0] = 51.001
    assert service.health_report()["healthy"] is False

    service._set_failure("camera read failed")
    assert service.health_report()["healthy"] is False
    assert service.wait_for_frame(timeout=0, max_age=10) is None

    service._publish(FakeFrame(640, 480, "recovered"))
    recovered = service.health_report()
    assert recovered["healthy"] is True
    assert recovered["frameSequence"] == 2
    assert recovered["sessionId"] == service.session_id
