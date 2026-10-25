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
    app = create_app(model=model, request_timeout=0.15, warmup=False)
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


class CountingModel(ControlledModel):
    """Records every predict and every (re)start, to see what warm-up does."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.calls: list[str] = []
        self.starts = 0
        self.fail_next = 0

    async def start(self) -> None:
        self.starts += 1
        await super().start()

    async def predict(self, data: bytes, prompt: str, timeout: float) -> dict[str, Any]:
        self.calls.append(prompt)
        if self.fail_next:
            self.fail_next -= 1
            # A real worker that times out is killed, so it is no longer ready.
            self.ready = False
            self.error = "model_timeout"
            raise ModelFailure("model_timeout")
        return await super().predict(data, prompt, timeout)


def test_warmup_runs_one_prediction_before_ready() -> None:
    model = CountingModel()
    with TestClient(create_app(model=model)) as client:
        assert len(model.calls) == 1, "exactly one warm-up prediction at start"
        health = client.get("/health").json()
        assert health["status"] == "ok"
        assert health["warmup_ms"] is not None
        assert health["restarts"] == 0
        assert client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")}).status_code == 200
        assert len(model.calls) == 2


def test_warmup_can_be_switched_off() -> None:
    model = CountingModel()
    with TestClient(create_app(model=model, warmup=False)) as client:
        assert model.calls == []
        assert client.get("/health").json()["warmup_ms"] is None


def test_failed_warmup_reports_not_ready_instead_of_serving() -> None:
    model = CountingModel()
    model.fail_next = 1
    with TestClient(create_app(model=model, restart_delay=60)) as client:
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json()["reason"] == "model_warmup_failed"
        response = client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
        assert response.status_code == 503
        assert "detections" not in response.json()


@pytest.mark.asyncio
async def test_timed_out_worker_is_replaced_and_warmed_again() -> None:
    model = CountingModel()
    app = create_app(model=model, restart_delay=0.05)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            model.fail_next = 1
            failed = await client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
            assert failed.status_code == 504
            assert failed.json()["reason"] == "model_timeout"
            assert (await client.get("/health")).status_code == 503

            for _ in range(40):
                await asyncio.sleep(0.05)
                health = await client.get("/health")
                if health.status_code == 200:
                    break
            assert health.status_code == 200, "a fresh worker replaces the killed one"
            assert health.json()["restarts"] == 1
            assert model.starts == 2
            # warm-up at start, the failed request, warm-up of the new worker
            assert len(model.calls) == 3
            ok = await client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
            assert ok.status_code == 200


@pytest.mark.asyncio
async def test_requests_during_warmup_are_refused_not_queued() -> None:
    model = CountingModel()
    model.block = True
    app = create_app(model=model, warmup_timeout=5)
    context = app.router.lifespan_context(app)
    startup = asyncio.create_task(context.__aenter__())
    await model.started.wait()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
        health = await client.get("/health")
        assert health.status_code == 503
        assert health.json()["reason"] == "model_warming_up"
        refused = await client.post("/predict", files={"file": ("frame.png", image_bytes(), "image/png")})
        assert refused.json()["reason"] == "model_warming_up"
    model.release.set()
    await startup
    assert model.ready
    await context.__aexit__(None, None, None)
    assert not model.ready
