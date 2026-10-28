import asyncio
import io
from typing import Any

import httpx
import pytest
from PIL import Image

from cn360_model.app import create_app
from cn360_model.worker_client import ModelFailure


def picture() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (32, 24), "white").save(output, format="PNG")
    return output.getvalue()


class LifecycleModel:
    ready = False
    backend = "fixture"
    error: str | None = None

    def __init__(self) -> None:
        self.starts = 0
        self.warming = asyncio.Event()
        self.release = asyncio.Event()
        self.fail_warmup = False
        self.fail_request = False

    async def start(self) -> None:
        self.starts += 1
        self.ready = True

    async def close(self) -> None:
        self.ready = False

    async def predict(self, data: bytes, prompt: str, timeout: float) -> dict[str, Any]:
        self.warming.set()
        await self.release.wait()
        if self.fail_warmup or self.fail_request:
            self.ready = False
            self.fail_request = False
            raise ModelFailure("model_timeout")
        return {"detections": []}


async def wait_health(client: httpx.AsyncClient, *, ready: bool, reason: str | None = None) -> dict[str, Any]:
    async with asyncio.timeout(2):
        while True:
            response = await client.get("/health")
            body = response.json()
            if (response.status_code == 200) == ready and (reason is None or body.get("reason") == reason):
                return body
            await asyncio.sleep(0.005)


@pytest.mark.asyncio
async def test_public_health_and_prediction_wait_for_warmup() -> None:
    model = LifecycleModel()
    app = create_app(model=model, warmup_image=picture(), warmup_timeout=1, recovery_delay=0.02)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            await model.warming.wait()
            assert (await client.get("/health")).json()["reason"] == "model_warming"
            assert (await client.post("/predict", files={"file": ("frame.png", picture())})).status_code == 503
            model.release.set()
            health = await wait_health(client, ready=True)
            assert health["warmup_ms"] >= 0
            assert (await client.post("/predict", files={"file": ("frame.png", picture())})).status_code == 200


@pytest.mark.asyncio
async def test_failed_warmup_and_request_timeout_require_restart_and_rewarm() -> None:
    model = LifecycleModel()
    model.fail_warmup = True
    model.release.set()
    app = create_app(model=model, warmup_image=picture(), recovery_delay=0.1)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            await wait_health(client, ready=False, reason="model_warmup_failed")
            model.fail_warmup = False
            await wait_health(client, ready=True)
            starts = model.starts
            model.fail_request = True
            assert (await client.post("/predict", files={"file": ("frame.png", picture())})).status_code == 504
            assert (await client.get("/health")).status_code == 503
            await wait_health(client, ready=True)
            assert model.starts > starts


@pytest.mark.asyncio
async def test_warmup_has_its_own_bounded_timeout() -> None:
    model = LifecycleModel()
    app = create_app(model=model, warmup_image=picture(), warmup_timeout=0.02, recovery_delay=1)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            await wait_health(client, ready=False, reason="model_warmup_timeout")
            assert not model.ready


@pytest.mark.asyncio
async def test_missing_warmup_configuration_never_starts_or_readies_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CN360_MODEL_WARMUP_IMAGE", raising=False)
    model = LifecycleModel()
    app = create_app(model=model)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            await wait_health(client, ready=False, reason="model_warmup_image_missing")
            assert model.starts == 0


@pytest.mark.asyncio
async def test_dead_worker_cannot_remain_ready_and_is_rewarmed() -> None:
    model = LifecycleModel()
    model.release.set()
    app = create_app(model=model, warmup_image=picture(), recovery_delay=0.1)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://fixture") as client:
            await wait_health(client, ready=True)
            starts = model.starts
            model.ready = False
            model.error = "model_worker_exited"
            assert (await client.get("/health")).status_code == 503
            await wait_health(client, ready=True)
            assert model.starts > starts
