# Static-image inspection test plan

Date: 2026-10-26 (Asia/Bangkok). Status: planned; no tests have been run for this plan.

## Objective and ticket coverage

Use the 12 pictures in `test-assets/product-defects/` to evaluate the actual
LocateAnything model and the n8n inspection flow. Defer Raspberry Pi/camera
deployment (#22). Keep the production decision rules and deadlines unchanged.

| Ticket | Evidence this run should provide | Acceptance still requiring other work |
| --- | --- | --- |
| [#17](https://github.com/theepop66/CN360-group-project/issues/17) | Prompt updates, coverage/verdict decisions, failure handling, duplicate behavior, record and HUD contracts in real n8n executions | Real database/relay delivery if those services are unavailable; remaining ticket criteria |
| [#24](https://github.com/theepop66/CN360-group-project/issues/24) | Measured software timing, controlled timeout/late-response cases, firmware state-machine regressions, cross-item stale-verdict tests | Corrected fallback/correlation behavior and actual controller/physical-action timing |
| [#25](https://github.com/theepop66/CN360-group-project/issues/25) | Still-image integration through AI, verdict, storage/database and HUD, wherever real services are available | Real sensor/ESP32/servo/Pico checks and actual Pi capture/recovery criteria that are deferred |

The fixtures are substitutes for specific components. Passing against a fixture
proves the tested contract, not the substituted component's operation. Do not
close #24 or #25 from software-only results. Record actual service availability
at execution time rather than treating the older ticket descriptions as live health checks.

## Test arrangement

`Selected picture -> local /capture substitute -> real n8n -> real AI -> verdict receiver`

n8n also uses its existing snapshot, database, prompt and HUD delivery paths.
Begin with a recording verdict receiver so tests cannot move machinery. Add a
separate controller bench phase when the actual ESP32/servo is available.

Use an isolated n8n test instance with copies of the shipped workflows, separate
test data, and the schedule trigger disabled. Test both public inspection
webhooks and the prompt-update webhook. Keep the normal pull-ingestion path:
the inspection webhook is a trigger, not an image-upload endpoint.

The capture substitute must:

- Serve one selected, immutable image per test case at `/capture`; provide `/health`.
- Encode a JPEG once from each original PNG at quality 95, preserving dimensions
  and originals. Record original and served-image hashes and JPEG settings.
  This matches the workflow's current JPEG upload metadata. Direct-model
  exploration may use the originals, but compare it with the served JPEG too.
- Supply all five actual capture headers: `X-Camera-Session`, `X-Frame-Sequence`,
  `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height`.
- Increment sequence for normal inspections, even when reusing the same picture;
  freeze session/sequence only for deliberate duplicate cases. Change session
  on simulated restart. Timestamp each served capture.
- Support missing/corrupt images, invalid headers, delayed responses and offline
  behavior. Log the exact bytes/hash served to each execution.
- Bind a case to an execution before triggering it. For concurrency tests, use
  an explicit request-to-frame mapping so switching a global image cannot mix cases.

Do not reuse `n8n/scripts/runtime-smoke.mjs` unchanged as accuracy evidence.
Its model endpoint returns scripted detections, and its capture headers currently
claim 448 x 448 for every supplied picture. Reuse the isolated-runtime approach,
but separate the real-model mode from fault-injection mode and use actual dimensions.
Keep new outputs separate from the existing dated evidence files.

## Fixed baseline and expected outcomes

Record the Git revision, workflow export hash, n8n version, actual model backend,
model/weights revision, decode mode, service settings and machine configuration.
Verify reachability from inside the n8n runtime. Use the documented Docker host
address when appropriate. Keep secrets out of exports and evidence.

Current code defines:

- Coverage threshold: `0.005` (0.5%).
- n8n model HTTP timeout: 1200 ms; model-service default request deadline: 1100 ms.
- Controller Verdict Window: 3000 ms.
- Nominal pre-verdict timeouts including the verdict POST: 2800 ms total
  (prompt 250 + capture 800 + snapshot upload 300 + model 1200 + verdict POST 250).

The older #17 description contains different timeout/ordering assumptions.
Test the current implementation and report that discrepancy explicitly:
snapshot upload currently occurs before inference/verdict and consumes deadline budget.
Do not increase timeouts or change thresholds to make a test pass.

Judge three things independently:

1. **Detection quality:** did boxes identify the requested defect, and were there
   false detections on the matching normal control? Review boxes against the
   supplied masks; a box around the whole product is not automatically a correct
   defect localization. Record image-level misses/false positives and example overlays.
2. **Decision correctness:** calculate coverage independently from returned boxes:
   summed box area / actual frame area, clamped to [0, 1]. Below 0.005 is pass;
   at/above is reject. Small real defects may correctly produce a workflow pass
   under this policy; report the detection and the policy outcome separately.
3. **Failure behavior:** an evaluation failure produces an error response and an
   internal reject command. This does not prove the controller accepted it.
   A compact successful inspection response also does not prove storage or HUD delivery.

No confidence threshold is used. Freeze prompts and settings after exploration;
report the 12-picture set as a smoke evaluation, not general model validation.

## Execution order

### 1. Baseline and controlled workflow checks — #17

Run the existing n8n tests and check generated workflow consistency without
leaving unrelated generated changes. Record firmware host-test results separately:
the existing timeout test expects auto-pass, so a green baseline does not satisfy #24.

Use the actual n8n webhooks with controlled model responses for deterministic checks:

| Case | Expected result/evidence |
| --- | --- |
| Empty detections | Coverage 0, successful pass, pass command |
| Coverage just below / exactly at / above 0.005 | Pass / reject / reject; all valid boxes retained |
| Overlapping boxes summing beyond the image area | Coverage clamps to 1; reject |
| Blank target; whitespace/trailing punctuation | Blank rejected; canonical instruction stable for equivalent valid inputs |
| Target changes; model prompt update fails; echoed prompt differs | Confirm set/get/explicit predict prompt; failed update reported; echo mismatch recorded |
| Model unreachable, HTTP error, malformed JSON, missing status, error status, invalid boxes | Error classification and internal reject; reason recorded; no fabricated successful empty detections |
| Capture unavailable/corrupt; missing or invalid frame headers | Error/reject path, with no silent pass |
| Invalid configured threshold or impossible timeout budget | Rejected configuration/evaluation according to current contract |
| Duplicate same session/sequence within 3000 ms | Verdict sent again; duplicate record/HUD suppressed and suppression logged; receiver ignores repeat application |
| Same bytes with new sequence; new session with sequence reset | New inspection; distinguish it from a duplicate; no stale HUD frame |
| Model/source health down -> still down -> up | Watchdog logs transitions, not repeated identical states |

Include a valid binary multipart upload using model field `file`, n8n binary
property `image`, explicit canonical instruction, correct dimensions and valid pixel boxes.
Check prompt-history and inspection/control/system-log row contracts without
using prompt history as the model's runtime source of truth.

### 2. Real-model picture evaluation — #17, supporting #25

Start with `bottle__broken_large__000.png` and `bottle__good__000.png`.
Then run all cases from the asset manifest using the matching inspection targets.
The 12 files produce 15 image/target cases: eight defective cases and seven
normal-control/target combinations. Each normal control is tested with every
target used for that product.

Run each case once directly against the real model and once through n8n to
isolate inference from integration failures. Review the original PNG and served
JPEG outputs where their detections differ. Freeze the resulting test protocol,
then run 10 sequential measured repetitions per case: 150 warm n8n inspections.
Do not force the expected verdict from the dataset's defective/normal label.

The resident service can terminate its worker after a timeout. Record that
failure and recovery, restart/recheck readiness when required, and mark the next
prediction as post-restart rather than warm. Never replace a failed sample with
an unreported retry.

If the production deadline prevents real detections, preserve that failed run.
A separate measurement-only service with a longer deadline may diagnose model
quality. Label those results separately; they do not satisfy the production deadline.

### 3. Timing, concurrency and late verdicts — #24

Measure the first prediction after each of three service restarts separately
from the 150 warm runs. Do not silently exclude first-request failures.

For each execution record capture duration, prompt request, snapshot upload,
model HTTP duration, reported inference time, decision time, verdict send/receipt,
webhook response and post-response completion. Use a monotonic clock for elapsed
times within one observer. Do not subtract unsynchronized host/controller clocks.

Report count, successes, timeouts, other failures, p50, p95, maximum and deadline
misses, by case and overall. Preserve timeout observations as censored/failed
requests rather than omitting them from a misleading success-only summary.
Software latency starts at webhook receipt; actual sensor-to-action timing is
a separate bench measurement. Receipt at a stub is not ESP32 acceptance.

| Injection | Required observation |
| --- | --- |
| Controlled inference well below / near / above 1100 and 1200 ms | Establish which service/workflow deadline fires; retain actual timings and reasons |
| Verdict receipt around 2900 / 3000 / 3100 ms from item entry | Establish before/at/after expiry behavior; use virtual-time firmware tests for exact boundaries |
| Model finishes after n8n has timed out | Expired success cannot cause a second command or overwrite the rejected/failed result |
| Two and five concurrent triggers | Correct frame/prompt ownership; busy/reject behavior visible; no overlapping use of a single native context |
| Repeated duplicate and reordered deliveries | No repeat physical effect; no stale HUD replacement |
| Item A expires; item B enters AwaitingVerdict; A's late pass/reject arrives | A must not determine B's outcome; test both opposite verdict combinations |
| n8n stopped, source offline, model offline/slow, verdict route disconnected | Desired safe fallback and recovery; a simulated reject attempt alone cannot prove physical fallback |

Use a delayed verdict-delivery proxy or direct controller state tests to reach
the 3-second boundary. Delaying only `/predict` should hit the earlier model
timeout and does not by itself exercise the late-verdict condition.

Add desired-behavior firmware regressions for timeout fallback and the item A/B
case, keeping their results distinct from current-behavior baseline tests.
The current action-only verdict message has no item correlation field; expose
the resulting limitation instead of teaching a fixture to reject stale items
using metadata that the real firmware never receives. A fallback/correlation
fix is implementation work under #24, followed by rerunning these cases.

### 4. Integration acceptance with still-image input — #25

Run real n8n + real model against real test database/storage and relay/HUD when
available. Verify the saved snapshot is the served JPEG, inspection and control
rows link correctly, and target/prompt/coverage/frame identity agree end to end.
Wait for the execution to finish: the compact webhook response is sent before
database/relay work completes.

For the HUD, verify pixel boxes against the source image at different display
sizes, all detections remain visible below the rejection threshold, reconnect
works, and old/out-of-order session frames do not replace newer ones. A parser
check or HTTP recording endpoint proves a contract only; actual relay/Pico
delivery needs its own evidence. Missing relay (#7) or schema (#26) is recorded
as blocked acceptance, not a passed substitute.

Inject database, snapshot and relay failures and recovery separately. Confirm
their observed effects and logs, including snapshot upload time before verdict.
A later storage/relay error does not retroactively change the already returned
inspection decision. Confirm actuator rejection/offline responses are represented
truthfully in Control Action records even if the inspection decision succeeded.

When bench hardware is available, retain the same picture-source substitute
and test real IR event -> n8n -> AI -> ESP32 acceptance -> servo/LED/counter,
then database and Pico. Begin without mechanical load. Exercise both verdicts,
duplicates, missing verdicts and stale A/B cases, with a shared trace/video or
controller-local timing for sensor-to-action measurements. This advances #25
while camera deployment remains deferred. Actual Pi image capture and restart/
network recovery remain outstanding acceptance evidence.

## Evidence and completion criteria

Create a new timestamped folder under `docs/evidence/static-image-inspection/`
with a run manifest, per-case results, n8n execution IDs/exports, request/response
logs with secrets removed, detection overlays, timing summary and integration
status per real or substituted service. Attach video only for bench/Pico checks.

Each case records: run/case ID, ticket, source/served-image hashes, target,
instruction, model backend, session/sequence, dimensions, detections, coverage,
expected policy result, actual response, command, receiver/controller acceptance,
timestamps, persistence/HUD status, and an explicit pass/fail/blocked/deferred label.

The software run is complete when every planned case has a recorded outcome,
all decision/contract assertions are assessed, model quality and timing are
reported separately, and failures have reproducible evidence. A completed run
may expose failed acceptance; it does not imply all tickets can close.

Keep #24 open until its desired fallback/correlation and hardware criteria pass.
Keep #25 open for deferred hardware/Pi criteria. Assess #17 against all its
remaining real-service requirements.
