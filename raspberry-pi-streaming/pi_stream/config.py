from __future__ import annotations

from dataclasses import dataclass
import math
import os
import re
from typing import Mapping
from urllib.parse import urlsplit, urlunsplit


def _parse_camera_source(value: str) -> int | str:
    value = value.strip()
    if re.fullmatch(r"[+-]?\d+", value):
        return int(value)
    if not value:
        raise ValueError("CAMERA_SOURCE must not be empty")
    windows_drive_path = bool(re.match(r"^[A-Za-z]:[\\/]", value))
    scheme_like = bool(re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value))
    url_like = "://" in value or "@" in value or (scheme_like and not windows_drive_path)
    if url_like:
        try:
            parsed = urlsplit(value)
            if not parsed.scheme or not parsed.hostname:
                raise ValueError
            parsed.port  # Validate a numeric port while parsing configuration.
        except ValueError as error:
            raise ValueError("CAMERA_SOURCE contains an invalid URL") from error
    return value


def _read_int(environment: Mapping[str, str], name: str, default: int) -> int:
    try:
        return int(environment.get(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error


def _read_float(environment: Mapping[str, str], name: str, default: float) -> float:
    try:
        value = float(environment.get(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "0.0.0.0"
    port: int = 8000
    cors_allowed_origin: str = "*"
    camera_source: int | str = 0
    camera_width: int = 1920
    camera_height: int = 1080
    camera_fps: float = 15.0
    camera_open_timeout_seconds: float = 5.0
    camera_read_timeout_seconds: float = 5.0
    stream_width: int = 1280
    stream_jpeg_quality: int = 80
    capture_jpeg_quality: int = 95
    camera_retry_seconds: float = 2.0
    frame_stale_seconds: float = 3.0
    initial_frame_wait_seconds: float = 2.0
    capture_wait_seconds: float = 2.0
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        self.validate()

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if environment is None else environment
        settings = cls(
            host=env.get("HOST", "0.0.0.0").strip(),
            port=_read_int(env, "PORT", 8000),
            cors_allowed_origin=env.get("CORS_ALLOWED_ORIGIN", "*").strip(),
            camera_source=_parse_camera_source(env.get("CAMERA_SOURCE", "0")),
            camera_width=_read_int(env, "CAMERA_WIDTH", 1920),
            camera_height=_read_int(env, "CAMERA_HEIGHT", 1080),
            camera_fps=_read_float(env, "CAMERA_FPS", 15.0),
            camera_open_timeout_seconds=_read_float(
                env, "CAMERA_OPEN_TIMEOUT_SECONDS", 5.0
            ),
            camera_read_timeout_seconds=_read_float(
                env, "CAMERA_READ_TIMEOUT_SECONDS", 5.0
            ),
            stream_width=_read_int(env, "STREAM_WIDTH", 1280),
            stream_jpeg_quality=_read_int(env, "STREAM_JPEG_QUALITY", 80),
            capture_jpeg_quality=_read_int(env, "CAPTURE_JPEG_QUALITY", 95),
            camera_retry_seconds=_read_float(env, "CAMERA_RETRY_SECONDS", 2.0),
            frame_stale_seconds=_read_float(env, "FRAME_STALE_SECONDS", 3.0),
            initial_frame_wait_seconds=_read_float(env, "INITIAL_FRAME_WAIT_SECONDS", 2.0),
            capture_wait_seconds=_read_float(env, "CAPTURE_WAIT_SECONDS", 2.0),
            log_level=env.get("LOG_LEVEL", "INFO").strip().upper(),
        )
        return settings

    def validate(self) -> None:
        if not self.host:
            raise ValueError("HOST must not be empty")
        if not self.cors_allowed_origin:
            raise ValueError("CORS_ALLOWED_ORIGIN must not be empty")
        if isinstance(self.camera_source, str) and not self.camera_source.strip():
            raise ValueError("CAMERA_SOURCE must not be empty")
        if not 1 <= self.port <= 65_535:
            raise ValueError("PORT must be between 1 and 65535")

        for name, value in (
            ("CAMERA_WIDTH", self.camera_width),
            ("CAMERA_HEIGHT", self.camera_height),
            ("STREAM_WIDTH", self.stream_width),
        ):
            if value <= 0:
                raise ValueError(f"{name} must be greater than zero")

        if not math.isfinite(self.camera_fps) or not 0 < self.camera_fps <= 120:
            raise ValueError("CAMERA_FPS must be greater than zero and at most 120")

        for name, value in (
            ("STREAM_JPEG_QUALITY", self.stream_jpeg_quality),
            ("CAPTURE_JPEG_QUALITY", self.capture_jpeg_quality),
        ):
            if not 1 <= value <= 100:
                raise ValueError(f"{name} must be between 1 and 100")

        for name, value in (
            ("CAMERA_RETRY_SECONDS", self.camera_retry_seconds),
            ("CAMERA_OPEN_TIMEOUT_SECONDS", self.camera_open_timeout_seconds),
            ("CAMERA_READ_TIMEOUT_SECONDS", self.camera_read_timeout_seconds),
            ("FRAME_STALE_SECONDS", self.frame_stale_seconds),
            ("INITIAL_FRAME_WAIT_SECONDS", self.initial_frame_wait_seconds),
            ("CAPTURE_WAIT_SECONDS", self.capture_wait_seconds),
        ):
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be greater than zero")

        if self.log_level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise ValueError("LOG_LEVEL must be CRITICAL, ERROR, WARNING, INFO, or DEBUG")

    def public_camera_source(self) -> int | str:
        if isinstance(self.camera_source, int):
            return self.camera_source

        try:
            parsed = urlsplit(self.camera_source)
        except ValueError:
            return "invalid camera URL"
        if not parsed.scheme or not parsed.hostname:
            if "://" in self.camera_source or "@" in self.camera_source:
                return "invalid camera URL"
            return self.camera_source

        hostname = parsed.hostname
        if ":" in hostname and not hostname.startswith("["):
            hostname = f"[{hostname}]"
        try:
            port = parsed.port
        except ValueError:
            port = None
        netloc = hostname if port is None else f"{hostname}:{port}"
        return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))
