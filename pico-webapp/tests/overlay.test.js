import test from "node:test";
import assert from "node:assert/strict";

import {
  describeResult,
  getContainedImageRect,
  getCoveredImageRect,
  mapBoxToDisplay,
  parseDetectionPayload
} from "../js/overlay.js";

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

test("flags an inspection that did not reach a model verdict as failed", () => {
  for (const reason of ["model_timeout", "model_unreachable", "frame_capture_failed", "some_new_reason"]) {
    const result = parseDetectionPayload({
      type: "detections",
      status: "reject",
      reason,
      frame: { width: 640, height: 480, id: "s:1", sessionId: "s", sequence: 1 },
      detections: []
    });
    assert.equal(result.inspectionFailed, true, reason);
    assert.equal(result.failureReason, reason);
    assert.equal(describeResult(result, { timeText: "10:15:02" }), `AI unavailable · ${reason} · 10:15:02`);
  }
});

test("does not flag a model verdict, a review outcome or a plain payload as failed", () => {
  for (const reason of ["defect_detected", "no_defect_detected", "manual_review_required"]) {
    const result = parseDetectionPayload({
      status: "pass", reason, frame: { width: 10, height: 10 }, detections: []
    });
    assert.equal(result.inspectionFailed, undefined, reason);
  }
  // Payloads from other producers carry no reason and keep their old meaning.
  const plain = parseDetectionPayload({ frame: { width: 10, height: 10 }, detections: [] });
  assert.equal(plain.inspectionFailed, undefined);
  assert.equal(plain.failureReason, undefined);
});

test("treats a payload with status error as failed even without a reason", () => {
  const result = parseDetectionPayload({ status: "error", frame: { width: 10, height: 10 }, detections: [] });
  assert.equal(result.inspectionFailed, true);
  assert.equal(result.failureReason, "error");
});

test("a failed inspection is never described as no detections", () => {
  // With an inspection policy n8n also marks the failure as needing review; the failure still wins.
  const failed = parseDetectionPayload({
    status: "reject",
    reason: "model_timeout",
    reviewRequired: true,
    reviewReason: "model_timeout",
    modelSuggestion: null,
    frame: { width: 640, height: 480 },
    detections: []
  });
  assert.match(describeResult(failed), /^AI unavailable · model_timeout/);
  assert.doesNotMatch(describeResult(failed), /no detections/i);
});

test("keeps the existing wording for evaluated results", () => {
  const clean = parseDetectionPayload({
    status: "pass", reason: "no_defect_detected", frame: { width: 10, height: 10 }, detections: []
  });
  assert.equal(describeResult(clean, { timeText: "10:15:02" }), "AI reports no detections");

  const one = parseDetectionPayload({
    status: "reject",
    reason: "defect_detected",
    frame: { width: 100, height: 100 },
    detections: [{ label: "scratch", box: [1, 1, 50, 50] }]
  });
  assert.equal(describeResult(one, { timeText: "10:15:02" }), "1 detection · 10:15:02");

  const two = parseDetectionPayload({
    status: "reject",
    frame: { width: 100, height: 100 },
    detections: [{ box: [1, 1, 50, 50] }, { box: [60, 60, 90, 90] }]
  });
  assert.equal(describeResult(two, { timeText: "10:15:02" }), "2 detections · 10:15:02");

  const review = parseDetectionPayload({
    status: "reject",
    reason: "manual_review_required",
    reviewRequired: true,
    modelSuggestion: "pass",
    frame: { width: 10, height: 10 },
    detections: []
  });
  assert.equal(describeResult(review), "Human review required · controller reject · model suggestion: pass");
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

test("maps boxes through the cropped area when the video uses object-fit cover", () => {
  assert.deepEqual(
    getCoveredImageRect({ width: 100, height: 100 }, { width: 200, height: 100 }),
    { x: -50, y: 0, width: 200, height: 100 }
  );

  const mapped = mapBoxToDisplay(
    { x1: 50, y1: 0, x2: 150, y2: 100, normalized: false },
    { width: 200, height: 100 },
    { width: 100, height: 100 },
    "cover"
  );

  assert.deepEqual(mapped, { x: 0, y: 0, width: 100, height: 100 });
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
