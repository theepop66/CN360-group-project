# 07: Item-bound Verdicts and deadline-safe inspection

**What to build:** Make each physical Verdict apply only to the matching active item before its controller-local deadline. Replace timeout auto-pass with reject fallback, prevent late/duplicate Verdicts from affecting another item, remove snapshot storage from the pre-verdict path, and warm the model before readiness. Use test pictures through real n8n and the actual controller core running on the PC for integrated software acceptance.

**Spec:** [Item-bound Verdicts and deadline-safe inspection](../../../docs/specs/item-verdict-deadline-safety.md)

**Status:** partial — software implemented; production timing failed; physical acceptance pending

**Labels:** partial

**Updated:** 2026-10-26 (Asia/Bangkok)

**Blocked by:** No prerequisite blocks software implementation. Physical automatic-operation acceptance remains blocked until reject-at-expiry or an external hold/stop arrangement is demonstrated on the bench, and actual production timing passes.

**Related work:** GitHub #24 is the originating reference; #17/#23 cover orchestration, #25 covers complete-system acceptance, and #26 coordinates real persistence. Local 02/04 provide the existing workflow and resident-model foundations. Local 06 can continue gathering evidence while this work proceeds; neither ticket waits for the other's completion to begin.

**Confirmed test boundary:** On 2026-10-26 the user selected test-picture item events through actual n8n webhooks into the real controller logic via a thin host HTTP adapter. Assert item identity, accepted/ignored receipts, counters and emitted movement/feedback using deterministic virtual time. Model HTTP lifecycle checks and physical bench acceptance provide separate supporting evidence.

**Acceptance scope:** Deliver and verify the software contract first. Record controller correctness, workflow completion, production model performance and physical fallback separately as pass/fail/blocked. A fixture pass does not complete GitHub #24 or #25. Camera deployment remains deferred.

**Starting evidence:** [26 October static-picture test report](../../../docs/evidence/static-image-inspection/2026-10-26/README.md). This records timeout auto-pass, stale Verdict acceptance, cold-worker timeouts and diagnostic model limitations.

- [x] The controller issues a fresh session and unique opaque item identifier at admission; notifications, n8n, Verdicts, acknowledgements and audit data preserve the pair without substituting Frame Context.
- [x] At or after the configured Verdict Window, the active item resolves once through reject/alert fallback with no pass increment. Local expiry progresses during unreachable or stalled network operations.
- [x] Acceptance checks item/session, unresolved state and rollover-safe elapsed time at receipt, including before the next timer tick. Invalid, expired, duplicate, previous-session and mismatched commands cannot apply a remote Verdict or affect the next item.
- [x] An acknowledgement distinguishes remote-command acceptance from local fallback actions, echoes submitted identity and gives an explicit ignored/error reason. Legacy action-only automatic routes cannot bypass the revised contract.
- [x] Manual/scheduled inspections without an active controller-issued item context remain observational. Paired manual inspections retain the original deadline. Retries and duplicate events cannot create a new item or extend its window.
- [x] n8n preserves identity through success and error branches, keeps same-frame/different-item requests distinct, and reports Inspection Result separately from accepted/ignored/delivery-unknown Control Action outcomes.
- [x] Snapshot upload follows the bounded Verdict attempt; slow/offline storage cannot prevent inference or delay the control decision. Stored bytes and Frame Context still match the inspected capture.
- [x] Resident-model readiness includes bounded startup warm-up and rewarm after worker replacement. Loading/warming/failure remains unavailable; actual production request deadlines and bounded concurrency remain enforced.
- [x] Controller host and integrated real-n8n tests cover timely pass/reject, exact expiry, expiry before timer progress, missing Verdict, invalid identity, duplicate/reordered delivery, stale A pass/reject while B awaits, previous boot and clock rollover. Tests check one final resolution and truthful receipts/counters.
- [x] Workflow regression covers capture/model failure, expired/ignored replies, lost acknowledgements, retries, observational triggers, storage failure, binary preservation and test-case ownership for late callbacks.
- [x] Actual model evidence reports startup/warm-up separately from admitted requests; includes every attempt, errors, missing receipts, sample counts, per-case p50/p95/max and deadline misses under the deployed production profile. Diagnostic settings cannot approve production timing.
- [x] Contract documentation and affected consumers are updated together. Mixed firmware/workflow versions fail closed; persistence identity mapping is coordinated with the real schema work.
- [ ] Physical acceptance is explicitly pending until sensor-to-acceptance and movement timing, network/model failures, restart and stale delivery are demonstrated with the actual bench arrangement. If timely rejection/retention cannot be demonstrated, automatic operation stays blocked.

The full specification defines the detailed contracts and out-of-scope work. Software implementation and review are complete. The production model missed all nine direct admitted-request deadlines after warm-up; physical acceptance and actual persistence/relay deployment remain pending. No production workflow was activated or hardware flashed.


**Implementation evidence:** [26 October ticket 07 report](../../../docs/evidence/item-verdict-deadline-2026-10-26/README.md). Includes controller/n8n/HUD/model suites, real GPU startup/warm-up/recovery measurements, production timeout results and retained runtime faults. The controlled receiver is the actual C++ core via a thin HTTP adapter; physical sorting is not certified.

**Remaining acceptance:** Demonstrate physical reject/retention and admission, actual ESP32 network/task/reboot behavior, real-service persistence/delivery and production inference latency/quality. This partial status is intentional; software fail-closed behavior does not approve automatic operation or close GitHub #24/#25.
