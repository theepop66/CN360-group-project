# Local LocateAnything implementation evidence — 2026-10-20

## What was implemented

- A project-owned resident model HTTP service with a checked native bridge.
  No annotated output images or per-Inspection CLI/model reloads are required.
- Explicit engine failure reporting, bounded concurrency, process isolation,
  readiness, prompt updates, deadline enforcement and expired-worker disposal.
- n8n HTTP/multipart fixes, Webhook body prompt handling, verified prompt update
  responses, and compact `pass` / `reject` / `error` responses before persistence.
  An evaluation error retains an internal reject Control Action.
- Valid Detection geometry stays available to coverage calculation, records and
  Pico. Coverage Threshold remains 0.005; confidence is not a decision signal.
- Validated local workflow configuration and reproducible build/test/probe tools.

## Real CPU model measurement

Source: [raw model comparison](locate-anything-cpu-2026-10-20.json).

Environment: Windows, Intel Core i5-11400H, 16 GB host RAM, Python 3.13.12,
LocateAnything q8 weights (6,259,931,712 bytes), six compute threads, hybrid
decode, CPU backend. The checked bridge used an AVX2 build. The existing CLI
binary and bridge are not guaranteed to share every compiler optimization, so
this comparison describes the deployed paths rather than isolating only model
loading. External source revision: `77376ab332de918220f7a7e391542eefb5407c9f`.

Input: upstream 448×448 parity image and its canonical cat/remote instruction.
Three CLI process launches and three predictions on one resident service were
measured. No warmup predictions were discarded.

| Path | Samples | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Existing CLI, model load included | 3 | 38.173 s | 39.589 s | 39.746 s |
| Resident HTTP, model already loaded | 3 | 22.971 s | 23.223 s | 23.251 s |

Server readiness, including initial model load, took 9.524 s. Resident p50 was
about 40% lower in this small run; it still exceeds the 1.2-second model budget
and the entire 3-second Verdict Window. These descriptive percentiles are not
a production latency distribution.

All six outputs had four Detections, with matching labels and coordinates to
within the CLI's two-decimal rounding (maximum coordinate difference below
0.005 pixels). This is a known-fixture compatibility check, not defect accuracy
validation on the project's products. Resident worker peak host working set
was about 6.05 GiB; GPU memory use was not measured. The raw report separates
Python image handling, native inference (including native preprocessing), and
HTTP timing.

Source: [real native HTTP boundary regression](native-model-boundary-2026-10-20.json).
An opt-in regression loaded the actual checked DLL and q8 model, returned the
four-box positive fixture, then returned successful empty detections for two
synthetic white 32×32 images using the same resident context. This exposed the
model's supported `<box>None</box>` representation; the bridge now accepts that
exact empty-box grammar while still rejecting malformed coordinate boxes.

The same regression uploaded a valid RLE8 BMP which Pillow can read but the
upstream native decoder does not support. The failure reached the native
`image_decode_failed` stage through public HTTP, returned HTTP 503 with
`inference_failed`, and left readiness unavailable. It was not converted into
successful empty output. These assertions use no inference mock and passed.

## Actual n8n runtime → actual model HTTP

Source: [raw runtime probe](n8n-real-model-probe-2026-10-20.json).

The existing container `n8n` runs n8n 2.6.4 and publishes port 5678. Direct HTTP
calls from that container reached `http://host.docker.internal:8000`:

- Health reported HTTP 200 and backend `cpu` after initialization.
- Prompt update and readback echoed the same instruction; blank update was 400.
- With the service's 1.1-second request budget, a real image returned HTTP 504
  with `model_timeout` after about 1131 ms as observed inside the container.
- Health then returned HTTP 503 with `model_timeout`: the expired native worker
  was not reused. Service restart is required to reload it.

This probe did not activate/import workflows, access a Pi, issue a servo command,
or contact a database/relay. Its service process was stopped after the probe.

## n8n graph/runtime contract evidence

Source: [CLI graph executions](n8n-runtime-fixtures-2026-10-20.json).

