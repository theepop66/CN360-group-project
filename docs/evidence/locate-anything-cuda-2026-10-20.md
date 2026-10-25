# CUDA / RTX 3060 evaluation — 2026-10-20

## Local installation on D:

CUDA 12.6.3 components required by this project (NVCC, CUDA runtime, cuBLAS,
CCCL) are installed as extracted official NVIDIA redistributable archives at
`D:\CN360\toolchains\cuda-12.6.3`. A compatible VS 2022 v143 compiler toolset
(MSVC 19.38.33145) is extracted from official Microsoft packages at
`D:\CN360\toolchains\msvc-14.38`. The existing Visual Studio installation on C:
provides the Windows SDK, build-environment setup, and Ninja. Its newer compiler
is not used for this CUDA build.

The GPU driver remains 566.07. No administrator installation, driver update,
or global PATH change was required. Downloads, extraction, CUDA build outputs,
logs, and the experiment's temporary files are on D:. Existing project sources
and small tracked evidence files remain in the repository on C:.

See [installation evidence](cuda-toolchain-2026-10-20.json) for component URLs,
SHA-256 verification, versions, and the real GPU kernel/copyback probe result.
The [NVIDIA Windows guide](https://docs.nvidia.com/cuda/archive/12.6.3/cuda-installation-guide-microsoft-windows/index.html)
documents the supported MSVC family and manual extraction approach. Licenses
remain alongside the extracted Toolkit components.

The standalone smoke program compiled with NVCC and MSVC, found the RTX 3060
Laptop GPU (compute capability 8.6), allocated device memory, ran a CUDA kernel,
and verified the copied-back values. This establishes toolchain/GPU operation;
model evaluation is recorded separately below.

## Reproduce the build and service configuration

Use the exact D-drive build and CUDA environment examples in the
[service guide](../../model-service/README.md). The build uses Release, AVX2
for CPU operations, `86-real` for CUDA, and the pinned existing upstream source
`77376ab332de918220f7a7e391542eefb5407c9f`. The optional `--with-cli` target links
the original upstream CLI against the same compiled CUDA/CPU libraries as the
resident bridge. The installed external checkout's tracked source is unchanged.

Build: `D:\CN360\builds\resident-cuda`.
Native library: `D:\CN360\builds\resident-cuda\cn360_model.dll`.
Matching CLI: `D:\CN360\builds\resident-cuda\upstream-cli\locate-anything-cli.exe`.
Temporary files: `D:\CN360\toolchains\tmp`.

Set `CUDA_PATH` for the worker's Windows DLL search and add its `bin` directory
to PATH when invoking the CLI. Use `LA_DEVICE=CUDA0` and verify actual readiness
reports that backend; CPU fallback is not a successful GPU evaluation.

After setting the CUDA/TEMP variables from the service guide, reproduce the
same measurement from the repository root:

```powershell
& 'D:\CN360\locate-anything.cpp\venv\Scripts\python.exe' model-service/scripts/benchmark.py `
  --cli D:\CN360\builds\resident-cuda\upstream-cli\locate-anything-cli.exe `
  --library D:\CN360\builds\resident-cuda\cn360_model.dll `
  --model D:\CN360\locate-anything.cpp\models\locate-anything-q8_0.gguf `
  --image D:\CN360\locate-anything.cpp\tests\fixtures\parity_image.png `
  --prompt 'Locate all the instances that matches the following description: cat</c>remote.' `
  --device CUDA0 --threads 6 --mode hybrid --samples 3 `
  --output D:\CN360\evidence\locate-anything-cuda-q8-repeat.json `
  --log-file D:\CN360\toolchains\cuda-repeat.log
```

For memory sampling, run `nvidia-smi --id=0 --query-gpu=timestamp,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits --loop-ms=100`
alongside the benchmark and save its output on D:. Stop that monitor afterward.

## Measured model results

Source: [raw CUDA comparison and GPU sampling summary](locate-anything-cuda-q8-2026-10-20.json).
Unchanged q8 weights (6,259,931,712 bytes), hybrid decode, six CPU threads,
448×448 upstream parity image (SHA-256 in the JSON), and the canonical
cat/remote instruction used for the CPU baseline. Three separate CLI launches
and three successive predictions on one resident service were measured. All
requests, including each path's first prediction, are retained. The benchmark's
120-second request timeout is measurement-only.

| Path | Samples | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Previous CPU resident HTTP | 3 | 22.971 s | 23.223 s | 23.251 s |
| Matching CUDA CLI, including model/process load | 3 | 15.059 s | 25.663 s | 26.841 s |
| CUDA resident HTTP | 3 | 1.114 s | 1.268 s | 1.285 s |

Resident samples: **1285.119, 1114.317, 1067.424 ms**. Initialization to service
readiness took **13.133 s**. All three CLI and all three resident samples used
`CUDA0`; there were no errors or OOMs in this measurement run. Resident p50 was
about **20.6 times faster** than the earlier CPU configuration on this fixture.
These are descriptive percentiles from three samples, not production tail
latency or a speed guarantee. CPU used MSVC 19.51 while the CUDA configuration
uses supported MSVC 19.38; this compares deployed configurations rather than
isolating only the effect of CUDA. The matching CUDA CLI and bridge share the
same compiled libraries.

All six CUDA outputs had the same four labels/boxes as the CPU fixture. All
three resident results matched the CPU coordinates exactly at the recorded
precision. Summed/clamped Defect Coverage was **0.7913170086209392**, yielding
`reject` at the unchanged 0.005 threshold for both configurations. This fixture
is cat/remote compatibility evidence, not accuracy validation for product
defects. No smaller quantization was created or selected, and generation mode,
Coverage Threshold, confidence policy and output contract remain unchanged.

GPU-wide `nvidia-smi` sampling at a nominal 100 ms interval (632 samples) found
**5033 MiB peak dedicated memory used**, **964 MiB minimum free**, and **96%
maximum utilization**. Sampling covered CLI loading/prediction and resident
loading/prediction. It can miss shorter spikes, is not process-exclusive, and
does not measure WDDM shared host memory. The resident worker's maximum reported
host peak working set was **6,783,979,520 bytes** (about 6.32 GiB). The native log
confirms 768 weights offloaded to CUDA0 and two host-read tensors retained on
CPU. This observed run succeeded on the 6 GiB GPU without assuming that the
entire GGUF file must be stored there.

The raw GPU CSV and full native/build logs remain under
`D:\CN360\toolchains`. The raw benchmark JSON also remains under
`D:\CN360\evidence`; the repository holds a copy for review.

## n8n reachability and unchanged deadline

Source: [actual n8n container probe](n8n-cuda-probe-2026-10-20.json).

The existing n8n container reached the resident GPU service through
`http://host.docker.internal:8000`. Health reported CUDA0; prompt set/readback
matched, and blank input remained HTTP 400. With the production **1.1-second
service deadline**, the first prediction returned HTTP 504 `model_timeout`,
observed after **1235.877 ms** from the container, and subsequent health returned
503. The timed-out worker was stopped rather than reused. The probe's client
waited up to five seconds to observe the error; this was not a successful
execution within n8n's 1200 ms model budget.

The first measurement-only prediction (1285 ms) exceeds even the outer model
budget. These results do **not** pass the production deadline. The default
service deadline, n8n budget and firmware Verdict Window were not increased.
The probe did not import or activate workflows, fetch a real Pi frame, write a
database, contact a relay or send a physical actuator command.

## Native regression and recommendation

Source: [real native CUDA boundary regression](native-cuda-boundary-2026-10-20.json).
The complete Python suite passed with the real CUDA native test enabled:
**8 passed**; strict mypy passed on all seven service modules. The real CUDA
worker returned the expected positive boxes, successfully returned empty output
twice while reusing the context, and exposed a genuine native decode failure as
an error followed by unavailable health. It did not turn that failure into an
empty successful inspection. Separate Standards and Spec review is recorded in
the implementation summary.

### Standards

0 actionable findings in the CUDA follow-up review against `145a602`.

### Spec

0 actionable findings. Ticket 05 covers the completed unchanged-q8 GPU
evaluation; production deadline and hardware acceptance remain separate.

For further manual measurement, use **q8 + CUDA0 + resident service + hybrid**
with the D-drive library and an explicitly measurement-only 120-second timeout.
Keep the existing CPU build as a documented fallback for environments without
CUDA; its measured latency is slower. There is no reason from this memory run
to change quantization just to make q8 start. Smaller quantization would require
a separately declared comparison on normal and defective product images before
adoption; no claim about its quality is made here.

For production, first investigate readiness warmup and latency variation with
representative images and repeated end-to-end measurements. If considering a
smaller LocateAnything quantization, preserve prompt/boxes and validate product
quality before selection. A small fixed-target classifier remains a separate
possible experiment requiring labelled normal/defect images, validation criteria
for missed defects and false rejects, and explicit acceptance of losing the
current arbitrary text-target/box behavior. This work does not implement either
model change. Local ticket 05 records the completed q8 CUDA evaluation; ticket 06
and GitHub #23/#24/#25 still need their runtime/hardware acceptance. Firmware's
3000 ms auto-pass and late-verdict work in #24 remains unresolved.

All experiment servers/workers were stopped afterward. GPU memory returned to
the pre-test reading (0 MiB used, 5996 MiB free); CUDA remains installed on D:.
