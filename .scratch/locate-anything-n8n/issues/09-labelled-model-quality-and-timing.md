# 09: Measure real-model quality and timing on labelled saved images

**What to build:** Run a reproducible set of labelled good and defective image/Inspection Target pairs through the native software Inspection path and publish a baseline showing missed defects, false rejects, operational failures and processing time. An operator can inspect each prediction in the HUD and ThingsBoard and trace the aggregate report back to the corresponding Inspection Results. This is a measurement baseline, not automatic model acceptance or an optimization project.

**Blocked by:** 08 — Run a saved-image Inspection through native LocateAnything and monitoring.

**Status:** implemented — software evidence complete; native quality and timing acceptance failed

- [x] Before execution, freeze the chosen image/target pairs, reviewed expected outcomes, image transformations and hashes, prompts, Coverage Threshold, model/backend configuration, warm-up procedure and repetition counts. Reuse the existing labelled images and annotations where suitable; do not infer target-specific ground truth solely from the presence of some unrelated defect in an image.
- [x] Cover both good and defective examples across the selected categories, including the previously observed normal-image false positives and missed cracked-capsule defect. Predictions remain native model outputs rather than fabricated expected answers.
- [x] Each production-profile attempt records its outcome, timing and correlated downstream evidence. Successful evaluations, model errors, capture failures, timeouts, ignored controller replies and unknown delivery results remain distinguishable.
- [x] Report counts and rates for missed defects and false rejects, the confusion matrix for successfully evaluated cases, all-attempt totals, evaluation coverage and operational failure/fallback counts. Errors and forced rejects are not silently discarded or treated as correct model predictions.
- [x] Compute Verdict quality using the project's Defect Coverage and Coverage Threshold policy. Finding any box is not automatically a reject, and confidence is never used as a sorting or evaluation signal. Any localization assessment is reported separately from Verdict quality.
- [x] Where production timeouts prevent useful quality analysis, a separately labelled diagnostic run may obtain predictions using a longer measurement-only allowance. Its quality evidence and timings cannot be substituted for production-profile deadline compliance or used to enable automatic operation.
- [x] Report cold-start/warm-up separately from repeated warm requests; include sample counts, p50, p95, maximum and failures for model time and observable full-Inspection time. Distinguish controller receipt time from ThingsBoard visibility, and document memory/backend observations needed to reproduce the run.
- [x] A case-by-case gallery or report lets a reviewer compare the labelled image, expected outcome, native boxes, coverage, Verdict and failure state against the HUD, ThingsBoard and enabled records. All returned valid boxes remain available for review.
- [x] Preserve the baseline, reproduction instructions and raw evidence. Do not tune prompts, thresholds or model variants during a frozen run; any later comparison is a separately identified experiment.

**Implementation evidence:** Native model software assessment dated 2026-11-03. The scored diagnostic set contains 45 genuine predictions; three production-budget inspections retain their actual outcomes; ten controlled cross-service cases passed. Diagnostic quality measurements are separate from production inspection records. The agreed quality and production timing gates failed; no physical readiness or production accuracy is claimed.
