# Static-picture inspection results — 26 October 2026

[Open the visual report](report.html). Red rectangles are model detections;
green dashed rectangles bound the dataset's annotated defect regions.

The tests were implemented and executed. **The present system does not meet
production timing or late-verdict acceptance.** Camera deployment remains deferred.

## Results

| Check | Recorded outcome |
| --- | --- |
| Controlled real-n8n scenarios | 37/37 passed: coverage boundaries, prompt updates, failure paths, duplicates, concurrent triggers and health transitions |
| Fresh GPU workers, 1100 ms inference-request deadline | 3/3 timed out; subsequent worker health was unavailable |
| Sequential diagnostic cases | 150 attempted; 101 returned evaluated pass/reject results; 49 ended in errors |
| Diagnostic error reasons | 45 model timeouts, 1 frame-capture failure, 3 test-execution/setup failures |
| Completion/contract assertions | Seven sequential case records failed one or more completion checks; these overlap the evaluation outcomes above |
| Concurrent real-model bursts | Two and five triggers completed their contract checks; 1 and 4 `model_busy` responses respectively |
| Controller desired-behavior probe | Auto-pass at expiry and both stale-A-during-B verdict cases failed acceptance |
| Existing n8n regression suite | 199 tests passed |
| Existing model-service regression suite | 7 passed; 1 native test skipped because `CN360_RUN_NATIVE_TESTS` was not enabled; real-GPU measurements are recorded separately |
| Existing controller host suite | 77 checks passed; its baseline still expects timeout auto-pass |
| New Python helper strict type checks | Three files passed |
| Code review | Standards and Spec review findings resolved; see [review](review.md) |

Some completion callbacks arrived after their bounded wait. They remain attached
to their originating case, and the failure flags are retained. These are
integration/test-runtime observations requiring triage, not seven independently
confirmed production defects. See the exact events and IDs in [model.json](model.json).

## Timing and detection interpretation

The 150-case diagnostic summary includes every failed case. Three setup failures
have no inspection elapsed measurement, leaving 147 measured webhook durations.
For those observations, p50 was **1224.84 ms**, p95 **1432.19 ms**, and maximum
**1607.07 ms**. These include error responses; successful-only figures and per-case
statistics are supplied separately. Three cases have no recorded verdict receipt.
Zero observed receipts at/after 3000 ms does not prove that every verdict arrived.
The clock starts at webhook invocation, not a real IR event.

Direct diagnostic JPEG evaluation returned boxes for all **7/7 normal-image/target
combinations** and returned no boxes for the defective cracked-capsule picture.
Review localization in the overlays: a returned box does not establish that the
actual defect was located. Bounding-rectangle IoU is descriptive, not a tuned
acceptance threshold. This 12-picture smoke set does not establish general accuracy.

The coverage decision is assessed independently from detection quality. A defect
can yield `pass` when the detected box coverage is below 0.005; empty or incorrect
detections are a model-quality concern even when the workflow follows its policy.
An evaluated decision also does not prove that a controller accepted a command.

## Scope and reproducibility

- The final diagnostic profile explicitly resizes the images to a maximum side
  of **448 pixels**, JPEG quality 95 with no chroma subsampling. Original PNGs
  and masks remain unchanged. Capture headers match the served image dimensions.
- The production n8n model HTTP timeout remained **1200 ms**, and the coverage
  threshold remained **0.005**. Fresh-worker tests used the service's **1100 ms**
  request deadline. Model startup was allowed up to 300 seconds and is recorded
  separately from per-inspection deadlines.
- The separate diagnostic service used a **120-second** request deadline. Its
  proxy drains late responses after n8n expires, allowing their observation.
  These warm repetitions do not certify the production deadline or its
  disconnect/worker-restart behavior.
- Real n8n 2.6.4 ran in disposable containers with real LocateAnything on the
  observed CUDA0 backend. Capture, database/storage, relay and actuator endpoints
  were recording substitutes. No real servo command, physical sorting, database
  persistence or Pico delivery was established.
- Existing localhost:5678 workflows were exported and inspected read-only. They
  were inactive, still had placeholders, and lacked current compact-response/
  checked-prompt branches. The isolated tests used current repository graphs;
  the existing instance was not updated or activated.
- Original-resolution exploration completed four direct responses before a
  later request stalled. That incomplete exploration is retained separately in
  [exploratory-original-resolution.json](exploratory-original-resolution.json);
  it is not the final 448-pixel evaluation or an original-resolution benchmark.
- Tests ran on a shared development laptop, not a controlled production line.
  Intermediate harness-development runs are excluded from the final results.

[environment.json](environment.json) records model/library/source hashes,
backend, GPU driver, Python/Pillow/Node versions and Docker image identity.
The generated test-workflow export hashes are in the raw reports. The reports'
Git revision is the preimplementation baseline; source hashes identify the
working-tree implementation contained in this commit.

Run instructions are in [the n8n guide](../../../../n8n/README.md).
The original [test plan](../../../testing/static-image-inspection-test-plan.md)
describes the acceptance boundaries. Original photographs and thumbnail
derivatives are MVTec AD, Bergmann et al., CVPR 2019 / IJCV 2021,
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Full attribution and source-image checksums are in
[the asset manifest](../../../../test-assets/product-defects/manifest.json).

## Ticket assessment

- [#17](https://github.com/theepop66/CN360-group-project/issues/17): controlled
  orchestration contracts passed. Actual installed-workflow configuration,
  real-service delivery and diagnostic completion faults remain to be addressed.
- [#24](https://github.com/theepop66/CN360-group-project/issues/24): acceptance
  failed. Current firmware can pass on timeout and accept A's late verdict during
  B. The production model also missed its first-prediction deadline in all three
  measured starts. The probe changes no firmware and operates no hardware.
- [#25](https://github.com/theepop66/CN360-group-project/issues/25): only the
  still-image software subset was exercised. Sensor/ESP32/servo, real database,
  relay/Pico and deferred Pi capture/recovery acceptance remain outstanding.

No GitHub ticket was edited or closed.
