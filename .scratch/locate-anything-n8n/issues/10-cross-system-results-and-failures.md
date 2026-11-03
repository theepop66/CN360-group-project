# 10: Verify matching Inspection Results and failure handling across services

**What to build:** Demonstrate that a native saved-image Inspection tells the same story in the n8n response, PC controller, HUD, ThingsBoard and enabled audit records, including failure and recovery cases. Extend the existing integration checks rather than rebuilding the controller's already-tested deadline protections.

**Blocked by:** 08 — Run a saved-image Inspection through native LocateAnything and monitoring. This ticket can proceed in parallel with 09; it does not require the model to pass quality or latency targets.

**Status:** implemented — software evidence complete; native quality and timing acceptance failed

- [x] For native-model attempts, correlate Frame Context and, when present, Physical Item Identity across the model request, n8n response, Inspection Result, Control Action, HUD payload and ThingsBoard event. Observational runs remain distinct from item-bound runs.
- [x] Verify consistent Verdict, Defect Coverage, Coverage Threshold, prompt verification and failure state wherever each is represented. Keep successful pass/reject evaluations separate from external error responses that cause internal reject fallback.
- [x] Exercise unavailable model, genuine timeout, failed capture and invalid model output, plus prompt mismatch reporting. Fault injection is explicitly labelled; injected responses are not counted as native-model quality evidence.
- [x] Failure paths produce no silent pass. Unknown coverage is displayed as unavailable, all valid boxes remain visible where applicable, and controller acceptance/ignored/unknown results are reported without claiming physical sorting.
- [x] A slow or unavailable ThingsBoard instance does not delay the Verdict or inspection response. Retained monitoring events recover with stable identities and timestamps, without inflated inspection counts.
- [x] Controller retries or duplicate notifications do not imply extra physical items. Verify one Inspection Result per physical identity where required, while allowing separate Control Action attempt records and preserving their actual receipts.
- [x] Verify actual cloud audit agreement with audit enabled and the explicitly labelled local-journal behaviour in offline mode. A skipped cloud write or skipped snapshot cannot be reported as successful delivery or a stored image.
- [x] Check healthy native service recovery after a fault, truthful health/readiness reporting and stale monitoring indication. Subsequent inspections cannot inherit a prior item's geometry, identity or controller receipt.
- [x] Preserve joined evidence and meaningful automated regression coverage at the existing public workflow/service boundaries. Report any unresolved discrepancy explicitly, and keep physical-device acceptance separate.

**Implementation evidence:** Native model software assessment dated 2026-11-03. The scored diagnostic set contains 45 genuine predictions; three production-budget inspections retain their actual outcomes; ten controlled cross-service cases passed. Diagnostic quality measurements are separate from production inspection records. The agreed quality and production timing gates failed; no physical readiness or production accuracy is claimed.
