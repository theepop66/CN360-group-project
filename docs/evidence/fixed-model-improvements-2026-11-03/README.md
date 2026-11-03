# Fixed LocateAnything model: improvements and review fallback

The existing q8 LocateAnything model is unchanged. Focused crops, clearer
descriptions and per-condition coverage rules are implemented and tested.
**No tested condition qualifies for automatic approval. Native saved-image
inspection now requires human review and retains the controller reject
fallback. Physical integration remains gated.**

## What was checked

1. The checked resident adapter matched the installed upstream C++ CLI on all
   three probes: a normal bottle with false boxes, a hazelnut hole with a small
   box and a capsule crack with no box. Coordinate tolerance was 0.02 pixels
   because the CLI prints two decimal places. This is adapter/CLI parity,
   **not** comparison against NVIDIA's separate Python implementation.
2. All boxes in the completed development and held-out runs had valid frame
   bounds. Source-coordinate transforms and defect-mask recall are retained
   per prediction. Valid coordinates or mask overlap alone do not prove the
   model identified the correct defect; large boxes can include normal areas.
3. Four candidates per product/defect condition compared original/clearer
   descriptions and full-frame/fixed central-80% crops. Cropping uses original
   pixels before resizing to maximum side 448. Masks never choose the crop.
4. The 64 development predictions used the previously examined 000 originals.
   One native inference failed and is retained. The runner waits for genuine
   recovery before admitting subsequent cases. Candidate selection and
   thresholds were locked before any held-out prediction.
5. The untouched test used indices 010 and 011 from the same pinned MVTec AD
   revision: 24 distinct originals shared across 32 image/defect pairs. Each
   selected setting was tested three times (96 predictions). The original
   full-frame description/0.5% baseline was also measured once per pair (32
   predictions), after settings were locked. Test outcomes did not retune them.

## Held-out results

| Measure | Original baseline | Development-selected settings |
| --- | ---: | ---: |
| Predictions | 32 | 96 |
| Good attempts falsely rejected | 15/16 (93.75%) | 33/48 (68.75%) |
| Defective attempts missed | 0/16 (0%) | 12/48 (25%) |
| Successful decisions | 17/32 (53.125%) | 51/96 (53.125%) |
| Errors | 0 | 0 |

The selected settings reduce false rejects but introduce misses. Overall
sample accuracy does not improve. Repeats are not independent images, and
these small, shared-category samples do not establish production accuracy.

| Condition | Selected view/description | Coverage threshold | Misses / 6 defective attempts | False rejects / 6 good attempts |
| --- | --- | ---: | ---: | ---: |
| Bottle: large break | Central 80%, clearer | 0.5% | 3 | 0 |
| Bottle: small break | Full frame, clearer | 0.5% | 0 | 3 |
| Metal nut: scratch | Full frame, original | 25.8232% | 6 | 6 |
| Metal nut: bent | Full frame, original | 31.7765% | 0 | 6 |
| Hazelnut: crack | Central 80%, clearer | 0.5% | 0 | 6 |
| Hazelnut: hole | Central 80%, clearer | 0.5% | 0 | 6 |
| Capsule: crack | Central 80%, original | 0.5% | 0 | 6 |
| Capsule: squeeze | Full frame, original | 12.2335% | 3 | 0 |

Selected diagnostic HTTP times: median **995 ms**, p95 **1154 ms**, maximum
**1269 ms**. These requests use a 120-second measurement allowance. Existing
1100 ms service, 1200 ms model-call and 3000 ms controller limits are unchanged.
Production qualification is skipped because every condition fails quality;
it is **unverified**, not passed. No setting is eligible for automatic approval.

## What the operator sees

- The saved-image page selects the locked prepared image/description pair.
  Exact preparation identity and instruction select that condition's rule.
  An unknown condition, mismatched preparation or unverified prompt also needs
  review. An empty box list cannot bypass the guard.
- A successful but unqualified prediction returns `result: review`, preserving
  its model suggestion. Errors remain `result: error` and also request review.
  Both keep the existing physical `reject` command. No firmware changes.
- The HUD and ThingsBoard show review state separately from the model
  suggestion and controller receipt. Inspection Results retain their physical
  reject Verdict; System Logs contain review reason, policy ID and suggestion.
