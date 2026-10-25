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

For CUDA, use a compatible Toolkit and host compiler. On this PC the Toolkit
and a supported VS 2022 C++ toolset were extracted from official NVIDIA/Microsoft
packages to **D:**. The existing VS installation still supplies the Windows SDK
and Ninja. Package URLs and verified SHA-256 values are recorded in
[the installation evidence](../docs/evidence/cuda-toolchain-2026-10-20.json).
The driver remains 566.07; no global PATH changes or driver update were needed.

Build from this directory using the installed Python environment:

```powershell
$env:TEMP = 'D:\CN360\toolchains\tmp'
$env:TMP = $env:TEMP
& 'D:\CN360\locate-anything.cpp\venv\Scripts\python.exe' scripts/build_native.py `
  --source D:\CN360\locate-anything.cpp --cuda --cpu-arch avx2 `
  --cuda-root D:\CN360\toolchains\cuda-12.6.3 `
  --msvc-tools D:\CN360\toolchains\msvc-14.38\VC\Tools\MSVC\14.38.33130 `
  --cuda-arch 86-real --build-dir D:\CN360\builds\resident-cuda --parallel 3 --with-cli
```

`86-real` targets the RTX 3060. Omit it to use the `native` architecture default
on the GPU present at build time. `--with-cli` builds the original CLI with the
same CUDA backend for comparison, sharing the compiled libraries. A standard
compatible Toolkit/compiler installation can omit the two custom root options.
Keep build directories separate when selecting a different compiler or backend.

The RTX 3060 Laptop GPU has 6 GiB VRAM. The q8 file is about 6.26 GB before
graph/cache/runtime allocations; an installed Toolkit alone does not establish
that its working set fits or that inference meets the deadline.
Check the actual backend in `/health`; a requested GPU can fall back to CPU in
the upstream backend. Do not describe that fallback as a GPU benchmark.

For the CUDA library, set these in addition to the model settings below:

```powershell
$env:CUDA_PATH = 'D:\CN360\toolchains\cuda-12.6.3'
$env:PATH = "$env:CUDA_PATH\bin;$env:PATH"
$env:CN360_MODEL_LIBRARY = 'D:\CN360\builds\resident-cuda\cn360_model.dll'
$env:LA_DEVICE = 'CUDA0'
```

The Python worker adds `CUDA_PATH\bin` to its Windows DLL dependency search
while loading the bridge. PATH also lets a matching CLI find the runtime DLLs.
Use these CUDA values after setting the model variables in the example below
and before launching Python; replace that example's CPU library/device values.

The [measured CUDA evaluation](../docs/evidence/locate-anything-cuda-2026-10-20.md)
used the unchanged q8/hybrid configuration: resident HTTP p50 1.114 s versus
22.971 s on CPU, with a 1.285 s first prediction and about 5033 MiB sampled peak
GPU memory. The first prediction still timed out under the production deadline
when called from n8n. Use CUDA for further measurement; these three samples do
not approve automatic sorting or changing the existing deadlines.

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

For CUDA, pass the matching CLI and library and `--device CUDA0` (or
`--device auto`) to the same benchmark. Use `--log-file` and `--output` on D:
to keep measurement artifacts there. The default is CPU. Check the reported
actual backend before comparing runs; requesting CUDA is not proof it was used.

The native empty-result/error regression is opt-in because it requires real
weights. Set `CN360_RUN_NATIVE_TESTS=1`, the same library/model environment
variables used for startup, and optionally `CN360_NATIVE_REPORT` to a JSON
output path, then run `python -m pytest tests/test_native_api.py`. It exercises
the real model through HTTP rather than substituting an inference fixture. Set
`CN360_NATIVE_POSITIVE_IMAGE` to the upstream parity image to include the
four-box cat/remote check before the repeated empty-image requests. The native
failure case is a valid RLE8 BMP supported by Pillow but rejected by the native
decoder; an unsupported BMP encoding is an explicit error, never a clean result.

Real-service and fixture evidence is kept under the project's documentation.
Pi/ESP32/database/relay acceptance remains separate. The current ESP32 can
auto-pass after 3000 ms: automatic sorting still depends on #24 and measured
end-to-end deadlines. Do not raise just the model timeout to bypass the budget.

## Measuring accuracy on real product photos

`scripts/evaluate_accuracy.py` answers "does the model catch real defects, and
how many good items does it throw out?" It needs labelled photos, not hardware:

```text
dataset/
  good/     items that should PASS      (aim for 20+ photos)
  defect/   items that should be REJECTED (aim for 20+ photos)
```

Start the service as usual (accuracy is separate from speed, so a
measurement-only `CN360_MODEL_REQUEST_TIMEOUT=120` is fine here), then:

```powershell
python scripts/evaluate_accuracy.py --dataset D:\CN360\dataset --target "scratch" `
  --output D:\CN360\evidence\accuracy.json --csv D:\CN360\evidence\accuracy.csv
```

The verdict uses the n8n rule exactly (Defect Coverage, reject at or above the
Coverage Threshold, default `0.005`); a test runs both implementations on the
same inputs. The report gives:

- **model_quality**: caught / missed defects, false rejects, catch rate,
  false reject rate, with errored images left out;
- **as_deployed**: the same with every error counted as a reject, as the line does;
- **sweep**: those figures at several thresholds;
- **recommended**: the highest threshold that still catches as many defects as
  any threshold can, then the fewest false rejects. It never suggests `0`
  (reject everything); if no threshold catches any defect it says so.

Photos should look like what the Pi camera sees on the line: same lighting box,
distance and background. The suggestion is only as good as the photos.
