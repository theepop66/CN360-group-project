"""Reproducible CLI/resident smoke benchmark; never actuates hardware."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import socket
import subprocess
import sys
import time

import httpx


def distribution(samples: list[float]) -> dict[str, float | int | None]:
    ordered = sorted(samples)
    def percentile(fraction: float) -> float | None:
        if not ordered:
            return None
        position = (len(ordered) - 1) * fraction
        low = math.floor(position)
        high = math.ceil(position)
        return ordered[low] + (ordered[high] - ordered[low]) * (position - low)
    return {"samples": len(samples), "p50_ms": percentile(0.5), "p95_ms": percentile(0.95), "max_ms": max(samples) if samples else None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--log-file", type=Path, help="Native/server log; defaults to benchmark.local.log")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--mode", choices=["hybrid", "slow", "fast"], default="hybrid")
    parser.add_argument("--device", default="cpu", help="cpu, auto, or an upstream backend name such as CUDA0")
    parser.add_argument("--prompt", default="Locate all the instances that matches the following description: person.")
    args = parser.parse_args()
    if args.samples < 1:
        parser.error("samples must be positive")
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", args.port)) == 0:
            raise SystemExit("Port already in use; use --port rather than stopping another service")
    image = args.image.read_bytes()
    env = {**os.environ, "LA_DEVICE": args.device, "CN360_MODEL_LIBRARY": str(args.library.resolve()),
           "CN360_MODEL_PATH": str(args.model.resolve()), "CN360_MODEL_THREADS": str(args.threads),
           "CN360_MODEL_MODE": args.mode, "CN360_MODEL_REQUEST_TIMEOUT": "120", "CN360_MODEL_PORT": str(args.port)}
    env["CN360_MODEL_WARMUP_IMAGE"] = str(args.image.resolve())
    env["CN360_MODEL_WARMUP_TIMEOUT"] = "120"  # Measurement initialization, never an admitted item budget.
    if args.device.lower() == "auto":
        env.pop("LA_DEVICE", None)
    root = Path(__file__).resolve().parents[1]
    report: dict = {"environment": {"platform": platform.platform(), "python": sys.version.split()[0],
                    "model_file": args.model.name, "model_bytes": args.model.stat().st_size, "image_sha256": hashlib.sha256(image).hexdigest(),
                    "image_bytes": len(image), "prompt": args.prompt, "threads": args.threads, "mode": args.mode,
                    "backend_requested": args.device}, "benchmark_only_timeout_seconds": 120,
                    "baseline": [], "resident": [], "errors": [],
                    "scope": "real model HTTP only; no Pi, ESP32, database or relay acceptance"}
    for index in range(args.samples):
        started = time.perf_counter()
        baseline = subprocess.run([str(args.cli), "detect", "--model", str(args.model), "--input", str(args.image),
                                   "--prompt", args.prompt, "--mode", args.mode, "--threads", str(args.threads)],
                                  env=env, capture_output=True, text=True, timeout=180)
        elapsed = (time.perf_counter() - started) * 1000
        if baseline.returncode:
            report["errors"].append({"stage": "baseline", "returncode": baseline.returncode, "detail": baseline.stderr[-10000:]})
        else:
            selected = re.search(r"la::Backend using device: (\S+)", baseline.stderr)
            report["baseline"].append({"request_ms": elapsed,
                                       "backend": selected.group(1) if selected else "cpu",
                                       "native_log": baseline.stderr[-10000:],
                                       **json.loads(baseline.stdout)})
        print(f"baseline {index + 1}: {elapsed:.1f} ms", flush=True)
    flags = 0x08000000 if os.name == "nt" else 0
    log_path = args.log_file or root / "benchmark.local.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    report["server_log"] = str(log_path.resolve())
    with log_path.open("w", encoding="utf-8") as log:
        server_started = time.perf_counter()
        server = subprocess.Popen([sys.executable, "-m", "cn360_model"], cwd=root, env=env, stdout=log, stderr=log, creationflags=flags)
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=125) as client:
                initialization_deadline = time.monotonic() + float(env.get("CN360_MODEL_STARTUP_TIMEOUT", "120")) + float(env["CN360_MODEL_WARMUP_TIMEOUT"]) + 10
                while time.monotonic() < initialization_deadline:
                    if server.poll() is not None:
                        raise RuntimeError(f"server exited; see {log_path}")
                    try:
                        health = client.get("/health", timeout=2)
                        if health.status_code == 200:
                            report["health"] = health.json()
                            break
                        if health.status_code == 503 and health.json().get("reason") not in {"model_loading", "model_warming"}:
                            report["health"] = health.json()
                            raise RuntimeError(f"model unavailable; see {log_path}")
                    except httpx.HTTPError:
                        pass
                    time.sleep(1)
                else:
                    raise RuntimeError("model did not become ready")
                report["startup_ms"] = (time.perf_counter() - server_started) * 1000
                print(f"resident ready: {report['health']}", flush=True)
                # Actual native error, separate from the HTTP image validator.
                prompt = client.get("/set_prompt", params={"prompt": args.prompt}).json()
                report["prompt_update"] = prompt
                report["blank_prompt_status"] = client.get("/set_prompt", params={"prompt": " "}).status_code
                report["invalid_image_status"] = client.post("/predict", files={"file": ("bad.png", b"not an image", "image/png")}).status_code
                for index in range(args.samples):
                    started = time.perf_counter()
                    result = client.post("/predict", files={"file": (args.image.name, image, "image/png")})
                    elapsed = (time.perf_counter() - started) * 1000
                    if result.status_code == 200:
                        report["resident"].append({"http_ms": elapsed, **result.json()})
                    else:
                        report["errors"].append({"stage": "resident", "http_ms": elapsed, "status": result.status_code, "body": result.json()})
                    print(f"resident {index + 1}: {elapsed:.1f} ms, HTTP {result.status_code}", flush=True)
        except Exception as exc:
            report["errors"].append({"stage": "server", "detail": str(exc)})
        finally:
            server.terminate()
            server.wait(timeout=20)
    report["baseline_total"] = distribution([row["request_ms"] for row in report["baseline"]])
    report["resident_http"] = distribution([row["http_ms"] for row in report["resident"]])
    if report["errors"]:
        report["server_log_tail"] = log_path.read_text(encoding="utf-8", errors="replace")[-20000:]
    report["note"] = "Small-sample descriptive percentiles; resident samples begin after the separately recorded startup/warm-up and include the first admitted prediction. Baseline total includes process/model startup. Native timing includes vision preprocessing and decode."
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "baseline": report["baseline_total"], "resident": report["resident_http"], "errors": len(report["errors"])}), flush=True)


if __name__ == "__main__":
    main()
