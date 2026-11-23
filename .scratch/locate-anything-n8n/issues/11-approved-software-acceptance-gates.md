# 11: Agree acceptance gates and publish the software readiness decision

**What to build:** Give the project owner an evidence-backed decision on whether the native saved-image software pipeline is ready to enter physical integration. Agree measurable quality and timing criteria, evaluate a frozen configuration against them, and show each gate as passed, failed or unverified. A truthful failed gate is a valid outcome of this assessment ticket; it is not permission to proceed with automatic physical sorting.

**Blocked by:** 09 — Measure real-model quality and timing on labelled saved images; 10 — Verify matching Inspection Results and failure handling across services.

**Status:** implemented — software evidence complete; native quality and timing acceptance failed

- [x] Propose and obtain the project owner's agreement on numeric limits for missed defects and false rejects, relevant categories/targets, minimum evaluation sample counts, operational failures, and the required evidence before the final scored acceptance run. Do not invent owner approval or choose final limits merely to make the baseline pass.
- [x] Freeze the final model/backend configuration, images/target pairs, image preparation, Coverage Threshold, prompts and test procedure before scoring. If the baseline was used to tune the configuration, distinguish exploratory examples from held-out acceptance cases and state the limits of the available dataset.
- [x] Check the configured model request budget and complete pre-verdict path against the controller-local Verdict Window, including queueing and observed controller receipt. Report sample counts, p50, p95, maximum and deadline misses. Averages or diagnostic-service success cannot certify a hard item deadline.
- [x] Retain the existing five-second normal dashboard-visibility target and ten-second health-polling requirement as separate monitoring checks. They are not substitutes for model or controller deadlines.
- [x] Score quality, production timing, cross-service consistency, failure fallback and monitoring recovery as separate gates using the evidence from 09 and 10. Incomplete evidence is unverified, and a timeout/fallback is not a successful inspection just because the item would be rejected.
- [x] Publish an overall software-readiness decision with reproduction details, configuration identity, raw evidence references and explicit failed/unverified gates. Approval is withheld when any required gate fails or remains unverified.
- [x] If a gate fails, describe the smallest evidence-backed follow-up work and its limitations. Do not silently replace LocateAnything, change the Coverage Threshold policy, or increase the model timeout past the existing budget guard to obtain a pass.
- [x] Physical integration is a separate next stage requiring real camera, controller, sensor/actuator and single-item bench evidence. The report does not activate a conveyor, claim physical sorting from a PC controller receipt, or modify/close existing parent issues.

**Implementation evidence:** Native model software assessment dated 2026-11-03. The scored diagnostic set contains 45 genuine predictions; three production-budget inspections retain their actual outcomes; ten controlled cross-service cases passed. Diagnostic quality measurements are separate from production inspection records. The agreed quality and production timing gates failed; no physical readiness or production accuracy is claimed.