- The local SQLite review queue retains frame/item identity, boxes and an
  immutable captured JPEG even if the next picture is selected or cloud
  snapshot upload fails. Monitoring deduplication also deduplicates reviews.
- The human review page records reviewer name, assessment and note. It sends
  no machine command, keeps the original outcome, and does not qualify a model
  condition. Reviewer names are local audit labels, not authenticated accounts.

Open [saved-image inspection](http://127.0.0.1:8104/),
[human review queue](http://127.0.0.1:8104/reviews) or
[ThingsBoard](http://127.0.0.1:9090/dashboard/12c06330-d75b-11f1-9606-b5e03b9a0004).

## Evidence

- [Frozen inputs and candidate plan](inputs.json), [unchanged model identity](model.json)
- [Development measurements](development.json), [locked selection](selection.json)
- [Held-out predictions and paired baseline](heldout.json), [box gallery](gallery.html)
- [CLI parity](parity.json), [qualification](production-qualification.json)
- [Runtime policy](policy.json), [summary](summary.json)
- [Real workflow review checks](review-integration.json), [verification](verification.json)
- [Independent review](review.md)

The review integration evidence uses real n8n, the actual C++ controller core
on the PC, actual cloud audit, relay/HUD and ThingsBoard. Model/capture results
and qualification flags in those scenarios are controlled fixtures, clearly
excluded from native quality and qualification. Synthetic records acknowledged
by the test say "Automated integration check", never a human product assessment.

Prepared JPEGs and masks are retained here with checksums. Original development
PNGs remain in `test-assets/product-defects`; new originals can be retrieved
from the exact pinned URLs/checksums in `inputs.json`. No weights, credentials
or external checkout changes are committed. The earlier failed assessment in
`../native-model-software-2026-11-03/` is preserved.

## Reproduce

For a fresh experiment, prepare a new output directory from the project root:

```powershell
Push-Location model-service
& D:\CN360\locate-anything.cpp\venv\Scripts\python.exe -m cn360_model.experiment_images --plan ../n8n/inspection-experiment.json --assets ../test-assets/product-defects --output ../n8n/.runtime/fixed-model-experiment/new-run
Pop-Location
node n8n/scripts/fixed-model-experiment.mjs --phase develop --output n8n/.runtime/fixed-model-experiment/new-run
node n8n/scripts/fixed-model-experiment.mjs --phase parity --output n8n/.runtime/fixed-model-experiment/new-run
node n8n/scripts/fixed-model-experiment.mjs --phase evaluate --output n8n/.runtime/fixed-model-experiment/new-run
node n8n/scripts/fixed-model-experiment.mjs --phase production --output n8n/.runtime/fixed-model-experiment/new-run
node n8n/scripts/fixed-model-experiment.mjs --phase finalize --output n8n/.runtime/fixed-model-experiment/new-run
node thingsboard/scripts/check-review.mjs --output n8n/.runtime/fixed-model-experiment/new-run
```

Run phases sequentially and stop on any failed command. Development stops only
the owned native software profile; model probes run one GPU context at a time.
Production qualification is fail-fast and only considers conditions already
passing held-out quality, integrity and parity. Candidate production checks
still use review/reject until qualification is complete. Fresh model admission
waits for warm-up after a native failure; recovery time is separate from the
per-request timing figures.

The 010/011 set is now consumed. Repeating it is a regression run, not another
untouched evaluation. Further tuning requires a newly reserved split before
selection. The tool refuses to overwrite frozen selections and scored results.

Start the delivered guarded profile:

```powershell
./n8n/scripts/stop-software-bench.ps1
./thingsboard/scripts/start-native.ps1 -LocateAnythingPath D:\CN360\locate-anything.cpp -ExperimentRun "$PWD/docs/evidence/fixed-model-improvements-2026-11-03"
```

Images: MVTec AD, Bergmann et al., CVPR 2019 / IJCV 2021, CC BY-NC-SA 4.0.
Source: <https://www.mvtec.com/research-teaching/datasets/mvtec-ad>.
Mirror revision: `c75b39616f84db43677bcc8228caaafaf5096d7f`.
