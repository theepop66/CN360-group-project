"""Measure fresh production workers, then run the static-image n8n evaluation."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable


def request(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 125) -> tuple[int, dict[str, object]]:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def predict(url: str, image: Path, target: str) -> tuple[int, dict[str, object]]:
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="frame.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()
            + image.read_bytes()
            + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nLocate all the instances that matches the following description: {target}.\r\n--{boundary}--\r\n'.encode())
    return request(url + "/predict", data=body, headers={"Content-Type": "multipart/form-data; boundary=" + boundary})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--cuda-root", type=Path)
    parser.add_argument("--device", default="CUDA0")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=10)
    parser.add_argument("--startup-timeout", type=float, default=120)
    parser.add_argument("--max-side", type=int, default=0)
    parser.add_argument("--node", default="node")
    parser.add_argument("--workflow-export", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(root / "n8n/scripts/prepare-inspection-images.py"), "--assets", str(root / "test-assets/product-defects"), "--output", str(args.output), "--max-side", str(args.max_side)], check=True)
    cases = json.loads((args.output / "cases.json").read_text(encoding="utf-8"))
    cold: dict[str, object] = {"scope": "Fresh real model workers after representative warm-up, default 1100 ms admitted-request deadline; no hardware", "startupLimitSeconds": args.startup_timeout, "maxSide": args.max_side, "samples": []}
    samples: list[dict[str, object]] = []
    cold["samples"] = samples
    url = "http://127.0.0.1:8002"
    env = {**os.environ, "CN360_MODEL_LIBRARY": str(args.library.resolve()), "CN360_MODEL_PATH": str(args.weights.resolve()), "LA_DEVICE": args.device, "CN360_MODEL_PORT": "8002", "CN360_MODEL_THREADS": "6", "CN360_MODEL_STARTUP_TIMEOUT": str(args.startup_timeout)}
    env["CN360_MODEL_WARMUP_IMAGE"] = str(Path(cases[0]["file"]).resolve())
    if args.cuda_root:
        env["CUDA_PATH"] = str(args.cuda_root.resolve())
        env["PATH"] = str(args.cuda_root.resolve() / "bin") + os.pathsep + env["PATH"]
    # Refuse to take over an unrelated service.
    import socket
    with socket.socket() as port_probe:
        if port_probe.connect_ex(("127.0.0.1", 8002)) == 0:
            raise RuntimeError("Port 8002 already has a service; choose a clean test environment")

    def run_service(profile: str, timeout: str, action: Callable[[dict[str, object], float], None]) -> None:
        log_path = args.output / (profile + ".log")
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, "-m", "cn360_model"], cwd=root / "model-service", env={**env, "CN360_MODEL_REQUEST_TIMEOUT": timeout}, stdout=log, stderr=log, creationflags=0x08000000 if os.name == "nt" else 0)
            started = time.perf_counter()
            try:
                health: dict[str, object] = {}
                while time.perf_counter() - started < args.startup_timeout + 70:
                    if process.poll() is not None:
                        raise RuntimeError(f"Model service exited; see {log_path}")
                    try:
                        status, health = request(url + "/health", timeout=2)
                        if status == 200:
                            break
                        if health.get("reason") == "model_load_failed":
                            raise RuntimeError(f"Model failed to initialize; see {log_path}")
                    except (OSError, ValueError):
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Model readiness timeout")
                if args.device == "CUDA0" and health.get("backend") != "CUDA0":
                    raise RuntimeError("Requested CUDA0 but actual model backend differs")
                action(health, (time.perf_counter() - started) * 1000)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)

    for index in range(3):
        def measure(health: dict[str, object], startup_ms: float) -> None:
            start = time.perf_counter()
            status, body = predict(url, Path(cases[0]["file"]), cases[0]["target"])
            sample = {"restart": index + 1, "health": health, "startupMs": startup_ms, "httpStatus": status, "body": body, "elapsedMs": (time.perf_counter() - start) * 1000, "afterHealth": request(url + "/health")[1]}
            samples.append(sample)
            (args.output / "cold-start.json").write_text(json.dumps(cold, indent=2) + "\n", encoding="utf-8")
            print(f"Fresh worker {index + 1}: HTTP {status}, {body.get('reason', body.get('status'))}", flush=True)
        run_service(f"production-cold-{index + 1}", "1.1", measure)

    production_ready = all(sample["httpStatus"] == 200 for sample in samples)
    cold["productionWarmRun"] = "eligible" if production_ready else "blocked: fresh production worker did not complete its first prediction; diagnostic repetitions run separately"
    (args.output / "cold-start.json").write_text(json.dumps(cold, indent=2) + "\n", encoding="utf-8")
    # A diagnostic service cannot approve a production deadline. Keep its evidence separate.
    def evaluate(health: dict[str, object], startup_ms: float) -> None:
        mode = "real" if production_ready else "diagnostic"
        runner = [args.node, str(root / "n8n/scripts/static-inspection.mjs"), "--mode", mode, "--python", sys.executable, "--model-url", url, "--output", str(args.output / mode), "--repetitions", str(args.repetitions), "--max-side", str(args.max_side)]
        if args.max_side:
            runner += ["--direct-variants", "jpeg"]
        if args.workflow_export:
            runner += ["--workflow-export", str(args.workflow_export.resolve())]
        result = subprocess.run(runner, cwd=root, check=False)
        if result.returncode:
            raise RuntimeError(f"Static-image evaluation reported failures; inspect {args.output / mode / 'report.json'}")
    run_service("production-warm" if production_ready else "diagnostic-measurement-only", "1.1" if production_ready else "120", evaluate)


if __name__ == "__main__":
    main()
