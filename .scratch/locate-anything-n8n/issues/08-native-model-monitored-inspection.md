# 08: Run a saved-image Inspection through native LocateAnything and monitoring

**What to build:** An operator selects the native LocateAnything profile, inspects a saved image with the controller core running on the PC, and can trace its genuine outcome through n8n, the HUD, ThingsBoard and the enabled inspection records. Reuse the existing native-model and saved-picture profiles. This completes the monitored integration and its evidence; it does not rebuild resident inference or repeat the completed CUDA evaluation.

**Blocked by:** None (can start immediately). The existing model service, PC controller and ThingsBoard integration provide the implementation foundations. The incomplete physical-acceptance tickets do not block this software work.

**Status:** implemented — software evidence complete; native quality and timing acceptance failed

- [x] A documented, repeatable native-profile startup loads the intended LocateAnything model, reports the actual compute backend and warm-up/readiness state, and connects from the real n8n runtime. There is no silent substitution of controlled model responses or CPU fallback.
- [x] A saved-image Inspection preserves the actual uploaded bytes, Frame Context, Inspection Target, canonical Model Instruction and prompt echo. At least one genuine prediction is demonstrated at the model boundary; any prediction that requires diagnostic timing is explicitly distinguished from a production-budget Inspection.
- [x] An item-bound software Inspection preserves Physical Item Identity through its Verdict, the PC controller's Control Outcome, HUD delivery and ThingsBoard event. An observational Inspection is labelled and does not issue an unpaired Control Action.
- [x] The operator can see the genuine Verdict, Defect Coverage when available, processing time, failure reason and native-model profile in ThingsBoard, with consistent image geometry on the HUD.
- [x] With cloud audit enabled, actual Inspection Result and Control Action records are verified. An offline demonstration instead verifies the local monitoring journal and explicitly labels cloud audit as disabled; it cannot certify Supabase delivery.
- [x] A genuine timeout or failed native Inspection remains an external error with internal reject fallback and unavailable coverage where appropriate. Existing model-budget guards and the controller-local Verdict Window remain unchanged. Connectivity acceptance does not require or imply a passing accuracy/deadline result.
- [x] A repeatable smoke run and regression checks protect the new integration behaviour. Evidence identifies the image, prompt, configuration, responses and record identities without exposing credentials.
- [x] No physical controller is flashed, conveyor activated, model replaced, or existing parent issue modified or closed.

**Implementation evidence:** Native model software assessment dated 2026-11-03. The scored diagnostic set contains 45 genuine predictions; three production-budget inspections retain their actual outcomes; ten controlled cross-service cases passed. Diagnostic quality measurements are separate from production inspection records. The agreed quality and production timing gates failed; no physical readiness or production accuracy is claimed.
