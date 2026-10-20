"""Readiness/prompt/deadline probe from the user's actual Docker n8n runtime.

Does not import/activate workflows or send an actuator command.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docker", required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8000)) == 0:
            raise SystemExit("Port 8000 already used; stop only the service you own before probing")
    root = Path(__file__).resolve().parents[1]
    env = {**os.environ, "LA_DEVICE": "cpu", "CN360_MODEL_LIBRARY": str(args.library.resolve()),
           "CN360_MODEL_PATH": str(args.model.resolve()), "CN360_MODEL_THREADS": "6", "CN360_MODEL_REQUEST_TIMEOUT": "1.1"}
    script = """
const { performance } = require('node:perf_hooks');
const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
(async () => {
  const base = 'http://host.docker.internal:8000';
  const read = async path => { const response = await fetch(base + path, {signal: AbortSignal.timeout(5000)}); return {http_status: response.status, body: await response.json()}; };
  const health = await read('/health');
  const instruction = 'Locate all the instances that matches the following description: cat</c>remote.';
  const set = await read('/set_prompt?prompt=' + encodeURIComponent(instruction));
  const get = await read('/get_prompt');
  const blank = await read('/set_prompt?prompt=%20');
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(input.image, 'base64')], {type:'image/png'}), 'frame.png');
  form.append('prompt', instruction);
  const started = performance.now();
  const response = await fetch(base + '/predict', {method:'POST', body:form, signal:AbortSignal.timeout(5000)});
  const prediction = {http_status:response.status, body: await response.json(), http_ms:performance.now()-started};
  const after = await read('/health');
  console.log(JSON.stringify({health, set, get, blank, prediction, after}));
})().catch(error => { console.error(error.message); process.exit(1); });
"""
    with (root / "runtime-probe.local.log").open("w", encoding="utf-8") as log:
        server = subprocess.Popen([sys.executable, "-m", "cn360_model"], cwd=root, env=env, stdout=log, stderr=log, creationflags=0x08000000 if os.name == "nt" else 0)
        try:
            with httpx.Client(timeout=2) as client:
                for _ in range(120):
                    if server.poll() is not None:
                        raise RuntimeError("server stopped during startup")
                    try:
                        if client.get("http://127.0.0.1:8000/health").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(1)
                else:
                    raise RuntimeError("model startup timeout")
            result = subprocess.run([args.docker, "exec", "-i", "n8n", "node", "-e", script], input=json.dumps({"image": base64.b64encode(args.image.read_bytes()).decode("ascii")}), capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise RuntimeError(result.stderr)
            report = json.loads(result.stdout)
            report["scope"] = "Direct HTTP from existing n8n Docker runtime; no workflow activation, Pi, actuator, DB, or relay access"
            assert report["health"]["http_status"] == 200
            assert report["set"]["body"]["current_prompt"] == report["get"]["body"]["current_prompt"]
            assert report["blank"]["http_status"] == 400
            assert report["prediction"]["http_status"] == 504
            assert report["prediction"]["body"]["reason"] == "model_timeout"
            assert report["after"]["http_status"] == 503
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(report), flush=True)
        finally:
            server.terminate()
            server.wait(timeout=20)


if __name__ == "__main__":
    main()
