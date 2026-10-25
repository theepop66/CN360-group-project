from __future__ import annotations

import pytest

from pi_stream.config import Settings


def test_defaults_match_the_pico_stream_contract() -> None:
    settings = Settings.from_env({})

    assert settings.port == 8000
    assert settings.cors_allowed_origin == "*"
    assert settings.camera_source == 0
    assert settings.stream_width == 1280


def test_push_defaults_keep_outbound_pushing_disabled() -> None:
    settings = Settings.from_env({})

    assert settings.n8n_webhook_url == ""
    assert settings.push_interval_seconds == 0.0
    assert settings.push_timeout_seconds == 10.0
    assert settings.push_retry_seconds == 2.0
    assert settings.push_max_attempts == 3


def test_push_settings_parse_from_environment() -> None:
    settings = Settings.from_env(
        {
            "N8N_WEBHOOK_URL": "http://n8n.local:5678/webhook/image-ingestion",
            "PUSH_INTERVAL_SECONDS": "5",
            "PUSH_TIMEOUT_SECONDS": "7.5",
            "PUSH_RETRY_SECONDS": "1.5",
            "PUSH_MAX_ATTEMPTS": "5",
        }
    )

    assert (
        settings.n8n_webhook_url == "http://n8n.local:5678/webhook/image-ingestion"
    )
    assert settings.push_interval_seconds == 5.0
    assert settings.push_timeout_seconds == 7.5
    assert settings.push_retry_seconds == 1.5
    assert settings.push_max_attempts == 5


def test_public_webhook_url_removes_credentials_and_query_secrets() -> None:
    settings = Settings.from_env(
        {
            "N8N_WEBHOOK_URL": (
                "https://user:secret@n8n.local:5678/webhook/image?token=hidden"
            )
        }
    )

    assert settings.public_webhook_url() == "https://n8n.local:5678/webhook/image"


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
        ("N8N_WEBHOOK_URL", "ftp://n8n.local/webhook", "N8N_WEBHOOK_URL"),
        ("N8N_WEBHOOK_URL", "n8n.local/webhook", "N8N_WEBHOOK_URL"),
        ("N8N_WEBHOOK_URL", "http://:5678/webhook", "N8N_WEBHOOK_URL"),
        ("PUSH_INTERVAL_SECONDS", "-1", "PUSH_INTERVAL_SECONDS"),
        ("PUSH_TIMEOUT_SECONDS", "0", "PUSH_TIMEOUT_SECONDS"),
        ("PUSH_RETRY_SECONDS", "0", "PUSH_RETRY_SECONDS"),
        ("PUSH_MAX_ATTEMPTS", "0", "PUSH_MAX_ATTEMPTS"),
    ],
)
def test_invalid_configuration_fails_at_startup(name: str, value: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        Settings.from_env({name: value})
