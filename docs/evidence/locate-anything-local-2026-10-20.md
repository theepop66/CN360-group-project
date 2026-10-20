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

A separate CUDA configure/build attempt was made. It stopped with
`Could not find nvcc` and `CUDA Toolkit not found`. No toolkit was installed as
part of this run. A working CUDA build, actual selected GPU, q8 working-set fit,
peak VRAM, smaller-quantization accuracy and GPU latency remain unverified.

The real Pi, ESP32, Supabase schema/credentials and relay were not available as
confirmed runtime configuration for this work. Their production URLs were not
invented, existing user workflows were not activated, and no physical command
was sent. Local inactive workflow exports can be generated after those values
are supplied.

Automatic sorting is **not accepted**: CPU latency misses the deadline, and
firmware issue #24 still owns the 3000 ms auto-pass/late-verdict behavior. Issue
#25 still owns complete hardware acceptance. After a working CUDA/quantization
evaluation, if measured latency remains insufficient, consider a separate small
classifier experiment with labelled product images and explicit loss of the
current arbitrary text-target behavior. No replacement model was implemented.
