"""Package recorded inspection results with a static visual evidence report."""
import argparse
import html
import json
from pathlib import Path
from typing import Any

from PIL import Image


def load(path: Path) -> dict[str, Any]:
    value: dict[str, Any] = json.loads(path.read_text(encoding="utf-8-sig"))
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True, help="Managed-model output folder")
    parser.add_argument("--controller", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    args.output.mkdir(parents=True, exist_ok=True)
    fixture = load(args.fixtures)
    cold = load(args.model / "cold-start.json")
    controller = load(args.controller)
    model_path = next((p for p in [args.model / "real/report.json", args.model / "diagnostic/report.json"] if p.exists()), None)
    model = load(model_path) if model_path else {}
    prepared_path = model_path.parent / "cases.json" if model_path else args.model / "cases.json"
    prepared = json.loads(prepared_path.read_text(encoding="utf-8"))
    for name, value in [("controlled.json", fixture), ("cold-start.json", cold), ("controller.json", controller), ("model.json", model)]:
        (args.output / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    observations = []
    cards = []
    for case in prepared:
        direct: dict[str, Any] = next((r for r in model.get("directModel", []) if r["caseId"] == case["id"] and r["kind"] == "jpeg"), {})
        body = direct.get("body", {})
        boxes = [d["box"] for d in body.get("detections", [])]
        width, height = case["width"], case["height"]
        best_iou = None
        truth_box = None
        if case.get("mask"):
            with Image.open(case["mask"]) as mask:
                resized_mask = mask.resize((width, height), Image.Resampling.NEAREST)
                truth_box = resized_mask.getbbox()
            if truth_box and boxes:
                def iou(box: list[float]) -> float:
                    x1, y1, x2, y2 = truth_box
                    intersection = max(0, min(x2, box[2]) - max(x1, box[0])) * max(0, min(y2, box[3]) - max(y1, box[1]))
                    area = max(0, box[2] - box[0]) * max(0, box[3] - box[1])
                    union = area + (x2 - x1) * (y2 - y1) - intersection
                    return intersection / union if union else 0.0
                best_iou = max(map(iou, boxes))
        observation = {"caseId": case["id"], "hasDefect": case["hasDefect"], "target": case["target"], "modelStatus": body.get("status", "not evaluated"), "detectedBoxes": len(boxes), "bestGroundTruthBoundingRectangleIoU": best_iou, "elapsedMs": direct.get("elapsedMs")}
        observations.append(observation)
        # The overlay is a review illustration, never an input to the model.
        original = Path(case["original"])
        relative = Path("assets") / original.name
        (args.output / "assets").mkdir(exist_ok=True)
        # Small review thumbnails keep the evidence folder compact.
        with Image.open(original) as image:
            image.thumbnail((320, 320), Image.Resampling.LANCZOS)
            thumb = relative.with_suffix(".jpg")
            image.convert("RGB").save(args.output / thumb, quality=85)
        shapes = []
        for box in boxes:
            shapes.append(f'<rect x="{box[0]}" y="{box[1]}" width="{box[2]-box[0]}" height="{box[3]-box[1]}" fill="none" stroke="#db3030" stroke-width="2"/>')
        if truth_box:
            x1, y1, x2, y2 = truth_box
            shapes.append(f'<rect x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}" fill="none" stroke="#00a35d" stroke-dasharray="6 3" stroke-width="2"/>')
        cards.append(f'<article><svg viewBox="0 0 {width} {height}"><image href="{thumb.as_posix()}" width="{width}" height="{height}"/>{"".join(shapes)}</svg><h3>{html.escape(case["id"])}</h3><p>{html.escape(case["target"])}</p><p>Dataset: {"defective" if case["hasDefect"] else "normal"}; model: {html.escape(str(observation["modelStatus"]))}; boxes: {len(boxes)}</p><p>Best defect-rectangle IoU: {"n/a" if best_iou is None else f"{best_iou:.3f}"}</p></article>')
    failed_controlled = [c["id"] for c in fixture["cases"] if c["status"] == "failed"]
    failed_controller = [c["id"] for c in controller["cases"] if not c["requirementPassed"]]
    summary = {"scope": model.get("scope"), "controlledCases": len(fixture["cases"]), "controlledFailed": failed_controlled, "controllerFailedRequirements": failed_controller, "coldRequests": len(cold["samples"]), "coldTimeouts": sum(s.get("body", {}).get("reason") == "model_timeout" for s in cold["samples"]), "productionWarmRun": cold.get("productionWarmRun"), "modelSettings": model.get("settings"), "modelSummary": model.get("summary"), "modelSummaryByCase": model.get("summaryByCase"), "modelFatalError": model.get("fatalError"), "observations": observations, "limits": ["12 source photographs are a smoke set; no general accuracy claim", "Any returned box is not proof of correct defect localization", "IoU is against the mask's bounding rectangle and is descriptive, not an acceptance threshold", "No physical actuation, real DB or Pico delivery is established by the recording receivers"]}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    compact = {"controlledPassed": len(fixture["cases"]) - len(failed_controlled), "controlledTotal": len(fixture["cases"]), "coldTimeouts": summary["coldTimeouts"], "sequentialCaseAttempts": model.get("summary", {}).get("count", 0), "successfulEvaluations": model.get("summary", {}).get("successes", 0), "evaluationErrors": model.get("summary", {}).get("failures", 0), "controllerFailedRequirements": failed_controller}
    metric_values = [(f'{compact["controlledPassed"]}/{compact["controlledTotal"]}', "Controlled scenarios passed"), (str(compact["sequentialCaseAttempts"]), "Sequential case attempts"), (f'{compact["successfulEvaluations"]} / {compact["evaluationErrors"]}', "Inspection results / errors"), (str(compact["coldTimeouts"]), "Fresh-worker timeouts")]
    metrics = '<div style="display:flex;flex-wrap:wrap;gap:28px;margin:24px 0">' + ''.join(f'<div><strong style="display:block;font-size:30px">{value}</strong>{label}</div>' for value, label in metric_values) + '</div>'
    if failed_controller:
        controller_notice = '<p><strong>Controller acceptance failed:</strong> ' + html.escape(', '.join(failed_controller)) + '. These are virtual-time checks; hardware acceptance remains separate.</p>'
    elif controller["cases"]:
        controller_notice = '<p><strong>Virtual-time controller checks passed.</strong> Hardware acceptance remains separate.</p>'
    else:
        controller_notice = '<p>No controller checks were recorded.</p>'
    page = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CN360 static-picture test evidence</title><style>body{font:16px/1.5 system-ui;margin:30px;background:#f6f5f1;color:#222}header{max-width:1000px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}article{background:white;padding:16px;border:1px solid #ddd;border-radius:8px}svg{display:block;width:100%;aspect-ratio:1;height:auto;background:#eee}h3{overflow-wrap:anywhere;font-size:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:18px 0}</style><header><h1>Static-picture inspection results</h1><p>Red: model boxes. Green dashed: ground-truth defect bounding rectangle. Pictures are review thumbnails; inference used separately hashed inputs.</p><p>Model profile: '+html.escape(str(model.get("mode", "blocked")))+'; maximum served side: '+str(model.get("settings", {}).get("maxSide", 0))+' px (0 preserves original size). Diagnostic results do not approve the production model deadline.</p><pre>'+html.escape(json.dumps(compact, indent=2))+'</pre><details><summary>Timing and acceptance details</summary><pre>'+html.escape(json.dumps({k: v for k, v in summary.items() if k != "observations"}, indent=2))+'</pre></details></header><main>'+''.join(cards)+'</main><footer><p>MVTec AD: Bergmann et al., CVPR 2019 / IJCV 2021. Source pictures and thumbnails: <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>. Thumbnails are resized/JPEG derivatives; box overlays added for review.</p></footer>'
    # Keep the first screen readable; raw structured details remain expandable.
    page = page.replace('<pre>' + html.escape(json.dumps(compact, indent=2)) + '</pre>', metrics + controller_notice)
    (args.output / "report.html").write_text(page, encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "observations"}, indent=2))


if __name__ == "__main__":
    main()
