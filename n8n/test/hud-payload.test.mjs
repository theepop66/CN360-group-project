import test from "node:test";
import assert from "node:assert/strict";

import { parseDetectionPayload } from "../../pico-webapp/js/overlay.js";
import { VERDICT, buildInspectionDecision, MODEL_SUCCESS_STATUS } from "../lib/inspection-logic.mjs";
import { buildHudPayload } from "../lib/inspection-records.mjs";

const FRAME = {
  sessionId: "session-a",
  sequence: 7,
  capturedAt: "2026-08-23T12:00:00.000Z",
  width: 1920,
  height: 1080
};

const INSTRUCTION = "Locate all the instances that matches the following description: mold.";

function payloadFor(detections, overrides = {}) {
  const decision = buildInspectionDecision({
    outcome: {
      kind: "ok",
      response: { status: MODEL_SUCCESS_STATUS, prompt_used: INSTRUCTION, detections }
    },
    frameContext: FRAME,
    instruction: INSTRUCTION,
    ...overrides
  });
  return { decision, payload: buildHudPayload({ decision, frameContext: FRAME }) };
}

test("the broadcast payload is accepted by the HUD parser", () => {
  const { payload } = payloadFor([{ label: "mold", box: [100, 200, 300, 400], confidence: 0.0 }]);
  const parsed = parseDetectionPayload(payload);

  assert.ok(parsed, "the HUD parser must not discard the message");
  assert.equal(parsed.detections.length, 1);
});

test("a box survives the round trip to the HUD at the same pixel coordinates", () => {
  const box = [100, 200, 300, 400];
  const { payload } = payloadFor([{ label: "mold", box, confidence: 0.0 }]);
  const [parsedBox] = parseDetectionPayload(payload).detections;

  assert.deepEqual(
    [parsedBox.x1, parsedBox.y1, parsedBox.x2, parsedBox.y2],
    box
  );
});

test("the HUD reads the boxes as pixels against the capture dimensions", () => {
  const { payload } = payloadFor([{ label: "mold", box: [100, 200, 300, 400], confidence: 0.0 }]);
  const parsed = parseDetectionPayload(payload);

  assert.equal(parsed.source.width, 1920);
  assert.equal(parsed.source.height, 1080);
  assert.equal(parsed.detections[0].normalized, false);
});

test("boxes larger than 1.0 are not mistaken for normalized coordinates", () => {
  // Without an explicit coordinateSpace the HUD infers normalization from
  // magnitude, so a small box would be silently mis-scaled.
  const { payload } = payloadFor([{ label: "mold", box: [0, 0, 1, 1], confidence: 0.0 }]);
  const parsed = parseDetectionPayload(payload);

  assert.equal(parsed.detections[0].normalized, false, "declared pixel space must win");
  assert.deepEqual([parsed.detections[0].x2, parsed.detections[0].y2], [1, 1]);
});

test("the HUD receives the frame identity it uses for ordering", () => {
  const { payload } = payloadFor([]);
  const parsed = parseDetectionPayload(payload);

  assert.equal(parsed.sessionId, "session-a");
  assert.equal(parsed.sequence, 7);
  assert.equal(parsed.timestamp, "2026-08-23T12:00:00.000Z");
});

test("multiple detections all survive the round trip", () => {
  const boxes = [
    [0, 0, 100, 100],
    [200, 300, 400, 500],
    [900, 700, 1200, 1000]
  ];
  const { payload } = payloadFor(boxes.map((box) => ({ label: "mold", box, confidence: 0.0 })));
  const parsed = parseDetectionPayload(payload);

  assert.equal(parsed.detections.length, 3);
  parsed.detections.forEach((detection, index) => {
    assert.deepEqual(
      [detection.x1, detection.y1, detection.x2, detection.y2],
      boxes[index]
    );
  });
});

test("the HUD tints a passed item green and a rejected item red", () => {
  const pass = payloadFor([{ label: "mold", box: [0, 0, 10, 10], confidence: 0.0 }]);
  const reject = payloadFor([{ label: "mold", box: [0, 0, 900, 900], confidence: 0.0 }]);

  assert.equal(parseDetectionPayload(pass.payload).detections[0].color, "#68efb3");
  assert.equal(parseDetectionPayload(reject.payload).detections[0].color, "#ff5f67");
  assert.equal(pass.decision.verdict, VERDICT.PASS);
  assert.equal(reject.decision.verdict, VERDICT.REJECT);
});

test("a sub-threshold detection is still drawn on a passed item", () => {
  // The threshold decides the physical path, never what the operator can see.
  const { decision, payload } = payloadFor([{ label: "mold", box: [0, 0, 10, 10], confidence: 0.0 }]);

  assert.equal(decision.verdict, VERDICT.PASS);
  assert.equal(parseDetectionPayload(payload).detections.length, 1);
});

test("a failed inspection still produces a parseable HUD message", () => {
  const payload = buildHudPayload({
    decision: {
      verdict: VERDICT.REJECT,
      reason: "model_timeout",
      coverage: null,
      coverageThreshold: 0.005,
      boxCount: 0,
      detections: [],
      promptVerified: null,
      promptUsed: null,
      promptMismatch: false
    },
    frameContext: FRAME
  });

  const parsed = parseDetectionPayload(payload);
  assert.equal(parsed.detections.length, 0);
  assert.equal(parsed.sessionId, "session-a", "frame identity must survive a failure");
});

test("the HUD parser never sees a confidence it could misread", () => {
  const { payload } = payloadFor([{ label: "mold", box: [0, 0, 100, 100], confidence: 0.0 }]);
  const parsed = parseDetectionPayload(payload);

  assert.equal(parsed.detections[0].confidence, null);
});
