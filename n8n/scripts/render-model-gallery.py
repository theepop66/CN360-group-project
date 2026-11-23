"""Plot recorded native-model boxes against dataset masks; never invent detections."""
import argparse
import hashlib
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source_bytes = args.report.read_bytes()
    report = json.loads(source_bytes)
    prepared = json.loads(args.prepared.read_text(encoding="utf-8-sig"))
    output = args.output
    for name in ("images", "annotated"):
        (output / name).mkdir(parents=True, exist_ok=True)
    predictions = {row["caseId"]: row for row in report["directModel"] if row["kind"] == "jpeg"}
    records = []
    figures = {}
    cards = []
    for case in prepared:
        prediction = predictions[case["id"]]
        body = prediction["body"]
        image_path = Path(case["file"])
        image_bytes = image_path.read_bytes()
        image_hash = hashlib.sha256(image_bytes).hexdigest()
        assert image_hash == case["servedSha256"], "Prepared image hash changed"
        assert any(row.get("servedSha256") == image_hash for row in report["cases"] if row.get("caseId") == case["id"]), "Image not correlated with recorded model run"
        image = Image.open(image_path).convert("RGB")
        assert image.size == (body["frame_width"], body["frame_height"])
        boxes = [d["box"] for d in body.get("detections", [])]
        truth = None
        if case.get("mask"):
            with Image.open(case["mask"]) as mask:
                truth = mask.resize(image.size, Image.Resampling.NEAREST).getbbox()
        label = ("Normal image: false positive" if boxes else "Normal image: no boxes") if not case["hasDefect"] else (
            "Defect missed: no boxes" if not boxes else "Defective image: review location")
        annotated = image.copy()
        drawing = ImageDraw.Draw(annotated)
        if truth:
            drawing.rectangle(truth, outline="#00a86b", width=5)
        for box in boxes:
            drawing.rectangle(tuple(box), outline="#e32636", width=3)
        figures[case["id"]] = annotated
        image_name = image_path.name
        (output / "images" / image_name).write_bytes(image_bytes)
        annotated.save(output / "annotated" / (case["id"] + ".png"))
        record = {"caseId": case["id"], "target": case["target"], "datasetDefective": case["hasDefect"],
                  "inputSha256": image_hash, "width": image.width, "height": image.height,
                  "elapsedMs": prediction["elapsedMs"], "modelStatus": body["status"],
                  "predictedBoxes": boxes, "groundTruthBoundingRectangle": truth, "review": label}
        records.append(record)
        shapes = []
        if truth:
            x1, y1, x2, y2 = truth
            shapes.append(f'<rect class="truth" x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}"/>')
        for box in boxes:
            x1, y1, x2, y2 = box
            shapes.append(f'<rect class="prediction" x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}"/>')
        cards.append(f'''<article data-kind="{"defective" if case["hasDefect"] else "normal"}">
<svg viewBox="0 0 {image.width} {image.height}"><image href="images/{image_name}" width="{image.width}" height="{image.height}"/>{"".join(shapes)}</svg>
<h2>{html.escape(case["id"])}</h2><p class="review">{label}</p><p>Target: {html.escape(case["target"])}</p>
<p>{len(boxes)} model boxes · {prediction["elapsedMs"]/1000:.2f} s · {image.width} × {image.height}</p>
<a href="annotated/{case["id"]}.png" target="_blank">Open annotated image</a></article>''')
    normal = [r for r in records if not r["datasetDefective"]]
    defective = [r for r in records if r["datasetDefective"]]
    summary = {"sourceRunId": report["runId"], "recordedAt": report["startedAt"],
               "sourceReportSha256": hashlib.sha256(source_bytes.replace(b"\r\n", b"\n")).hexdigest(),
               "sourceReportHashFormat": "SHA-256 of source JSON with LF line endings", "caseCount": len(records),
               "normalTargetPairs": len(normal), "normalPairsWithBoxes": sum(bool(r["predictedBoxes"]) for r in normal),
               "defectiveTargetPairs": len(defective), "defectivePairsWithoutBoxes": sum(not r["predictedBoxes"] for r in defective),
               "interpretation": "Recorded real model inference, not controlled software responses. Boxes on defective images still require localization review; this is not an accuracy certification.",
               "cases": records}
    (output / "results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (output / "model-responses.json").write_text(json.dumps({"runId": report["runId"], "startedAt": report["startedAt"],
        "settings": report["settings"], "modelHealth": report["modelHealth"], "directPredictions": list(predictions.values())}, indent=2) + "\n", encoding="utf-8")
    page = f'''<!doctype html><html><head><meta charset="utf-8"><title>Actual AI sample results</title><style>
body{{font:16px system-ui;background:#f4f2ef;color:#222;margin:24px}}header{{max-width:1050px}}h1{{font-size:30px}}.note{{background:#fff2ca;padding:14px;border-left:5px solid #c18c00}}.bad{{color:#a9202b;font-weight:bold}}.controls{{position:sticky;top:0;background:#f4f2ef;padding:12px 0;z-index:2}}label{{margin-right:18px}}main{{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:20px}}article{{background:white;padding:14px;border-radius:8px}}svg{{width:100%;background:#eee}}h2{{font-size:16px;overflow-wrap:anywhere}}p{{line-height:1.45}}.review{{font-weight:bold}}rect{{fill:none}}.prediction{{stroke:#e32636;stroke-width:3}}.truth{{stroke:#00a86b;stroke-width:4;stroke-dasharray:8 4}}body.hide-model .prediction{{display:none}}body.hide-truth .truth{{display:none}}a{{color:#1656a3}}</style></head><body>
<header><h1>Actual AI detection results</h1><p class="note">Direct LocateAnything inference, CUDA0, q8 model. Captured run: {html.escape(report["startedAt"])} (service clock). These are real model predictions, not the controlled responses in the software-test HUD. Inputs were resized to a maximum side of 448 pixels; the diagnostic deadline was 120 seconds.</p>
<p><b style="color:#e32636">Red = model prediction</b> · <b style="color:#008957">Green dashed = known defect mask bounding rectangle</b>. Normal images have no green box.</p>
<p class="bad">The model produced boxes on all {len(normal)} normal image/target combinations and missed {sum(not r["predictedBoxes"] for r in defective)} defective example. It runs, but these results do not show reliable defect inspection.</p>
<p>Times are from that recorded run. No confidence score is shown: the model's confidence field is not meaningful. Model quality and the current production deadline remain unapproved.</p></header>
<div class="controls"><label><input id="model" type="checkbox" checked>Model boxes</label><label><input id="truth" type="checkbox" checked>Known defects</label><label>Show <select id="kind"><option value="all">All 15 tests</option><option value="defective">Defective images</option><option value="normal">Normal images</option></select></label></div>
<main>{"".join(cards)}</main><footer><p>Images: MVTec AD, Bergmann et al., CVPR 2019 / IJCV 2021, CC BY-NC-SA 4.0. <a href="model-responses.json">Raw model responses</a> · <a href="results.json">Image hashes and review data</a></p></footer>
<script>document.querySelector('#model').onchange=e=>document.body.classList.toggle('hide-model',!e.target.checked);document.querySelector('#truth').onchange=e=>document.body.classList.toggle('hide-truth',!e.target.checked);document.querySelector('#kind').onchange=e=>document.querySelectorAll('article').forEach(a=>a.hidden=e.target.value!=='all'&&a.dataset.kind!==e.target.value);</script></body></html>'''
    (output / "index.html").write_text(page, encoding="utf-8")
    selected = ["hazelnut__hole__000-1", "hazelnut__good__000-2", "capsule__crack__000-1",
                "capsule__good__000-1", "bottle__broken_large__000-1", "bottle__good__000-1"]
    title_font: ImageFont.FreeTypeFont | ImageFont.ImageFont
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont
    try:
        title_font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 24)
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 18)
    except OSError:
        title_font = font = ImageFont.load_default()
    poster = Image.new("RGB", (1440, 1160), "#f4f2ef")
    draw = ImageDraw.Draw(poster)
    draw.text((25, 15), "Real AI predictions — direct diagnostic run", fill="#222222", font=title_font)
    draw.text((25, 53), "Red: model boxes    Green: known defect    Native outputs; diagnostic deadline: 120 s", fill="#333333", font=font)
    for index, case_id in enumerate(selected):
        record = next(r for r in records if r["caseId"] == case_id)
        x, y = (index % 3) * 480 + 25, (index // 3) * 530 + 100
        image = figures[case_id].resize((430, 430), Image.Resampling.LANCZOS)
        poster.paste(image, (x, y))
        draw.text((x, y + 436), case_id.rsplit("-", 1)[0], fill="#222222", font=font)
        draw.text((x, y + 463), record["review"], fill="#9f1b28" if "false" in record["review"] or "missed" in record["review"] else "#333333", font=font)
        draw.text((x, y + 490), f'{len(record["predictedBoxes"])} boxes · {record["elapsedMs"]/1000:.2f} s', fill="#333333", font=font)
    poster.save(output / "sample-results.png")
    print(json.dumps({k: v for k, v in summary.items() if k != "cases"}, indent=2))


if __name__ == "__main__":
    main()
