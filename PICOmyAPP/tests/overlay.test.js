import test from "node:test";
import assert from "node:assert/strict";

import { getContainedImageRect, mapBoxToDisplay, parseDetectionPayload } from "../js/overlay.js";

test("parses the documented pixel-coordinate payload", () => {
  const result = parseDetectionPayload({
    type: "detections",
    frame: { width: 1920, height: 1080, id: "frame-7" },
    detections: [
      {
        bbox: { x1: 192, y1: 108, x2: 960, y2: 540 },
        label: "scratch",
        confidence: 0.91,
        status: "defect"
      }
    ]
  });

  assert.deepEqual(result.source, { width: 1920, height: 1080 });
  assert.equal(result.frameId, "frame-7");
  assert.equal(result.detections[0].normalized, false);
  assert.equal(result.detections[0].color, "#ff5f67");
});

test("parses an optional frame sequence for result ordering", () => {
  const result = parseDetectionPayload({
    frame: { width: 100, height: 100, sequence: 17, sessionId: "boot-a" },
    detections: []
  });

  assert.equal(result.sequence, 17);
  assert.equal(result.sessionId, "boot-a");
  assert.equal(result.timestamp, null);
});

test("accepts normalized boxes without frame dimensions", () => {
  const result = parseDetectionPayload({
    boxes: [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.7, status: "pass" }]
  });

  assert.equal(result.source, null);
  assert.equal(result.detections[0].normalized, true);
  assert.equal(result.detections[0].color, "#68efb3");
});

test("maps normalized boxes using the video aspect ratio", () => {
  const mapped = mapBoxToDisplay(
    { x1: 0, y1: 0, x2: 0.5, y2: 0.5, normalized: true },
    { width: 1920, height: 1080 },
    { width: 1000, height: 1000 }
  );

  assert.deepEqual(mapped, { x: 0, y: 218.75, width: 500, height: 281.25 });
});

test("calculates letterboxing for a contained image", () => {
  assert.deepEqual(
    getContainedImageRect({ width: 1000, height: 1000 }, { width: 1920, height: 1080 }),
    { x: 0, y: 218.75, width: 1000, height: 562.5 }
  );
});

test("maps a pixel box onto the visible image instead of the full container", () => {
  const mapped = mapBoxToDisplay(
    { x1: 0, y1: 0, x2: 960, y2: 540, normalized: false },
    { width: 1920, height: 1080 },
    { width: 1000, height: 1000 }
  );

  assert.deepEqual(mapped, { x: 0, y: 218.75, width: 500, height: 281.25 });
});

test("rejects pixel boxes when source dimensions are missing", () => {
  assert.throws(
    () => parseDetectionPayload({ boxes: [{ x1: 5, y1: 8, x2: 20, y2: 30 }] }),
    /require positive frame width and height/
  );
});

test("rejects null, blank, and boolean coordinates instead of coercing them to zero", () => {
  for (const invalidX1 of [null, "", "   ", false, true]) {
    assert.throws(
      () => parseDetectionPayload({
        frame: { width: 100, height: 100 },
        boxes: [{ x1: invalidX1, y1: 1, x2: 20, y2: 30 }]
      }),
      /Invalid bounding box/
    );
  }
});
