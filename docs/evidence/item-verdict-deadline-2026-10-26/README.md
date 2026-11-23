# Ticket 07 implementation evidence — 26 October 2026

The software now binds Verdicts to the controller session/item, rejects on local
expiry, and distinguishes command acceptance from fallback actions. Manual
picture checks without an active item are observational. Snapshot upload follows
the Verdict attempt, and model readiness includes representative warm-up and
rewarm after worker loss. Firmware admission remains disabled by default pending
physical reject/retention validation.

**Ticket 07 is partial: software implemented; production timing failed and
physical acceptance remains blocked.** No device was flashed or operated and
the existing localhost:5678 workflows were not modified or activated.

## Verification

| Check | Evidence/result |
| --- | --- |
| Controller host behavior | 135 checks passed; actual firmware core, deterministic virtual time |
| Original deadline/stale-A probe | All five desired-behavior cases pass |
| Integrated picture flow | 26/26 passed in `integrated-controller.json`; real disposable n8n and actual controller core through the host HTTP adapter |
| Controlled orchestration | 37 cases passed in the recorded run; prompt, health, coverage and failure contracts |
| Full n8n suite | 204 passed |
| HUD suites | 44 and 33 passed |
| Full model-service suite | 13 passed, including the real native GPU HTTP test; no skipped native test |
| Strict type checking | Model package and readiness measurement helper: eight source files passed |
| ESP32 build | Passed with default admission disabled; build log retained |
| Existing benchmark compatibility | Real CLI/resident regression completed with zero errors after waiting through background warm-up |
| Code review | Standards and Spec findings corrected; zero remaining findings on focused re-review |

The integrated cases cover timely pass/reject, exact expiry before a timer tick,
late A during B, previous boot, duplicates/concurrent delivery, same-frame
different-item records, missing identity, paired/unpaired manual checks, model
and capture failures, slow/offline storage, lost/legacy/mismatched replies,
acknowledgement identity in audit records, and local fallback. Counters and
emitted servo/feedback actions are checked in addition to HTTP responses.
Snapshot uploads also assert the actual object pathname against the originating
execution's captured frame, so reported URLs cannot silently point at another key.

The controller's clock is virtual. This verifies deadline logic and once-only
resolution, not ESP32 scheduling, sensor-to-acceptance time or physical movement.
Firmware uses a dedicated control task; its watchdog also belongs to that task,
so a stalled network task cannot directly reboot a newly admitted pending item.
Actual task/network/actuator fault injection remains a bench acceptance step.

## Production timing remains failed

[model-readiness.json](model-readiness.json) records three fresh CUDA0 workers,
each warmed with a representative original-geometry test picture before
admission. **All nine admitted production requests returned HTTP 504
`model_timeout`** under the unchanged 1100 ms service deadline. Warm-up and
startup were measured separately, and recovery reloaded/rewarmed before the
next admitted request. Per-image sample counts/p50/p95/max include failures.

[production-integration.json](production-integration.json) records 25 controlled
cases plus three real-model n8n cases. All three real-model cases returned
Inspection Result `error` and sent a matching **reject accepted by the controller
core**. Their measured webhook durations were approximately 1491, 1607 and
1602 ms. These are HTTP/webhook observations, not a physical sensor clock.
The production integration was collected before the later acknowledgement
diagnostic additions; its source hashes are retained. Final software contracts
are verified separately by the final integrated report.

The benchmark compatibility probe uses a synthetic 32×32 image and a separate
120-second measurement profile. Its successful request is not evidence that
the representative production pictures meet the deadline. Neither the model,
Coverage Threshold nor the production request deadlines were relaxed to approve
operation. Detection accuracy remains a separate outstanding acceptance concern.

## Retained runtime observations

[integration-under-load.json](integration-under-load.json) retains an earlier
run overlapping native GPU testing with three failed assertions: a missing
post-database completion, its subsequent duplicate-cache assertion, and a
concurrent acknowledgement expectation affected by a 250 ms HTTP timeout.
n8n also logged `Cannot read properties of undefined (reading '_hadError')`.
This is not proof that GPU load caused the fault, nor three confirmed firmware
defects. A later controlled run passed. A later 25/26 run is also retained in [integration-runtime-fault.json](integration-runtime-fault.json): an unexpected capture failure was safely rejected, but its post-response completion was missing. The final workflow skips upload when capture bytes are absent and still records the result; the final 26-case run passes. These observations remain relevant
to #17/runtime reliability and are not erased by that pass.

Test events retain both case and execution identity. Storage ordering is checked
within each execution, and missing delivery is recorded as unknown rather than
acceptance or proof that no physical action occurred. The deliberate lost-ack
case demonstrates that the controller may act even when the caller times out.

## Remaining acceptance

- Production model latency/quality needs further work; warm-up alone is insufficient.
- Prove actual reject-at-expiry or external hold/stop and single-item admission.
  Keep `CN360_BENCH_ADMISSION_ENABLED` disabled until that arrangement is validated.
- Measure actual firmware scheduling, network stalls, reboot behavior, sensor
  admission, controller acceptance and physical actuator motion on the bench.
- Configure the installed workflows and verify real persistence/schema identity
  columns with #26, storage, relay/Pico and later deferred Pi/camera recovery.
- #24/#25 remain unaccepted. Local ticket 06 can keep gathering evidence without
  waiting for those issues to be closed. No GitHub issue was edited or closed.

## Reproduction and files

Use the [controller guide](../../../360ControlUnit/README.md),
[n8n guide](../../../n8n/README.md), and
[model guide](../../../model-service/README.md). The readiness measurement helper
accepts `--integrated` for real-model n8n evidence; image preparation preserves
the licensed originals and records served JPEG hashes/geometry.

Raw reports and test/build logs accompany this README. `environment.json`
records the preimplementation commit, runtime versions and native library/model
hashes. Reports identify their working-tree source/export hashes; committed
sources supply the implementation. No weights, binaries or credentials are
included. MVTec picture attribution remains in the existing asset manifest.
