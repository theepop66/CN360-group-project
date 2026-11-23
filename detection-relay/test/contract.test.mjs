// End-to-end contract: the payload n8n builds goes through the relay and the
// HUD's own parser reads it back with the same boxes and frame identity.

import test from "node:test";
import assert from "node:assert/strict";

import { parseDetectionPayload } from "../../pico-webapp/js/overlay.js";
import { MODEL_SUCCESS_STATUS, buildInspectionDecision } from "../../n8n/lib/inspection-logic.mjs";
import { buildHudPayload } from "../../n8n/lib/inspection-records.mjs";
import { post, readyClient, startRelay } from "./helpers.mjs";

const FRAME = {
  sessionId: "session-a",
  sequence: 7,
  capturedAt: "2026-08-23T12:00:00.000Z",
  width: 1920,
  height: 1080
};

const INSTRUCTION = "Locate all the instances that matches the following description: mold.";

function hudPayloadFor(detections) {
  const decision = buildInspectionDecision({
    outcome: {
      kind: "ok",
      response: { status: MODEL_SUCCESS_STATUS, prompt_used: INSTRUCTION, detections }
    },
    frameContext: FRAME,
    instruction: INSTRUCTION
  });
  return buildHudPayload({ decision, frameContext: FRAME });
}

test("an n8n HUD payload survives the relay and the HUD parser", async () => {
  const { relay, httpUrl, wsUrl } = await startRelay();
  try {
    const client = await readyClient(wsUrl());
    const box = [100, 200, 300, 400];

    const response = await post(httpUrl(), hudPayloadFor([{ label: "mold", box, confidence: 0.0 }]));
    assert.equal(response.status, 202);

    const parsed = parseDetectionPayload(await client.next());
    assert.ok(parsed, "the HUD parser must accept what the relay sends");
    assert.equal(parsed.sessionId, "session-a");
    assert.equal(parsed.sequence, 7);
    assert.equal(parsed.detections.length, 1);
    const [detection] = parsed.detections;
    assert.deepEqual([detection.x1, detection.y1, detection.x2, detection.y2], box);
    assert.equal(detection.normalized, false);
    assert.equal(detection.confidence, null);
  } finally {
    await relay.close();
  }
});

test("the relay's own messages are ignored by the HUD parser", () => {
  assert.equal(parseDetectionPayload({ type: "connected" }), null);
  assert.equal(parseDetectionPayload({ type: "heartbeat", timestamp: "2026-08-23T12:00:00.000Z" }), null);
});
