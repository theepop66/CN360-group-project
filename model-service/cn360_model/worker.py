"""One engine in one disposable worker, so deadlines can stop native compute."""

import base64
import json
import os
import sys
import time

from .native import NativeModel
from .memory import peak_working_set_bytes


def main() -> int:
    started = time.perf_counter()
    try:
        model = NativeModel(os.environ["CN360_MODEL_LIBRARY"], os.environ["CN360_MODEL_PATH"], int(os.environ.get("CN360_MODEL_THREADS", "0")))
    except Exception as exc:
        print(json.dumps({"status": "error", "reason": "model_load_failed", "detail": str(exc)}), flush=True)
        return 1
    print(json.dumps({"status": "ready", "backend": model.backend, "startup_ms": (time.perf_counter() - started) * 1000}), flush=True)
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                data = base64.b64decode(request["image"], validate=True)
                started = time.perf_counter()
                result = model.predict(data, request["prompt"], os.environ.get("CN360_MODEL_MODE", "hybrid"))
                result.update(status="success", backend=model.backend, timings_ms={"inference": (time.perf_counter() - started) * 1000})
                result["peak_working_set_bytes"] = peak_working_set_bytes()
                print(json.dumps(result, allow_nan=False), flush=True)
            except Exception as exc:
                print(json.dumps({"status": "error", "reason": "inference_failed", "detail": str(exc)}), flush=True)
                return 1
    finally:
        model.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
