# Fresh native-model sample results — 28 October 2026

[Open the gallery](index.html) or inspect the [six-example figure](sample-results.png).
The local viewer is at http://127.0.0.1:8110/ while its read-only server runs.

These are actual LocateAnything q8/hybrid predictions from a fresh CUDA0
resident service, not the controlled responses used by the software-test HUD.
All 15 direct requests completed successfully. The diagnostic service allowed
120 seconds per request; the production 1.1-second deadline was not approved.

- Inputs: 12 MVTec AD pictures, evaluated in 15 picture/target combinations.
- Served input: JPEG, maximum side 448 pixels; geometry and image SHA-256 are
  checked against the prepared inputs and recorded requests before plotting.
- Red boxes are the model's returned pixel coordinates.
- Green boxes are the bounding rectangles of dataset defect masks. They are
  reference annotations, not model outputs. Normal pictures have no green box.
- All 7 normal-picture/target pairs returned boxes: false positives relative to
  the dataset labels. The cracked capsule returned no boxes: a missed defect.
- Boxes on other defective pictures require localization review. This small
  set and mask bounding rectangles do not establish an overall accuracy score.
- All 15/15 detection lists match the earlier 26 October diagnostic
  predictions exactly. Timings differ; the new run is recorded separately.

The model is producing repeatable outputs, but these outputs are insufficient
for reliable defect inspection. No confidence score is used because its value
is hardcoded and is not a calibrated probability.

Raw evidence: [fresh run](fresh-run.json), [model responses](model-responses.json),
[image hashes and annotations](results.json), [native service log](native-service.log).
The fresh diagnostic worker was stopped after capture. It does not control
hardware or change the n8n production deadline. Native warm-up failures with
900-pixel inputs remain separate; this run explicitly uses the 448-pixel profile.

Images and derivative figures: MVTec AD, Bergmann et al., CVPR 2019 / IJCV 2021,
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Original source/license/checksum details remain in the repository's
[test-asset manifest](../../../test-assets/product-defects/manifest.json).
