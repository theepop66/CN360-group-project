import io
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from cn360_model.app import create_app
from scripts.evaluate_accuracy import (
    Sample,
    build_report,
    collect,
    decide,
    defect_coverage,
    recommend_threshold,
    run,
    score,
)

REPO = Path(__file__).resolve().parents[2]


def test_coverage_matches_the_n8n_rule() -> None:
    # 10x10 box on a 100x100 frame is 1% of the frame.
    assert defect_coverage([{"box": [0, 0, 10, 10]}], 100, 100) == pytest.approx(0.01)
    # Overlapping boxes are summed, not unioned, then clamped to 1.
    assert defect_coverage([{"box": [0, 0, 100, 100]}, {"box": [0, 0, 100, 100]}], 100, 100) == 1.0
    # Malformed boxes add nothing; unreadable frame size is unreadable coverage.
    assert defect_coverage([{"box": [5, 5, 1, 1]}, {"box": [0, 0, "x", 4]}], 100, 100) == 0.0
    assert defect_coverage([], 0, 100) is None
    assert decide(None, 0.005) == "reject", "unreadable coverage fails closed"
    assert decide(0.005, 0.005) == "reject", "the threshold itself rejects"
    assert decide(0.0049, 0.005) == "pass"


def test_coverage_is_identical_to_the_n8n_implementation() -> None:
    cases: list[tuple[list[Any], Any, Any]] = [
        ([{"box": [0, 0, 10, 10]}], 100, 100),
        ([{"box": [0, 0, 100, 100]}, {"box": [10, 10, 60, 60]}], 100, 100),
        ([{"box": [5, 5, 1, 1]}, {"box": [0, 0, True, 4]}, [1, 1, 3, 3]], 50, 40),
        ([], 640, 480),
        ([{"box": [0, 0, 1, 1]}], 0, 480),
    ]
    script = (
        "import { defectCoverage } from './n8n/lib/inspection-logic.mjs';"
        f"const cases = {json.dumps(cases)};"
        "console.log(JSON.stringify(cases.map(([d, w, h]) => defectCoverage(d, w, h))));"
    )
    try:
        out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, check=True)
    except FileNotFoundError:
        pytest.skip("node is not installed")
    expected = json.loads(out.stdout)
    actual = [defect_coverage(d, w, h) for d, w, h in cases]
    assert actual == pytest.approx(expected)


def samples() -> list[Sample]:
    return [
        Sample("d1", "defect", "ok", coverage=0.02),
        Sample("d2", "defect", "ok", coverage=0.008),
        Sample("d3", "defect", "ok", coverage=0.001),  # faint defect
        Sample("g1", "good", "ok", coverage=0.0),
        Sample("g2", "good", "ok", coverage=0.006),  # model sees something on a good item
        Sample("g3", "good", "error", error="model_timeout"),
    ]


def test_scores_separate_model_quality_from_what_the_line_does() -> None:
    quality = score(samples(), 0.005, errors_reject=False)
    assert (quality.true_reject, quality.missed_defect, quality.false_reject, quality.true_pass) == (2, 1, 1, 1)
    assert quality.errors == 1 and quality.evaluated == 5
    assert quality.extra["defect_catch_rate"] == pytest.approx(2 / 3)
    assert quality.extra["false_reject_rate"] == pytest.approx(1 / 2)

    line = score(samples(), 0.005, errors_reject=True)
    assert line.false_reject == 2, "the errored good item is rejected on the line"
    assert line.evaluated == 6


def test_recommendation_never_trades_away_caught_defects() -> None:
    rec = recommend_threshold(samples())
    assert rec is not None
    # 0.001 is the highest threshold still catching all three defects.
    assert rec["threshold"] == pytest.approx(0.001)
    assert rec["missed_defect"] == 0
    assert rec["false_reject"] == 1


def test_recommendation_needs_defect_examples() -> None:
    assert recommend_threshold([Sample("g", "good", "ok", coverage=0.0)]) is None


def write_image(path: Path, colour: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (100, 100), colour).save(path, format="PNG")


class ColourModel:
    """Fake model: a red frame has a 20x20 'defect', anything else is clean."""

    ready = False
    backend = "fixture"
    error: str | None = None

    async def start(self) -> None:
        self.ready = True

    async def close(self) -> None:
        self.ready = False

    async def predict(self, data: bytes, prompt: str, timeout: float) -> dict[str, Any]:
        with Image.open(io.BytesIO(data)) as image:
            red = image.convert("RGB").getpixel((50, 50)) == (255, 0, 0)
        return {"detections": [{"label": "defect", "box": [0, 0, 20, 20]}] if red else [], "timings_ms": {}}


def test_end_to_end_against_the_real_http_app(tmp_path: Path) -> None:
    write_image(tmp_path / "defect" / "a.png", "red")
    write_image(tmp_path / "defect" / "b.png", "white")  # a defect the model misses
    write_image(tmp_path / "good" / "c.png", "white")
    (tmp_path / "good" / "notes.txt").write_text("ignored")

    images = collect(tmp_path)
    assert len(images) == 3
    with TestClient(create_app(model=ColourModel())) as client:
        found = run(client, images, "Locate all the instances that matches the following description: dent.", quiet=True)

    report = build_report(found, "dent", 0.005)
    quality = report["model_quality"]
    assert quality["true_reject"] == 1
    assert quality["missed_defect"] == 1
    assert quality["true_pass"] == 1
    by_name = {Path(sample.path).name: sample for sample in found}
    assert by_name["a.png"].coverage == pytest.approx(0.04)  # 20x20 of 100x100
    assert by_name["c.png"].coverage == 0.0
    assert report["counts"] == {"good": 1, "defect": 2}
    json.dumps(report)  # the report must be serialisable as written


def test_missing_folder_is_a_clear_error(tmp_path: Path) -> None:
    (tmp_path / "good").mkdir()
    with pytest.raises(SystemExit, match="defect"):
        collect(tmp_path)


def test_reject_everything_is_never_suggested() -> None:
    blind = [
        Sample("d1", "defect", "ok", coverage=0.0),
        Sample("g1", "good", "ok", coverage=0.0),
    ]
    rec = recommend_threshold(blind)
    assert rec is not None
    assert rec["threshold"] is None, "threshold 0 would reject every item, which is not a fix"
    assert "no defect" in rec["why"]
