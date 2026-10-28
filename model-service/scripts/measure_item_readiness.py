"""Measure real worker warm-up, admitted predictions and recovery over local HTTP."""
import argparse
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import sys
import time
from typing import Any

import httpx
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cn360_model.app import create_app


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--cuda-root", type=Path)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--integrated", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    cases: list[dict[str, Any]] = json.loads(args.cases.read_text(encoding="utf-8"))
    selected = [next(c for c in cases if c["id"].startswith("bottle__good")), next(c for c in cases if c["hasDefect"]), next(c for c in cases if c["id"].startswith("capsule__good"))]
    url = "http://127.0.0.1:8002"
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8002)) == 0:
            raise RuntimeError("Port 8002 is occupied; refusing to take over a service")
    os.environ.update(CN360_MODEL_LIBRARY=str(args.library.resolve()), CN360_MODEL_PATH=str(args.weights.resolve()),
                      CN360_MODEL_REQUEST_TIMEOUT="1.1", CN360_MODEL_STARTUP_TIMEOUT="300", LA_DEVICE="CUDA0", CN360_MODEL_THREADS="6")
    if args.cuda_root:
        os.environ["CUDA_PATH"] = str(args.cuda_root.resolve())
    report: dict[str, Any] = {"scope": "Actual CUDA resident worker through local HTTP; original-geometry JPEG test pictures, 1100 ms production request deadline. No hardware/accuracy acceptance.",
                              "warmupImage": selected[0]["id"], "requestTimeoutMs": 1100, "workers": [], "attempts": []}

    def save() -> None:
        (output / "model-readiness.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    async with httpx.AsyncClient(timeout=5) as client:
        async def ready() -> dict[str, Any]:
            async with asyncio.timeout(370):
                while True:
                    try:
                        response = await client.get(url + "/health")
                        if response.status_code == 200:
                            health: dict[str, Any] = response.json()
                            if health.get("backend") != "CUDA0":
                                raise RuntimeError("Requested CUDA0 but backend differs")
                            return health
                        if response.json().get("reason") in {"model_load_failed", "model_warmup_failed", "model_warmup_timeout", "model_warmup_image_missing"}:
                            raise RuntimeError("Initialization failed: " + response.text)
                    except httpx.TransportError:
                        pass
                    await asyncio.sleep(0.1)

        for restart in range(3):
            app = create_app(warmup_image=Path(selected[0]["file"]).read_bytes())
            server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8002, access_log=False, log_level="warning"))
            serving = asyncio.create_task(server.serve())
            started = time.perf_counter()
            worker: dict[str, Any] = {"restart": restart + 1}
            report["workers"].append(worker)
            try:
                worker["health"] = await ready()
                worker["startupAndWarmupMs"] = (time.perf_counter() - started) * 1000
                for case in selected:
                    admission_health = await ready()
                    data = Path(case["file"]).read_bytes()
                    attempt: dict[str, Any] = {"restart": restart + 1, "caseId": case["id"], "width": case["width"], "height": case["height"],
                                               "sha256": hashlib.sha256(data).hexdigest(), "readyBefore": admission_health}
                    report["attempts"].append(attempt)
                    before = time.perf_counter()
                    try:
                        response = await client.post(url + "/predict", files={"file": ("frame.jpg", data, "image/jpeg")},
                                                     data={"prompt": f'Locate all the instances that matches the following description: {case["target"]}.'})
                        attempt.update(httpStatus=response.status_code, body=response.json())
                    except httpx.HTTPError as exc:
                        attempt["error"] = str(exc)
                    attempt["elapsedMs"] = (time.perf_counter() - before) * 1000
                    attempt["healthAfter"] = (await client.get(url + "/health")).json()
                    save()
                    print(f'worker {restart + 1} {case["id"]}: {attempt.get("httpStatus", "transport error")}', flush=True)
                if args.integrated and restart == 2:
                    await ready()
                    child = await asyncio.create_subprocess_exec(args.node, str(root / "n8n/scripts/item-deadline-inspection.mjs"),
                        "--python", sys.executable, "--real-model-url", url, "--output", str(output / "integrated"), cwd=root,
                        creationflags=0x08000000 if os.name == "nt" else 0)
                    worker["integrationExitCode"] = await child.wait()
            except (RuntimeError, TimeoutError) as exc:
                worker["error"] = str(exc)
                print(f"worker {restart + 1}: {exc}", flush=True)
                save()
            finally:
                server.should_exit = True
                await serving
    groups = {case["id"]: [a for a in report["attempts"] if a["caseId"] == case["id"]] for case in selected}
    report["perCase"] = {}
    for case_id, attempts in groups.items():
        durations = sorted(a["elapsedMs"] for a in attempts)
        report["perCase"][case_id] = {"count": len(attempts), "errors": sum(a.get("httpStatus") != 200 for a in attempts),
            **{name: durations[max(0, math.ceil(p * len(durations)) - 1)] if durations else None for name, p in [("p50Ms", 0.5), ("p95Ms", 0.95), ("maxMs", 1)]}}
    report["productionTiming"] = "passed sampled requests only" if len(report["attempts"]) == 9 and all(a.get("httpStatus") == 200 for a in report["attempts"]) else "failed or incomplete"
    save()
    if any(w.get("error") or w.get("integrationExitCode", 0) for w in report["workers"]):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