Disposable n8n 2.6.4 containers ran the generated workflow graphs against HTTP
fixtures for capture, model, storage, database, relay and actuator. For CLI
execution only, a temporary manual trigger replaced the entry point. Assertions
verified the original image bytes, multipart `file`, explicit Model Instruction,
Frame Context, compact output and outgoing action:

- Successful below-threshold result → `pass`, action `pass`.
- Successful above-threshold result → `reject`, action `reject`.
- Model error or model timeout → `error`, action `reject`.
- Prompt update → updated; blank target → rejected; failed model update → error.

Source: [public HTTP Webhook executions](n8n-webhook-fixtures-2026-10-20.json).
An isolated n8n server with a fresh SQLite database published only the test
copies of these two workflows. Real HTTP requests to the public inspection and
prompt webhooks verified the shipped trigger/response nodes and body envelopes.
Inspection outputs were `pass`, `reject`, and `error`; prompt HTTP statuses were
200 for update, 400 for blank input, and 502 for a failed model update. The
temporary server and its database were removed after testing. Fixtures are not
evidence of physical actuation, real Pi capture, database schema, credential
correctness, persistence or Pico delivery.

## GPU and unresolved deployment acceptance

The initial CUDA attempt stopped at `CUDA Toolkit not found`. In the subsequent
authorized GPU experiment, CUDA 12.6.3 and a compatible MSVC toolset were installed
locally on D:. The CUDA build and real q8 API evaluation now pass with backend
`CUDA0`: resident p50 **1.114 s**, p95 **1.268 s**, maximum **1.285 s**, with
5033 MiB sampled GPU-wide peak memory and no OOM or CPU fallback in the run.
This is about 20.6 times faster than the CPU resident p50 on the same fixture.
All four boxes match the CPU result exactly at the recorded precision. No
smaller quantization was selected, and product-defect accuracy remains separate.
See the [CUDA evaluation and raw evidence](locate-anything-cuda-2026-10-20.md).

The actual n8n container reached CUDA health/prompt endpoints, but its first
prediction still timed out under the unchanged 1.1-second service deadline.
The error was observed after 1236 ms; this does not meet the outer 1200 ms model
budget. The worker became unavailable rather than returning clean detections.

The real Pi, ESP32, Supabase schema/credentials and relay were not available as
confirmed runtime configuration for this work. Their production URLs were not
invented, existing user workflows were not activated, and no physical command
was sent. Local inactive workflow exports can be generated after those values
are supplied.

Automatic sorting is **not accepted**: the CUDA first prediction still misses
the deployed model deadline (as does the slower CPU path), and
firmware issue #24 still owns the 3000 ms auto-pass/late-verdict behavior. Issue
#25 still owns complete hardware acceptance. After a working CUDA/quantization
evaluation, if measured latency remains insufficient, consider a separate small
classifier experiment with labelled product images and explicit loss of the
current arbitrary text-target behavior. No replacement model was implemented.

## Verification and review

- n8n full suite: 191 passing tests.
- Model HTTP fixture/unit suite: 7 passing tests; strict mypy passes on the
  seven service modules. The external-weight native test is skipped by default.
- Opt-in real native HTTP regression: 1 passing test, covering positive output,
  repeated genuine empty output and native decode failure (about 51 seconds).
- Subsequent full Python suite with real CUDA native regression enabled:
  **8 passing tests** (13.93 seconds); strict mypy still passes. CUDA positive,
  repeated empty, and genuine native decode-error cases all pass. GPU resources
  were released after the experiment.
- Separate Standards/Spec review found no Standards findings. The Spec review
  identified missing genuine-native failure/empty acceptance evidence; the
  opt-in regression and empty-box compatibility fix resolve that finding.
- Subsequent CUDA follow-up review against `145a602`: Standards 0 actionable
  findings; Spec 0 actionable findings. The q8 evaluation completes local
  ticket 05 while ticket 06 and hardware/deadline acceptance remain partial.
