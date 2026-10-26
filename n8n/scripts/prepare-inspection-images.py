"""Prepare camera-format test images; never overwrite the dataset originals."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


def prepare(assets: Path, output: Path, max_side: int = 0) -> list[dict[str, object]]:
    manifest = json.loads((assets / "manifest.json").read_text(encoding="utf-8"))
    media = output / "media"
    media.mkdir(parents=True, exist_ok=True)
    cases: list[dict[str, object]] = []
    for sample in manifest["samples"]:
        original = (assets / sample["file"]).resolve()
        if not original.is_relative_to(assets.resolve()):
            raise ValueError("Image path must stay inside the asset directory")
        original_hash = hashlib.sha256(original.read_bytes()).hexdigest()
        if original_hash != sample["sha256"]:
            raise ValueError(f"Original checksum mismatch: {original.name}")
        served = media / (original.stem + ".jpg")
        with Image.open(original) as image:
            image.load()
            if image.size != (sample["width"], sample["height"]):
                raise ValueError(f"Original dimensions mismatch: {original.name}")
            rgb = image.convert("RGB")
            if max_side:
                rgb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            rgb.save(served, quality=95, subsampling=0)
            width, height = rgb.size
        for index, target in enumerate(sample["inspection_targets"]):
            cases.append({
                "id": f"{original.stem}-{index + 1}", "file": str(served.resolve()),
                "original": str(original), "originalSha256": original_hash,
                "servedSha256": hashlib.sha256(served.read_bytes()).hexdigest(),
                "width": width, "height": height,
                "originalWidth": sample["width"], "originalHeight": sample["height"],
                "hasDefect": sample["has_defect"], "target": target,
                "mask": str((assets / sample["ground_truth_mask"]).resolve()) if sample.get("ground_truth_mask") else None,
            })
    (output / "cases.json").write_text(json.dumps(cases, indent=2) + "\n", encoding="utf-8")
    return cases


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-side", type=int, default=0, help="Optional explicit resize profile; 0 preserves original dimensions")
    args = parser.parse_args()
    if args.max_side < 0:
        parser.error("max-side must be nonnegative")
    print(f"Prepared {len(prepare(args.assets, args.output, args.max_side))} image/target cases")
