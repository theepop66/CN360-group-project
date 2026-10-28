# Product defect pictures for CN360 / n8n testing

12 original MVTec AD PNG photographs: 8 defective samples and 4 normal controls.
8 ground-truth masks are kept separately in `ground-truth/`; do not submit masks to the AI.

Open `gallery.html` to choose pictures. `manifest.json` contains source URLs,
image dimensions, SHA-256 checksums, labels and suggested Inspection Targets.

## Suggested starting set

| Product | Defective files | Normal control | Suggested Inspection Target |
|---|---|---|---|
| Bottle | `bottle__broken_large__000.png`, `bottle__broken_small__000.png` | `bottle__good__000.png` | `broken glass on the bottle rim` |
| Metal nut | `metal_nut__scratch__000.png`, `metal_nut__bent__000.png` | `metal_nut__good__000.png` | `scratch on the metal nut` / `bent edge of the metal nut` |
| Hazelnut | `hazelnut__crack__000.png`, `hazelnut__hole__000.png` | `hazelnut__good__000.png` | `crack in the hazelnut shell` / `hole in the hazelnut shell` |
| Capsule | `capsule__crack__000.png`, `capsule__squeeze__000.png` | `capsule__good__000.png` | `crack in the capsule` / `dented area on the capsule` |

Start with the large bottle break or hazelnut hole and the corresponding normal
control. Small bottle breaks and reflective metal surfaces are harder cases.
These difficulty suggestions are visual judgments, not measured model accuracy.

## Use in the existing project

1. Set the short Inspection Target through your existing HUD / Prompt Capture flow.
   That flow builds the canonical Model Instruction. Change the target when
   switching defect types, and use the same target on the normal control.
2. For a quick model check, use `http://localhost:8000/docs` on the model PC and
   upload one original PNG to `/predict`, using the matching Model Instruction.
   This checks the model only, not camera capture or n8n orchestration.
3. For the actual camera -> n8n -> AI loop, show one picture full-screen on a
   second display (hide gallery labels and other pictures), or print it. Point
   the Pi camera at it, fill most of the frame, minimize glare and keep focus.
   Run the existing inspection trigger. This also tests recapture, lighting,
   frame metadata and the normal Pi `/capture` path. A rephotographed picture
   is a pipeline smoke test; assess real product quality later on real objects.
4. Record detections, returned boxes, defect coverage, result and elapsed time.
   Run each defective/normal pair a few times at the same framing and lighting.

In a separate static-image test copy of the n8n workflow, the model HTTP node
can receive an image loaded as binary. Keep the n8n binary property `image`,
the model multipart field `file`, and the correct image dimensions. The shipped
`/webhook/inspect-now` trigger pulls from the Pi; it is not a file-upload endpoint.
Inside Docker, the documented model address is `http://host.docker.internal:8000`.
PNG works directly with this model service; the real Pi capture returns JPEG.

## Interpreting outcomes

Dataset labels say whether a defect is present, not whether LocateAnything will
find it. Suggested targets have not been tested with your model. No inference,
n8n execution, camera test or hardware action was performed while making this pack.
Your workflow rejects when summed detected box area / frame area is at least
0.005 (0.5%). A small detected defect can still produce `pass`; a failed model
call produces an error response with an internal reject action. Ground-truth
mask area is not the workflow's bounding-box coverage metric. Mask coordinates
apply to the original PNG only, not to a rephotographed camera frame.
The existing runtime-smoke script uses fixture model responses; it does not
measure detection quality even when given a real defect photograph.

## Sources and attribution

Original dataset: [MVTec AD](https://www.mvtec.com/research-teaching/datasets/mvtec-ad).
Downloaded as individual files from the [foersben mirror](https://huggingface.co/datasets/foersben/mvtec-ad).
Full mirror revision and per-file URLs are in `manifest.json`.

Authors: Paul Bergmann, Michael Fauser, David Sattlegger, Carsten Steger,
*MVTec AD - A Comprehensive Real-World Dataset for Unsupervised Anomaly Detection*,
CVPR 2019. Extended dataset paper: Paul Bergmann, Kilian Batzner, Michael Fauser,
David Sattlegger, Carsten Steger, IJCV 2021.

License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Noncommercial use only; preserve attribution and the applicable share-alike terms.
Original license text is included as `LICENSE.txt`. Original photos and masks
are unmodified; the gallery, selection, filenames and test notes are additions.
