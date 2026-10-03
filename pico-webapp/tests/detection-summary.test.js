import test from "node:test";
import assert from "node:assert/strict";

import { describeDetectionResult, parseDetectionPayload, verdictKind } from "../js/overlay.js";

const FRAME = { id: "s1:7", sessionId: "s1", sequence: 7, width: 1920, height: 1080 };

function n8nPayload(overrides = {}) {
  return {
    type: "detections",
    coordinateSpace: "pixel",
    status: "reject",
    reason: "defect_detected",
    timestamp: "2026-08-23T12:00:00.000Z",
    frame: FRAME,
    detections: [{ label: "mold", box: [100, 200, 300, 400], status: "reject" }],
    ...overrides
  };
}

test("a fail-closed reject with no boxes does not read like a clean pass", () => {
  const parsed = parseDetectionPayload(n8nPayload({ reason: "model_timeout", detections: [] }));

  assert.equal(verdictKind(parsed), "reject");
  assert.equal(describeDetectionResult(parsed, "12:00:00"), "Rejected · model timeout · no detections · 12:00:00");
});

test("a reject caused by a detected defect leads with the verdict and box count", () => {
  const parsed = parseDetectionPayload(n8nPayload());

  assert.equal(describeDetectionResult(parsed, "12:00:00"), "Rejected · 1 detection · 12:00:00");
});

test("a pass is labelled as a pass", () => {
  const parsed = parseDetectionPayload(n8nPayload({ status: "pass", reason: "no_defect_detected", detections: [] }));

  assert.equal(verdictKind(parsed), "pass");
  assert.equal(describeDetectionResult(parsed, "12:00:00"), "Passed · no detections · 12:00:00");
});

test("a frame-capture failure without frame geometry still parses and explains itself", () => {
  const parsed = parseDetectionPayload(n8nPayload({
    reason: "frame_capture_failed",
    timestamp: null,
    frame: { id: null, sessionId: null, sequence: null, width: null, height: null },
    detections: []
  }));

  assert.equal(describeDetectionResult(parsed, "now"), "Rejected · frame capture failed · no detections · now");
});

test("producers that send no verdict keep the original wording", () => {
  const parsed = parseDetectionPayload({ frame: { width: 100, height: 100 }, detections: [] });

  assert.equal(verdictKind(parsed), null);
  assert.equal(describeDetectionResult(parsed, "12:00:00"), "AI reports no detections");
});
