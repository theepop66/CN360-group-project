from __future__ import annotations

import pytest

from pi_stream.config import Settings


def test_defaults_match_the_pico_stream_contract() -> None:
    settings = Settings.from_env({})

    assert settings.port == 8000
    assert settings.cors_allowed_origin == "*"
    assert settings.camera_source == 0
    assert settings.stream_width == 1280


def test_camera_source_parses_device_indexes_and_urls() -> None:
    assert Settings.from_env({"CAMERA_SOURCE": "2"}).camera_source == 2
    assert (
        Settings.from_env({"CAMERA_SOURCE": "rtsp://camera.local/live"}).camera_source
        == "rtsp://camera.local/live"
    )


def test_public_camera_source_removes_credentials_and_query_secrets() -> None:
    settings = Settings.from_env(
        {"CAMERA_SOURCE": "rtsp://user:secret@camera.local:8554/live?token=hidden"}
    )

    assert settings.public_camera_source() == "rtsp://camera.local:8554/live"


def test_malformed_network_camera_url_fails_at_startup() -> None:
    for value in ("rtsp://[broken", "rtsp:user:secret@camera/live?token=hidden"):
        with pytest.raises(ValueError, match="CAMERA_SOURCE"):
            Settings.from_env({"CAMERA_SOURCE": value})


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("PORT", "70000", "PORT"),
        ("CAMERA_WIDTH", "0", "CAMERA_WIDTH"),
        ("CAMERA_FPS", "121", "CAMERA_FPS"),
        ("STREAM_JPEG_QUALITY", "0", "STREAM_JPEG_QUALITY"),
        ("CAPTURE_JPEG_QUALITY", "101", "CAPTURE_JPEG_QUALITY"),
        ("FRAME_STALE_SECONDS", "0", "FRAME_STALE_SECONDS"),
        ("FRAME_STALE_SECONDS", "nan", "FRAME_STALE_SECONDS"),
        ("CAMERA_READ_TIMEOUT_SECONDS", "0", "CAMERA_READ_TIMEOUT_SECONDS"),
        ("CORS_ALLOWED_ORIGIN", "", "CORS_ALLOWED_ORIGIN"),
        ("LOG_LEVEL", "VERBOSE", "LOG_LEVEL"),
    ],
)
def test_invalid_configuration_fails_at_startup(name: str, value: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        Settings.from_env({name: value})
