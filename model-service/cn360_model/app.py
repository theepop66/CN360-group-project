import asyncio
import io
import math
import os
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

from .worker_client import Model, ModelFailure, ResidentWorker

MAX_UPLOAD_BYTES = 16 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000


def failure(reason: str, code: int = 503) -> JSONResponse:
    return JSONResponse({"status": "error", "reason": reason}, status_code=code)


def create_app(*, model: Model | None = None, request_timeout: float | None = None) -> FastAPI:
    engine: Model = model if model is not None else ResidentWorker()
    timeout = request_timeout if request_timeout is not None else float(os.environ.get("CN360_MODEL_REQUEST_TIMEOUT", "1.1"))
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("request timeout must be finite and positive")
    lock = asyncio.Lock()
    current_prompt = "Locate all the instances that matches the following description: defect."

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await engine.start()
        try:
            yield
        finally:
            await engine.close()

    app = FastAPI(title="CN360 resident LocateAnything", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        return failure("invalid_request", 422)

    @app.get("/health")
    async def health() -> JSONResponse:
        if not engine.ready:
            return failure(engine.error or "model_not_ready")
        return JSONResponse({"status": "ok", "backend": engine.backend, "busy": lock.locked()})

    @app.get("/get_prompt")
    async def get_prompt() -> dict[str, str]:
        return {"status": "ok", "current_prompt": current_prompt}

    @app.get("/set_prompt")
    async def set_prompt(prompt: str) -> JSONResponse:
        nonlocal current_prompt
        if not prompt.strip():
            return failure("empty_inspection_target", 400)
        current_prompt = prompt.strip()
        return JSONResponse({"status": "updated", "current_prompt": current_prompt})

    @app.post("/predict")
    async def predict(request: Request, file: UploadFile = File(...), prompt: str | None = Form(None)) -> JSONResponse:
        started = time.perf_counter()
        if not engine.ready:
            return failure(engine.error or "model_not_ready")
        if lock.locked():
            return failure("model_busy")
        # No unbounded queue: a shared native context is never entered twice.
        async with lock:
            instruction = current_prompt if prompt is None else prompt.strip()
            if not instruction:
                return failure("empty_inspection_target", 400)
            data = await file.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                return failure("image_too_large", 413)
            try:
                with Image.open(io.BytesIO(data)) as image:
                    width, height = image.size
                    if width * height > MAX_IMAGE_PIXELS:
                        return failure("image_too_large", 413)
                    if image.format not in {"JPEG", "PNG", "BMP"}:
                        return failure("unsupported_image_format", 400)
                    image.verify()
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
                return failure("invalid_image", 400)
            elapsed = time.perf_counter() - started
            remaining = timeout - elapsed
            if remaining <= 0:
                return failure("model_timeout", 504)
            work = asyncio.create_task(engine.predict(data, instruction, remaining))
            try:
                while not work.done():
                    await asyncio.wait({work}, timeout=0.05)
                    if await request.is_disconnected():
                        work.cancel()
                        try:
                            await work
                        except asyncio.CancelledError:
                            pass
                        return failure("client_disconnected", 499)
                result = await work
            except asyncio.CancelledError:
                work.cancel()
                try:
                    await work
                except asyncio.CancelledError:
                    pass
                raise
            except ModelFailure as exc:
                return failure(exc.reason, 504 if exc.reason == "model_timeout" else 503)
            # Native JSON is not trusted to turn malformed geometry into a pass.
            detections = result.get("detections")
            if not isinstance(detections, list):
                return failure("model_invalid_response")
            clean: list[dict[str, Any]] = []
            for detection in detections:
                if not isinstance(detection, dict):
                    return failure("model_invalid_box")
                box = detection.get("box")
                if not isinstance(box, list) or len(box) != 4 or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in box):
                    return failure("model_invalid_box")
                if box[2] <= box[0] or box[3] <= box[1]:
                    return failure("model_invalid_box")
                clean.append({"label": str(detection.get("label") or "defect"), "box": box})
            return JSONResponse({
                "status": "success", "prompt_used": instruction, "detections": clean,
                "frame_width": width, "frame_height": height, "backend": engine.backend,
                "peak_working_set_bytes": result.get("peak_working_set_bytes"),
                "timings_ms": {**result.get("timings_ms", {}), "image_handling": elapsed * 1000, "request": (time.perf_counter() - started) * 1000},
            })

    return app
