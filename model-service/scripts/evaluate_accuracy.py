"""Measure pass/reject accuracy of the running model service on labelled photos.

Put real product photos in two folders and run against a started service:

    dataset/
      good/     items that should PASS
      defect/   items that should be REJECTED

    python scripts/evaluate_accuracy.py --dataset dataset --target "scratch" \
        --output accuracy.json --csv accuracy.csv

Each image goes to POST /predict. The verdict uses the same rule as the n8n
Inspection Loop (n8n/lib/inspection-logic.mjs): Defect Coverage = summed box
area / frame area, clamped to [0, 1]; reject when coverage >= threshold. A
request that errors is reported separately and, like the line, counted as a
reject in the "as deployed" figures.

It never touches the Pi, ESP32, database or relay.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

import httpx

DEFAULT_THRESHOLD = 0.005  # n8n DEFAULT_COVERAGE_THRESHOLD
INSTRUCTION_TEMPLATE = "Locate all the instances that matches the following description: {target}."
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp"}
LABELS = ("good", "defect")
SWEEP = (0.0, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1)


def finite(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def box_area(box: Any) -> float:
    """Mirror of n8n boxArea: malformed boxes contribute nothing."""
    if not isinstance(box, (list, tuple)) or len(box) < 4:
        return 0.0
    coords = [finite(value) for value in box[:4]]
    x1, y1, x2, y2 = coords
    if x1 is None or y1 is None or x2 is None or y2 is None:
        return 0.0
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def defect_coverage(detections: Iterable[Any], width: Any, height: Any) -> float | None:
    """Mirror of n8n defectCoverage: boxes are summed, not unioned, then clamped."""
    w, h = finite(width), finite(height)
    if w is None or h is None or w <= 0 or h <= 0:
        return None
    covered = 0.0
    for candidate in detections or []:
        box = candidate.get("box") if isinstance(candidate, dict) else candidate
        covered += box_area(box)
    return min(1.0, max(0.0, covered / (w * h)))


def decide(coverage: float | None, threshold: float) -> str:
    """Mirror of n8n decideVerdict: unreadable coverage fails closed."""
    if coverage is None:
        return "reject"
    return "reject" if coverage >= threshold else "pass"


@dataclass
class Sample:
    path: str
    label: str
    status: str  # "ok" or "error"
    coverage: float | None = None
    boxes: int = 0
    http_ms: float | None = None
    error: str | None = None


@dataclass
class Scores:
    threshold: float
    true_reject: int = 0  # defect caught
    missed_defect: int = 0  # defect passed: the costly mistake
    false_reject: int = 0  # good item thrown out
    true_pass: int = 0
    errors: int = 0
    evaluated: int = 0
    extra: dict[str, float | None] = field(default_factory=dict)


def ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def score(samples: list[Sample], threshold: float, *, errors_reject: bool) -> Scores:
    """Confusion counts with 'defect' as the positive class.

    errors_reject=False scores model quality only (errored images left out);
    errors_reject=True scores what the line would do (an error is a reject).
    """
    result = Scores(threshold=threshold)
    for sample in samples:
        if sample.status != "ok":
            result.errors += 1
            if not errors_reject:
                continue
            verdict = "reject"
        else:
            verdict = decide(sample.coverage, threshold)
        result.evaluated += 1
        if sample.label == "defect":
            if verdict == "reject":
                result.true_reject += 1
            else:
                result.missed_defect += 1
        elif verdict == "reject":
            result.false_reject += 1
        else:
            result.true_pass += 1
    defects = result.true_reject + result.missed_defect
    goods = result.false_reject + result.true_pass
    rejected = result.true_reject + result.false_reject
    result.extra = {
        "accuracy": ratio(result.true_reject + result.true_pass, result.evaluated),
        "defect_catch_rate": ratio(result.true_reject, defects),  # recall
        "missed_defect_rate": ratio(result.missed_defect, defects),
        "false_reject_rate": ratio(result.false_reject, goods),
        "reject_precision": ratio(result.true_reject, rejected),
    }
    return result


def recommend_threshold(samples: list[Sample]) -> dict[str, Any] | None:
    """Highest threshold that still catches as many defects as any threshold can.

    Missing a defect costs more than a false reject, so the catch rate is fixed
    at its best value first and only then are false rejects minimised.
    """
    ok = [sample for sample in samples if sample.status == "ok" and sample.coverage is not None]
    if not any(sample.label == "defect" for sample in ok):
        return None
    # Threshold 0 rejects every item whatever the model saw, so it is never a
    # real choice; only thresholds the model's own boxes can cross are tried.
    candidates = sorted({*(s.coverage for s in ok if s.coverage), *(t for t in SWEEP if t > 0)})
    scored = [score(ok, threshold, errors_reject=False) for threshold in candidates]
    best_catch = max(entry.true_reject for entry in scored)
    if best_catch == 0:
        return {
            "threshold": None,
            "why": "the model flagged no defect image at any threshold; check the Inspection Target and the photos",
        }
    keep = [entry for entry in scored if entry.true_reject == best_catch]
    fewest_false = min(entry.false_reject for entry in keep)
    chosen = max((entry for entry in keep if entry.false_reject == fewest_false), key=lambda entry: entry.threshold)
    return {
        "threshold": chosen.threshold,
        "why": "highest threshold with the best defect catch rate, then fewest false rejects",
        **asdict(chosen),
    }


def collect(dataset: Path) -> list[tuple[Path, str]]:
    images: list[tuple[Path, str]] = []
    for label in LABELS:
        folder = dataset / label
        if not folder.is_dir():
            raise SystemExit(f"missing folder: {folder} (expected {', '.join(LABELS)} under the dataset)")
        images += [(path, label) for path in sorted(folder.iterdir()) if path.suffix.lower() in IMAGE_SUFFIXES]
    if not images:
        raise SystemExit(f"no .jpg/.png/.bmp images under {dataset}/good or {dataset}/defect")
    return images


def run(client: httpx.Client, images: list[tuple[Path, str]], instruction: str, *, quiet: bool = False) -> list[Sample]:
    samples: list[Sample] = []
    for index, (path, label) in enumerate(images, 1):
        started = time.perf_counter()
        try:
            response = client.post("/predict", data={"prompt": instruction}, files={"file": (path.name, path.read_bytes())})
            elapsed = (time.perf_counter() - started) * 1000
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            samples.append(Sample(str(path), label, "error", error=f"transport: {exc}"))
            continue
        if response.status_code != 200 or body.get("status") != "success":
            samples.append(Sample(str(path), label, "error", http_ms=elapsed, error=str(body.get("reason") or response.status_code)))
        else:
            detections = body.get("detections") or []
            coverage = defect_coverage(detections, body.get("frame_width"), body.get("frame_height"))
            samples.append(Sample(str(path), label, "ok", coverage=coverage, boxes=len(detections), http_ms=elapsed))
        if not quiet:
            last = samples[-1]
            shown = f"coverage {last.coverage:.4f}" if last.coverage is not None else f"ERROR {last.error}"
            print(f"[{index}/{len(images)}] {label:6} {path.name}: {shown}", flush=True)
    return samples


def build_report(samples: list[Sample], instruction: str, threshold: float) -> dict[str, Any]:
    return {
        "instruction": instruction,
        "threshold": threshold,
        "counts": {label: sum(1 for s in samples if s.label == label) for label in LABELS},
        "model_quality": asdict(score(samples, threshold, errors_reject=False)),
        "as_deployed": asdict(score(samples, threshold, errors_reject=True)),
        "sweep": [asdict(score(samples, t, errors_reject=False)) for t in SWEEP],
        "recommended": recommend_threshold(samples),
        "samples": [asdict(sample) for sample in samples],
        "scope": "model HTTP only, labelled still photos; not line timing or hardware acceptance",
    }


def percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def summary(report: dict[str, Any]) -> str:
    quality = report["model_quality"]
    extra = quality["extra"]
    lines = [
        f"images: {report['counts']['good']} good, {report['counts']['defect']} defect; errors: {quality['errors']}",
        f"threshold {report['threshold']}: caught {quality['true_reject']}, missed {quality['missed_defect']}, "
        f"false reject {quality['false_reject']}, passed {quality['true_pass']}",
        f"accuracy {percent(extra['accuracy'])}, defect catch rate {percent(extra['defect_catch_rate'])}, "
        f"false reject rate {percent(extra['false_reject_rate'])}",
    ]
    rec = report["recommended"]
    if rec and rec["threshold"] is None:
        lines.append(f"no threshold suggested: {rec['why']}")
    elif rec:
        lines.append(f"suggested threshold {rec['threshold']:.4f}: catch rate {percent(rec['extra']['defect_catch_rate'])}, "
                     f"false reject rate {percent(rec['extra']['false_reject_rate'])}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, required=True, help="folder holding good/ and defect/")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--target", help='Inspection Target, e.g. "scratch"; wrapped in the canonical instruction')
    target.add_argument("--prompt", help="exact Model Instruction to send instead of --target")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="model service base URL")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="Coverage Threshold (default 0.005)")
    parser.add_argument("--timeout", type=float, default=130, help="client timeout per image, seconds")
    parser.add_argument("--output", type=Path, help="JSON report path")
    parser.add_argument("--csv", type=Path, help="per-image CSV path")
    args = parser.parse_args(argv)
    if not 0 <= args.threshold <= 1:
        parser.error("threshold must be between 0 and 1")

    instruction = args.prompt.strip() if args.prompt else INSTRUCTION_TEMPLATE.format(target=args.target.strip())
    images = collect(args.dataset)
    with httpx.Client(base_url=args.url, timeout=args.timeout) as client:
        health = client.get("/health")
        if health.status_code != 200:
            print(f"model service not ready: {health.text}", file=sys.stderr)
            return 2
        samples = run(client, images, instruction)

    report = build_report(samples, instruction, args.threshold)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with args.csv.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(asdict(samples[0]).keys()))
            writer.writeheader()
            writer.writerows(asdict(sample) for sample in samples)
    print(summary(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
