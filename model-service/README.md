# Resident LocateAnything service

This adapter keeps one LocateAnything model in a worker process. It returns
Detection JSON, including pixel boxes, without generating an annotated image.
n8n derives the final `pass`, `reject`, or `error` result. Inspection Targets
remain configurable through text, and boxes remain available for Pico.

## Install and build

Use Python 3.11 or newer, CMake, and a C++17 compiler. The tested Windows
environment uses Python 3.13, Visual Studio C++ tools, and the external
locate-anything.cpp checkout at revision
`77376ab332de918220f7a7e391542eefb5407c9f`, with its ggml submodule initialized.
The existing external checkout is read and linked without changing its source.

From this directory, using the Python interpreter where the service will run:

```powershell
python -m pip install -e ".[test]"
python scripts/build_native.py --source D:\CN360\locate-anything.cpp --cpu-arch avx2
```

`--cpu-arch avx2` is suitable for the inspected i5-11400H. Omit it for the
portable CPU build. The script discovers Visual Studio on Windows and builds
the checked native bridge in a local ignored build directory. On other systems
it uses the installed compiler. No weights or binaries are committed.

For CUDA, install a compatible NVIDIA CUDA Toolkit and use the separate build:

```powershell
python scripts/build_native.py --source D:\CN360\locate-anything.cpp --cuda --cpu-arch avx2
```

The inspected PC has an RTX 3060 Laptop GPU with 6 GiB VRAM, but the CUDA build
attempt currently stops at `CUDA Toolkit not found`. A driver alone is not
enough. The q8 file is about 6.26 GB before graph/cache/runtime allocations; GPU
fit, peak VRAM, GPU latency, and smaller-quantization quality remain unverified.
Check the actual backend in `/health`; a requested GPU can fall back to CPU in
the upstream backend. Do not describe that fallback as a GPU benchmark.

## Start

Set these variables in the service's shell, then start one process:

```powershell
$env:CN360_MODEL_LIBRARY = "$PWD\native\build-cpu\cn360_model.dll"
$env:CN360_MODEL_PATH = 'D:\CN360\locate-anything.cpp\models\locate-anything-q8_0.gguf'
$env:CN360_MODEL_THREADS = '6'
$env:LA_DEVICE = 'cpu'
python -m cn360_model
```

Defaults: HTTP on port 8000, one worker, hybrid decode, 120-second model startup
limit, and a **1.1-second inference-request deadline** inside n8n's 1.2-second
model budget. The request deadline starts when the endpoint is entered after
multipart parsing and includes image validation/handling, pipe transfer, and
native compute. n8n's outer HTTP timeout also covers upload/network overhead.
Requests already in progress are never allowed to overlap on the native context.
Additional requests are rejected immediately with `model_busy`; there is no queue.

CPU q8 is not expected to meet that production deadline on this laptop. To
measure a slow model directly, use `CN360_MODEL_REQUEST_TIMEOUT=120` in a
**measurement-only** service and a sufficiently long HTTP client timeout. This
does not change the workflow budget or approve automatic sorting.

Additional local settings: `CN360_MODEL_BIND`, `CN360_MODEL_PORT`,
`CN360_MODEL_MODE` (`hybrid`, `slow`, `fast`), and
`CN360_MODEL_STARTUP_TIMEOUT`. Changing decode modes or quantization requires
comparing Detection/coverage/Verdict quality on representative images.

## Public HTTP contract

Open `http://localhost:8000/docs` to upload an image manually.

- `GET /health`: HTTP 200 only while the model process is available; includes
  actual `backend` and `busy`. Initialization failure or a dead worker is HTTP 503.
- `POST /predict`: multipart `file` (JPEG/PNG/BMP, up to 16 MiB and 24 million
  pixels) plus optional `prompt`. Successful results have `status: success`,
  `prompt_used`, `detections`, `frame_width`, `frame_height`, backend and timing
  diagnostics. Detection entries contain `label` and pixel `box`; no confidence
  is fabricated. An explicit prompt is captured for that request even if the
  global prompt subsequently changes.
- `GET /set_prompt?prompt=...`: set a nonblank Model Instruction; returns
  `status: updated` and `current_prompt`. Blank input returns HTTP 400.
- `GET /get_prompt`: read the current Model Instruction. This is in-memory
  state belonging to the single server process, not a database cache.

Failures return an appropriate HTTP error with `status: error` and a
machine-readable `reason`. They never return successful empty detections. The
checked bridge reports native preprocessing, vision, projector, decoding and
geometry failures explicitly; the original CLI can collapse these into empty
output. stderr retains native diagnostics, and Python logs the failed stage.

A timeout or client disconnect kills the isolated worker and makes health
unavailable. Restart the service to reload it. This deliberately prevents an
expired computation or a poisoned context from being reused. Shutdown also
releases the worker. No temporary image files are created by prediction.

## n8n connection

The inspected n8n instance is a Docker container serving port 5678. Use
`http://host.docker.internal:8000` **inside its workflow**, rather than the
container's loopback address. A direct Windows n8n process would use loopback;
another device uses the PC's LAN address. `0.0.0.0` is a bind address only.

Use the workflow configuration instructions in [the n8n guide](../n8n/README.md).
The capture path is Pi pull. The multipart field is `file` even though n8n's
internal binary property is named `image`.

The manual Inspection webhook returns `status` and `result`. Successful results
are `pass` below the Coverage Threshold and `reject` at or above it (default
0.005). An evaluation failure returns `status: error`, `result: error`, and
`reason`, while the existing actuator command remains `reject`. The caller
displays the result label; boxes and diagnostic data stay in the pipeline.
An Inspection result is not evidence that an ESP32 accepted the command or that
physical sorting occurred; Control Action acceptance is recorded separately.

## Verification and measurements

```powershell
python -m pytest
python -m mypy
```

The HTTP tests identify their controlled-model fixtures explicitly. They cover
prompt capture, repeated calls, corrupt/missing images, real worker startup
failure, inference failure, concurrency and timeout readiness. Real model runs
are recorded separately; automated fixtures do not establish model accuracy.

Run `scripts/benchmark.py --help` for the baseline/resident HTTP comparison.
Use the same input, prompt, thread count, model and decode mode. It records
startup, per-request/native timings, result geometry, failures, and descriptive
p50/p95/max. The first resident prediction is retained, not discarded as warmup.
Native timing includes native image preprocessing. On Windows, successful
predictions also report the worker's process peak working-set memory; this is
host RAM, not peak GPU VRAM. A three-sample smoke run is not a production latency
distribution or defect-quality validation.

Real-service and fixture evidence is kept under the project's documentation.
Pi/ESP32/database/relay acceptance remains separate. The current ESP32 can
auto-pass after 3000 ms: automatic sorting still depends on #24 and measured
end-to-end deadlines. Do not raise just the model timeout to bypass the budget.
