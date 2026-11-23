"""Prepare immutable experiment views; held-out images never select crops."""

import argparse
import hashlib
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from PIL import Image


def prepare_view(image: Image.Image, crop: list[float], max_side: int) -> tuple[bytes, dict[str, Any]]:
    if len(crop) != 4 or not (0 <= crop[0] < crop[2] <= 1 and 0 <= crop[1] < crop[3] <= 1) or max_side <= 0:
        raise ValueError("Invalid normalized crop or image size")
    pixels = [math.floor(crop[0] * image.width), math.floor(crop[1] * image.height),
              math.ceil(crop[2] * image.width), math.ceil(crop[3] * image.height)]
    rgb = image.convert("RGB").crop((pixels[0], pixels[1], pixels[2], pixels[3]))
    rgb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    rgb.save(stream, format="JPEG", quality=95, subsampling=0)
    return stream.getvalue(), {"width": rgb.width, "height": rgb.height, "cropPixels": pixels,
                              "originalWidth": image.width, "originalHeight": image.height}


def source_box(box: list[float], geometry: dict[str, Any]) -> list[float]:
    x1, y1, x2, y2 = geometry["cropPixels"]
    return [x1 + box[0] / geometry["width"] * (x2 - x1), y1 + box[1] / geometry["height"] * (y2 - y1),
            x1 + box[2] / geometry["width"] * (x2 - x1), y1 + box[3] / geometry["height"] * (y2 - y1)]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def prepare(plan_path: Path, assets: Path, output: Path) -> None:
    frozen_path = output / "inputs.json"
    if frozen_path.exists():
        raise ValueError("Experiment inputs are already frozen; choose a new directory")
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes)
    manifest = json.loads((assets / "manifest.json").read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    (output / ".gitignore").write_text("source/\n*.log\n*.local.json\n", encoding="utf-8")
    records: list[dict[str, Any]] = []
    source_samples = manifest["samples"]
    for split in ["development", "heldout"]:
        for sample in source_samples:
            indices = ["000"] if split == "development" else plan["heldoutIndices"]
            for index in indices:
                source_path = sample["source_path"].replace("000.png", index + ".png")
                name = f'{sample["category"]}__{sample["dataset_label"]}__{index}'
                source_url = sample["source_url"].replace("000.png", index + ".png")
                if split == "development":
                    data = (assets / sample["file"]).read_bytes()
                    if digest(data) != sample["sha256"]:
                        raise ValueError("Development source changed")
                else:
                    with urlopen(source_url, timeout=60) as response:
                        data = response.read()
                original_file = output / "source" / split / (name + ".png")
                original_file.parent.mkdir(parents=True, exist_ok=True)
                original_file.write_bytes(data)
                mask_file: Path | None = None
                if sample.get("mask_source_url"):
                    if split == "development":
                        mask_data = (assets / sample["ground_truth_mask"]).read_bytes()
                    else:
                        with urlopen(sample["mask_source_url"].replace("000_mask.png", index + "_mask.png"), timeout=60) as response:
                            mask_data = response.read()
                    mask_file = output / "masks" / split / (name + ".png")
                    mask_file.parent.mkdir(parents=True, exist_ok=True)
                    mask_file.write_bytes(mask_data)
                views: dict[str, Any] = {}
                with Image.open(io.BytesIO(data)) as image:
                    for view_name, crop in plan["crops"].items():
                        encoded, geometry = prepare_view(image, crop, plan["imageMaxSide"])
                        served = output / "inputs" / split / f"{name}__{view_name}.jpg"
                        served.parent.mkdir(parents=True, exist_ok=True)
                        served.write_bytes(encoded)
                        views[view_name] = {**geometry, "file": served.relative_to(output).as_posix(), "sha256": digest(encoded)}
                records.append({"id": name, "split": split, "category": sample["category"], "label": sample["dataset_label"],
                                "hasDefect": sample["has_defect"], "originalSha256": digest(data), "sourcePath": source_path,
                                "sourceUrl": source_url, "maskFile": mask_file.relative_to(output).as_posix() if mask_file else None,
                                "maskSha256": digest(mask_file.read_bytes()) if mask_file else None, "views": views})
                print(f"Prepared {split}: {name}", flush=True)
    development = {row["originalSha256"] for row in records if row["split"] == "development"}
    heldout = {row["originalSha256"] for row in records if row["split"] == "heldout"}
    if development & heldout:
        raise ValueError("An original image crosses development and held-out splits")
    frozen_path.write_text(json.dumps({"frozenAt": datetime.now(timezone.utc).isoformat(), "planSha256": digest(plan_bytes),
                                      "plan": plan, "datasetRevision": manifest["mirror_revision"], "images": records}, indent=2) + "\n", encoding="utf-8")


def score_boxes(report_path: Path, inputs_path: Path) -> None:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    frozen = json.loads(inputs_path.read_text(encoding="utf-8"))
    images = {row["id"]: row for row in frozen["images"]}
    for sample in report["samples"]:
        original = images[sample["imageId"]]
        geometry = original["views"][sample["crop"]]
        boxes = [source_box(row["box"], geometry) for row in sample.get("detections", [])]
        sample["sourceBoxes"] = boxes
        sample["boxesWithinFrame"] = all(0 <= row["box"][0] < row["box"][2] <= geometry["width"] and
                                         0 <= row["box"][1] < row["box"][3] <= geometry["height"] for row in sample.get("detections", []))
        if original["maskFile"]:
            mask_path = inputs_path.parent / original["maskFile"]
            if digest(mask_path.read_bytes()) != original["maskSha256"]:
                raise ValueError("Ground-truth mask changed")
            with Image.open(mask_path) as source_mask:
                mask = source_mask.convert("L")
                pixels = mask.load()
                assert pixels is not None
                defect_pixels = hit_pixels = 0
                for y in range(mask.height):
                    for x in range(mask.width):
                        if pixels[x, y]:
                            defect_pixels += 1
                            if any(box[0] <= x < box[2] and box[1] <= y < box[3] for box in boxes):
                                hit_pixels += 1
                sample["defectMaskRecall"] = hit_pixels / defect_pixels if defect_pixels else None
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--score", type=Path)
    parser.add_argument("--inputs", type=Path)
    args = parser.parse_args()
    if args.score and args.inputs:
        score_boxes(args.score, args.inputs)
    elif args.plan and args.assets and args.output:
        prepare(args.plan, args.assets, args.output)
    else:
        parser.error("Provide --plan --assets --output, or --score --inputs")
