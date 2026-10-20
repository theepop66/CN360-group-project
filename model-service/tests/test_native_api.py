"""Opt-in HTTP regression using the real DLL, model weights and worker."""
import io
import json
import os
from pathlib import Path
import struct

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from cn360_model.app import create_app

pytestmark = pytest.mark.skipif(os.environ.get("CN360_RUN_NATIVE_TESTS") != "1", reason="requires external native library and model weights")


def rle_bitmap() -> bytes:
    # Valid BI_RLE8 input accepted by Pillow, unsupported by upstream stb.
    # This reaches a genuine native image-decode failure through HTTP.
    pixels = bytes([32, 0, 0, 0]) * 32 + bytes([0, 1])
    palette = bytes([0, 0, 255, 0, 255, 0, 0, 0])
    header = struct.pack("<2sIHHI", b"BM", 62 + len(pixels), 0, 0, 62)
    dib = struct.pack("<IiiHHIIiiII", 40, 32, 32, 1, 8, 1, len(pixels), 0, 0, 2, 2)
    return header + dib + palette + pixels


def test_real_native_empty_success_and_decode_failure(caplog: pytest.LogCaptureFixture) -> None:
    image = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(image, format="PNG")
    bmp = rle_bitmap()
    with Image.open(io.BytesIO(bmp)) as verified:
        verified.load()
        assert verified.size == (32, 32)
    report: dict = {"scope": "Real native worker through public Model HTTP API; synthetic input images, no physical devices", "empty_requests": []}
    with TestClient(create_app(request_timeout=120)) as client:
        report["health_before"] = client.get("/health").json()
        if positive := os.environ.get("CN360_NATIVE_POSITIVE_IMAGE"):
            response = client.post("/predict", data={"prompt": "Locate all the instances that matches the following description: cat</c>remote."}, files={"file": ("fixture.png", Path(positive).read_bytes(), "image/png")})
            report["positive_request"] = {"http_status": response.status_code, "body": response.json()}
        for _ in range(2):
            response = client.post("/predict", data={"prompt": "Locate all the instances that matches the following description: cat."}, files={"file": ("empty.png", image.getvalue(), "image/png")})
            report["empty_requests"].append({"http_status": response.status_code, "body": response.json()})
        response = client.post("/predict", data={"prompt": "Locate all the instances that matches the following description: cat."}, files={"file": ("rle.bmp", bmp, "image/bmp")})
        report["native_failure"] = {"http_status": response.status_code, "body": response.json()}
        report["health_after"] = {"http_status": client.get("/health").status_code}
        report["native_stage_logs"] = [record.getMessage() for record in caplog.records if record.name == "cn360_model.worker_client"]
    if path := os.environ.get("CN360_NATIVE_REPORT"):
        Path(path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert all(item["http_status"] == 200 and item["body"]["detections"] == [] for item in report["empty_requests"])
    if "positive_request" in report:
        assert report["positive_request"]["http_status"] == 200
        assert len(report["positive_request"]["body"]["detections"]) == 4
    assert report["native_failure"]["http_status"] == 503
    assert report["native_failure"]["body"]["reason"] == "inference_failed"
    assert any("image_decode_failed" in line for line in report["native_stage_logs"])
    assert report["health_after"]["http_status"] == 503
