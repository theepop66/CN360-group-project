import asyncio
import base64
import json
import logging
import math
import os
import sys
from pathlib import Path
from typing import Any, Protocol


class ModelFailure(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class Model(Protocol):
    @property
    def ready(self) -> bool: ...
    backend: str
    error: str | None

    async def start(self) -> None: ...
    async def close(self) -> None: ...
    async def predict(self, data: bytes, prompt: str, timeout: float) -> dict[str, Any]: ...


class ResidentWorker:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self._ready = False
        self.backend = "unavailable"
        self.error: str | None = "model_not_ready"
        self.startup_ms: float | None = None

    @property
    def ready(self) -> bool:
        return self._ready and self.process is not None and self.process.returncode is None

    async def start(self) -> None:
        try:
            startup_timeout = float(os.environ.get("CN360_MODEL_STARTUP_TIMEOUT", "120"))
            if not math.isfinite(startup_timeout) or startup_timeout <= 0:
                raise ModelFailure("model_load_failed")
            self.process = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "cn360_model.worker",
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                # Native diagnostics go to the server log, never the JSON pipe.
                stderr=None, limit=1024 * 1024,
                cwd=Path(__file__).resolve().parents[1],
                creationflags=0x08000000 if os.name == "nt" else 0,
            )
            async with asyncio.timeout(startup_timeout):
                message = await self._receive()
            if message.get("status") != "ready":
                logging.getLogger(__name__).error("Model initialization failed: %s", message.get("detail", message.get("reason")))
                raise ModelFailure("model_load_failed")
            self._ready = True
            self.error = None
            self.backend = str(message["backend"])
            self.startup_ms = float(message["startup_ms"])
        except asyncio.CancelledError:
            await self.close()
            raise
        except (OSError, ValueError, KeyError, TimeoutError, ModelFailure):
            self.error = "model_load_failed"
            await self.close()

    async def _receive(self) -> dict[str, Any]:
        if self.process is None or self.process.stdout is None:
            raise ModelFailure("model_unavailable")
        line = await self.process.stdout.readline()
        if not line:
            raise ModelFailure("model_worker_exited")
        message: dict[str, Any] = json.loads(line)
        if not isinstance(message, dict):
            raise ModelFailure("model_invalid_response")
        return message

    async def predict(self, data: bytes, prompt: str, timeout: float) -> dict[str, Any]:
        if not self.ready or self.process is None or self.process.stdin is None:
            raise ModelFailure(self.error or "model_unavailable")
        try:
            async with asyncio.timeout(timeout):
                payload = json.dumps({"image": base64.b64encode(data).decode("ascii"), "prompt": prompt})
                self.process.stdin.write((payload + "\n").encode("utf-8"))
                await self.process.stdin.drain()
                response = await self._receive()
                if response.get("status") != "success":
                    logging.getLogger(__name__).error("Model worker failure: %s", response.get("detail", response.get("reason")))
                    raise ModelFailure(str(response.get("reason", "inference_failed")))
                return response
        except asyncio.CancelledError:
            self.error = "model_request_cancelled"
            await self.close()
            raise
        except (TimeoutError, OSError, ValueError, ModelFailure) as exc:
            self.error = "model_timeout" if isinstance(exc, TimeoutError) else exc.reason if isinstance(exc, ModelFailure) else "model_worker_exited"
            await self.close()
            raise ModelFailure(self.error) from exc

    async def close(self) -> None:
        self._ready = False
        if self.process is not None:
            if self.process.returncode is None:
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass
            await self.process.wait()
            self.process = None
