# Fixed-model inspection improvements

The owner authorized these five steps on 3 November 2026: check local boxes,
test focused crops and clearer descriptions, tune product-specific rules on
development images, evaluate accuracy/speed on untouched images, and withhold
automatic approval for unreliable conditions. Keep the exact existing q8
LocateAnything weights, external checkout and native library unchanged.

## Experiment

- Existing MVTec AD 000 images are development data, never held-out evidence.
  Reserve indices 010 and 011 from the same pinned dataset revision for a small
  held-out set. Freeze source hashes and the candidate plan before tuning.
  Split by original image hash; crops and prompt variations cannot cross splits.
- Use a bounded comparison: original versus clearer target descriptions, and
  full frame versus a fixed central crop (80% width/height) applied to original
  pixels before resizing to maximum side 448. No mask-dependent crop selection.
  Preserve every raw box, crop transform, instruction, hash and request time.
- Compare checked native boxes with the installed upstream CLI on development
  images with identical model, prompt, mode and input bytes. This checks the
  adapter, not parity with NVIDIA's separate Python implementation. Report
  bounds, empty detections and defect-mask overlap separately from parity.
- Choose one prompt/crop/coverage threshold per product/defect condition using
  development results only. Report unsatisfiable threshold separation instead
  of manufacturing a passing threshold. Lock selection before held-out access.
- Evaluate each locked condition on two untouched normal and two untouched
  defective originals, three repeats per pair. Do not tune after evaluation.
  Keep misses, false rejects, errors and timings separate. Same-model repeated
  predictions are not independent images or a production-accuracy estimate.
- A condition needs zero misses, false rejects and errors, complete inputs,
  passing native parity, and real production-budget qualification before it
  may allow automatic pass. Missing evidence means review. Preserve 1100 ms
  service, 1200 ms n8n and 3000 ms controller limits; long diagnostic timing
  cannot qualify production. Retain the earlier failed baseline unchanged.

## Runtime

- Native saved-image operation uses a guarded policy by default. Match an exact
  Model Instruction and explicit preparation profile; apply that condition's
  threshold. Unknown/unqualified conditions require human review, including
  apparent no-defect results. Never infer reliability from an empty box list.
- Review is an inspection outcome, not a physical controller command. Return
  `result: review`, retain model suggestion, boxes, threshold and reason, and
  send the existing controller `reject` fallback. Errors remain errors and
  reject. Prompt mismatch/missing verification cannot obtain automatic pass.
- Show review status on the saved-image page, HUD and ThingsBoard. Keep a local
  persistent review queue with frame/item identity, snapshot and raw suggestion.
  Human acknowledgement is recorded separately and never changes a controller
  verdict or turns a reviewed item into an automatic pass. No physical sorting,
  production activation, firmware change or GitHub issue changes are authorized.
- Test the shared policy seam and real n8n review/failure paths, run relevant
  suites/type checks, review against the owner's selected baseline cd2e7b5,
  preserve unrelated edits, and commit on the current branch.
