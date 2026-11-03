# Native LocateAnything software validation

## Authorized scope

The project owner approved local tickets 08–11 and invoked implementation on
3 November 2026, supplying the existing LocateAnything checkout at
`D:\CN360\locate-anything.cpp`. Work remains on the current branch. Existing
unrelated edits and changes in the external checkout must be preserved.

The owner approved zero missed defects and zero false rejects on the frozen
sample set, separate reporting of errors/timeouts, and unchanged timing limits.
This is sample-level software validation, not certification of production
accuracy or physical sorting. The owner selected `cd2e7b5` as the final review
baseline, explicitly including the ThingsBoard work already made in this chat.

The preceding ThingsBoard integration is part of that authorized foundation:
local Community Edition, viewing and alarm acknowledgement, existing n8n/
Supabase/Pico/controller responsibilities preserved, a durable monitoring
journal with idempotent recovery, normal dashboard visibility within five
seconds and health polling every ten seconds. The offline demonstration must
label disabled cloud audit calls. No physical controls were added to the
dashboard.

## Native integration and public test boundaries

- Reuse the resident native model service and existing saved-picture/PC
  controller profile. Do not change the external engine checkout, retrain or
  replace LocateAnything, or introduce a parallel production inference API.
- Provide repeatable native startup against the supplied checkout, validate
  actual local model/library/interpreter settings, and report genuine readiness
  and actual backend. Never silently substitute controlled responses or CPU
  fallback for the selected CUDA configuration.
- Let the operator choose a prepared labelled image/Inspection Target pair.
  Commit the target through the existing n8n prompt flow before changing the
  active picture. Refuse changes during an active item and retain the picture
  on prompt-update failure. Capture identity and dimensions must match the
  selected bytes.
- Preserve canonical Model Instruction construction, prompt echo verification,
  pixel-space boxes, Defect Coverage, Coverage Threshold and fail-closed
  decisions. Confidence is not an evaluation or sorting signal.
- Preserve the production model-service allowance of 1100 ms, n8n model-call
  budget of 1200 ms and controller Verdict Window of 3000 ms. Longer diagnostic
  predictions are separate measurement-only requests and never justify a
  production deadline pass.
- The primary integration seam is the real n8n public webhook through native
  prediction and the actual C++ controller core on the PC, with actual relay,
  ThingsBoard and enabled cloud records. A second supporting seam measures
  prediction quality directly at the genuine model HTTP boundary when the
  production budget censors a prediction.
- Compare only contracts each consumer actually exposes: the raw HUD payload
  uses status, reason, frame geometry and boxes; it does not publish a coverage
  field. Inspection Results and ThingsBoard retain coverage and verification
  data. Controller acceptance never proves physical sorting.

## Frozen measurements and acceptance

- Freeze the image/target cases, expected dataset outcomes, JPEG preparation,
  image hashes, model and library hashes, source revision, backend, mode,
  prompts, threshold, repetition counts and criteria before the scored run.
  Keep manifest targets unchanged. The current curated set has already been
  examined and is not an independent held-out set.
- Cover the 15 existing image/target pairs with three native diagnostic
  repetitions each. Separately exercise the production-budget path on the
  frozen good bottle, broken bottle and cracked capsule cases. Keep all errors
  and timeouts; do not extrapolate timings to unmeasured production cases.
- Report good/defective totals, correct decisions, false rejects, missed
  defects, evaluation coverage and operational failures. Successful-evaluation
  accuracy is labelled; a forced reject after error is not a correct model
  prediction. Provide case-level evidence and a native-box gallery.
- Report cold initialization and warm-up separately from admitted requests.
  Report sample counts, p50/p95/maximum and failures. Distinguish model HTTP
  duration, the observed software item-response upper bound, and dashboard
  visibility; no virtual or PC measurement is physical movement timing.
- Compare Frame Context, Physical Item Identity when present, Verdict,
  coverage, controller receipts, HUD geometry and enabled audit records.
  Verify stored image bytes against the frozen input. Label controlled fault
  injection separately from native quality measurements.
- Exercise normal decisions, model error/timeout/unavailability, capture
  failure, invalid output, prompt mismatch, expiry, duplicate delivery and
  recovery through the public workflow boundary. Reuse prior unchanged
  ThingsBoard shutdown/replay evidence and regression protection rather than
  treating that evidence as native-model accuracy validation.
- Separate quality, production timing and cross-service consistency gates.
  Missing cases/repetitions are unverified. A report can be implemented while
  its acceptance gates correctly fail; failed or unverified required gates
  withhold readiness for physical integration.
- Publish the decision and sample-level metrics to ThingsBoard and provide
  reproducible commands, raw evidence and follow-up recommendations. No
  parent issue is modified/closed and no physical controller is flashed or
  production line activated.
