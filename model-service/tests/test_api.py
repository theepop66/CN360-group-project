import asyncio
import io
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from cn360_model.app import create_app
from cn360_model.worker_client import ModelFailure


def image_bytes() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (32, 24), "white").save(stream, format="PNG")
    return stream.getvalue()


class ControlledModel:
    """HTTP-boundary fixtures; real native coverage is a separate opt-in smoke test."""

    ready = False
    backend = "fixture"
    error: str | None = None

    def __init__(self, *, startup_failure: bool = False) -> None:
        self.startup_failure = startup_failure
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.block = False
        self.fail = False
        self.detections: list[Any] = []

    async def start(self) -> None:
        self.ready = not self.startup_failure
        self.error = "model_load_failed" if self.startup_failure else None

    async def close(self) -> None:
        self.ready = False

    async def predict(self, data: bytes, prompt: str, timeout: float) -> dict[str, Any]:
        self.started.set()
        if self.block:
            try:
                await asyncio.wait_for(self.release.wait(), timeout)
            except TimeoutError as exc:
                self.ready = False
                self.error = "model_timeout"
                raise ModelFailure("model_timeout") from exc
        if self.fail:
            raise ModelFailure("inference_failed")
        return {"detections": self.detections, "backend": self.backend, "timings_ms": {"inference": 1.0}}


def test_public_prediction_keeps_geometry_prompt_and_valid_empty_result() -> None:
    with TestClient(create_app(model=ControlledModel())) as client:
        assert client.get("/health").json()["backend"] == "fixture"
        instruction = "Locate all the instances that matches the following description: scratch."
        assert client.get("/set_prompt", params={"prompt": instruction}).json()["status"] == "updated"
        for _ in range(2):
            response = client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
            assert response.status_code == 200
            result = response.json()
            assert result["status"] == "success"
            assert result["prompt_used"] == instruction
            assert result["detections"] == []
            assert result["frame_width"] == 32
            assert result["frame_height"] == 24
            assert "annotated" not in result
        assert client.get("/set_prompt", params={"prompt": "   "}).status_code == 400
        assert client.get("/get_prompt").json()["current_prompt"] == instruction


def test_explicit_instruction_is_not_replaced_by_global_prompt() -> None:
    with TestClient(create_app(model=ControlledModel())) as client:
        client.get("/set_prompt", params={"prompt": "global instruction"})
        response = client.post("/predict", data={"prompt": "explicit instruction"}, files={"file": ("frame.png", image_bytes(), "image/png")})
        assert response.json()["prompt_used"] == "explicit instruction"
        assert client.post("/predict", data={"prompt": " "}, files={"file": ("frame.png", image_bytes(), "image/png")}).status_code == 400


def test_invalid_uploads_and_engine_failure_cannot_look_like_empty_success() -> None:
    model = ControlledModel()
    with TestClient(create_app(model=model)) as client:
        assert client.post("/predict", files={"image": ("frame.png", image_bytes(), "image/png")}).status_code == 422
        response = client.post("/predict", files={"file": ("bad.png", b"broken", "image/png")})
        assert response.status_code == 400
        assert response.json()["status"] == "error"
        model.fail = True
        response = client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
        assert response.status_code == 503
        assert response.json()["reason"] == "inference_failed"
        assert "detections" not in response.json()


def test_health_is_not_ready_when_initialization_failed() -> None:
    with TestClient(create_app(model=ControlledModel(startup_failure=True))) as client:
        assert client.get("/health").status_code == 503
        response = client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
        assert response.status_code == 503
        assert response.json()["reason"] == "model_load_failed"


def test_malformed_engine_geometry_is_not_returned_as_success() -> None:
    model = ControlledModel()
    with TestClient(create_app(model=model)) as client:
        for box in [[4, 4, 1, 1], [0, 0, float("nan"), 4], [0, 0, True, 4], []]:
            model.detections = [{"label": "scratch", "box": box}]
            response = client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
            assert response.status_code == 503
            assert response.json()["reason"] == "model_invalid_box"


def test_real_worker_startup_failure_is_reported_over_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CN360_MODEL_LIBRARY", "missing-model-library")
    monkeypatch.setenv("CN360_MODEL_PATH", "missing-model")
    monkeypatch.setenv("CN360_MODEL_STARTUP_TIMEOUT", "5")
    with TestClient(create_app()) as client:
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json()["reason"] == "model_load_failed"


@pytest.mark.asyncio
async def test_concurrent_request_is_bounded_and_timeout_is_not_reused() -> None:
    model = ControlledModel()
    model.block = True
    app = create_app(model=model, request_timeout=0.15)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            first = asyncio.create_task(client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")}))
            await model.started.wait()
            second = await client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
            assert second.status_code == 503
            assert second.json()["reason"] == "model_busy"
            expired = await first
            assert expired.status_code == 504
            assert expired.json()["reason"] == "model_timeout"
            assert (await client.get("/health")).status_code == 503
