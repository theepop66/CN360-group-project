# Issue #17 software acceptance — 28 October 2026

The agreed boundary is saved test pictures through real n8n into the actual
controller C++ core running on the PC, real Supabase Database/Storage, the real
HTTP/WebSocket relay and the browser HUD. Camera deployment and physical line
acceptance were explicitly deferred. Controlled model responses exercise
orchestration; fresh actual model predictions are reviewed separately below.

## Final results

| Check | Result | Evidence |
| --- | --- | --- |
| n8n unit/contracts | 216/216 passed | [test output](unit-tests-216.log) |
| Relay unit/integration | 22/22 passed | [test output](relay-tests-22.log) |
| Real isolated n8n faults/stress | 59/59 contract cases passed | [report](isolated-stress-59.json) |
| Deployed software/cloud integration | 10/10 passed | [report](deployed-acceptance-10.json) |
| PostgreSQL transactional concurrency | 6/6 passed | [report](postgres-idempotency-6.json) |
| Python strict type checking | 2 files passed | `render-model-gallery.py`, `test-idempotency.py` |
| Active deployed workflows | Exactly the three CN360 workflows | [runtime metadata](active-runtime.json) |

The final cloud run `issue17-1793186236947` ended at
`2026-10-28T11:18:33.656Z`. It verified:

- Prompt normalization, actual model-boundary update, prompt-history write and
  rejection of a blank target.
- Pass, reject, error and timeout paths through the actual controller core;
  item/session receipts and counter changes; matching inspection/control rows.
- Stored public snapshot bytes match the captured JPEG; real WebSocket payloads
  retain frame geometry and pass the existing HUD parser.
- Five racing events for one admitted item produce one accepted controller
  verdict, four ignored receipts, one inspection row and five control-action
  rows anchored to that inspection. Different items remain distinct.
- Unpaired manual and actual scheduled inspections do not actuate or change
  controller counters. The scheduled check uses a disposable n8n instance with
  real cloud, capture, relay and controller endpoints.
- Relay heartbeat/reconnect works without replaying old detections.
- A model outage produces one transition log; another completed offline poll
  produces no repeated outage row; recovery is subsequently recorded.

The isolated suite includes malformed responses/boxes, capture/model/storage/DB/
relay faults, a DB that never replies, 550 ms snapshot latency, delayed model
responses, duplicate frames, new camera sessions, concurrent bursts and ten
timeout-plus-five-item-burst rounds. Expected model failures are **passing fault
contracts**. The report's timing summary counts inference outcomes separately;
its 21 failed/error measurements do not mean 21 contract failures. Its stub
receipt measurements cannot establish physical timing or loaded deployment
reliability.

## Fixes supported by these checks

Persistence HTTP requests now have a 3-second timeout after the verdict attempt
and webhook response, so a stalled DB cannot hold an execution indefinitely.
Snapshot persistence retains its separate 3-second allowance after the verdict.

The inspection RPC serializes a full controller-session/item pair inside a
READ COMMITTED transaction. A concurrent/restarted caller returns the existing
inspection ID, while preserving racing control attempts and suppressing a
second HUD broadcast. Legacy duplicates are preserved without creating another
row; observations without identity remain distinct. The user applied
`n8n/sql/002-idempotent-inspections.sql`, and the deployed cloud check confirms
its behavior. The independent PostgreSQL test includes 20 simultaneous callers,
rollback, permissions, identity validation and legacy data.

Health cache state now advances only after the DB confirms insertion. Failed
writes remain eligible for the next poll. An uncertain acknowledgement can
yield an extra transition row if the original committed; this is at-least-once
logging rather than silently losing recovery.

Test completion observers alone retry bounded HTTP delivery and deduplicate by
execution ID and observation kind. Production control/model requests do not
inherit those retries. Startup waits for all three workflow activation messages
because HTTP readiness can precede webhook registration. The dedicated profile
unpublishes copied workflows before publishing exactly the three CN360 flows.
The original n8n container remains stopped and its original volume is preserved.

## Failure history retained

- [Earlier atomic stress run](earlier-observer-failure.json): 58/59; business nodes
  completed but the final test observer connection aborted. Fixed with bounded,
  idempotent observer delivery, then rerun.
- [Earlier cloud run](earlier-watchdog-failure.json): 9/10; missing recovery log.
  Fixed by committing watchdog state after confirmed persistence.
- [Overlapping runtime run](earlier-overlapping-runtime-failures.json): 54/59;
  several host-transport requests timed out while cloud acceptance/startup also
  ran. This is retained as a deployment/load limitation; the final suites ran
  separately. No timeout budget was increased to obtain the pass.
- [Aborted startup check](aborted-startup-check.json): began before workflow
  registration, giving early 502/404 responses. Later cases passed, including
  watchdog recovery; the supervisor was stopped during its scheduled case to
  restrict activation to the three intended workflows. This is not a complete
  acceptance run. The final startup gate and complete 10/10 run supersede it.

## Actual model quality and remaining acceptance

The [fresh native-model gallery](../real-model-gallery-2026-10-28/README.md)
contains all 15 actual predictions on 12 dataset pictures, input hashes and
overlays against known defect-mask rectangles. All seven normal picture/target
pairs returned boxes, and the cracked capsule returned no boxes. Other defective
examples still require localization review. The model runs but is not accepted
as a reliable defect detector.

That diagnostic used 448-pixel JPEGs and a 120-second request limit; actual
request times were approximately 1.52–3.95 seconds. It does not approve the
production model deadline or physical Verdict Window. Native 900-pixel warm-up
also failed on this PC in separate attempts. Controlled orchestration results
must never be presented as native model accuracy or production timing proof.

Software scope for #17 is complete under the user's explicit saved-picture/PC
boundary. #24 remains open for real deadline/load and physical fail-safe proof;
#25 remains open for model quality, camera/Pico/line and complete-system acceptance.
No physical output or unattended production line was activated. The actual relay
was incorporated from `origin/add/issue-7` at `e0a193e`, without changing #7.

See [setup and reproducible commands](../../../n8n/SOFTWARE-BENCH.md).
Runtime-only key files and ignored configs are not part of this evidence.
`checksums.json` fingerprints the reviewed source and evidence with LF line
endings, including the uncommitted source used by runs whose base Git revision
still reads `9caf8e5`.
