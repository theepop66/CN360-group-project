import test from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_INSTRUCTION_TEMPLATE,
  buildControlActionRow,
  buildHudPayload,
  buildInspectionRow,
  buildModelInstruction,
  buildPromptHistoryRow,
  buildSystemLogRow
} from "../lib/inspection-records.mjs";
import {
  MODEL_SUCCESS_STATUS,
  VERDICT,
  buildInspectionDecision
} from "../lib/inspection-logic.mjs";

const FRAME = {
  sessionId: "session-a",
  sequence: 7,
  capturedAt: "2026-08-23T12:00:00.000Z",
  width: 1000,
  height: 1000
};

const INSPECTED_AT = "2026-08-23T12:00:01.000Z";
const TARGET = "mold";

function passDecision(overrides = {}) {
  return {
    verdict: VERDICT.PASS,
    reason: "no_defect_detected",
    coverage: 0,
    coverageThreshold: 0.005,
    boxCount: 0,
    detections: [],
    promptVerified: true,
    promptUsed: "unused",
    promptMismatch: false,
    ...overrides
  };
}

test("a bare target becomes the canonical model instruction", () => {
  const instruction = buildModelInstruction("mold");
  assert.equal(instruction, "Locate all the instances that matches the following description: mold.");
  assert.equal(instruction, MODEL_INSTRUCTION_TEMPLATE.replace("{target}", "mold"));
});

test("punctuation and whitespace variants of a target produce one instruction", () => {
  const expected = "Locate all the instances that matches the following description: mold.";
  for (const target of ["mold", "mold.", "mold ", "  mold  ", "mold!", "mold? ", "mold..."]) {
    assert.equal(buildModelInstruction(target), expected, `target: ${JSON.stringify(target)}`);
  }
});

test("interior punctuation is preserved without doubling the terminator", () => {
  assert.equal(
    buildModelInstruction("bruised spot on fruit, small"),
    "Locate all the instances that matches the following description: bruised spot on fruit, small."
  );
  assert.equal(
    buildModelInstruction("a scratch."),
    "Locate all the instances that matches the following description: a scratch."
  );
});

test("an empty target produces no instruction", () => {
  for (const target of ["", "   ", ".", "!?", null, undefined, 42, {}]) {
    assert.equal(buildModelInstruction(target), null, `target: ${JSON.stringify(target)}`);
  }
});

test("the instruction is used verbatim for prompt verification", () => {
  const instruction = buildModelInstruction("mold");
  const decision = buildInspectionDecision({
    outcome: {
      kind: "ok",
      response: { status: MODEL_SUCCESS_STATUS, prompt_used: instruction, detections: [] }
    },
    frameContext: FRAME,
    instruction
  });

  assert.equal(decision.promptVerified, true);
});

test("an inspection row carries the target, the instruction and the decision", () => {
  const row = buildInspectionRow(passDecision(), {
    frameContext: FRAME,
    inspectionTarget: TARGET,
    modelInstruction: "Locate all the instances that matches the following description: mold.",
    inspectedAt: INSPECTED_AT,
    frameUrl: null
  });

  assert.deepEqual(row, {
    inspection_at: INSPECTED_AT,
    inspection_target: TARGET,
    model_instruction: "Locate all the instances that matches the following description: mold.",
    camera_session: "session-a",
    frame_sequence: 7,
    frame_width: 1000,
    frame_height: 1000,
    box_count: 0,
    defect_coverage: 0,
    coverage_threshold: 0.005,
    verdict: VERDICT.PASS,
    prompt_verified: true,
    frame_url: null
  });
});

test("an inspection row records the coverage figure and box count", () => {
  const row = buildInspectionRow(
    passDecision({ verdict: VERDICT.REJECT, reason: "defect_detected", coverage: 0.09, boxCount: 1, detections: [{ label: "mold", box: [0, 0, 300, 300] }] }),
    {
      frameContext: FRAME,
      inspectionTarget: TARGET,
      modelInstruction: "instruction",
      inspectedAt: INSPECTED_AT,
      frameUrl: "https://storage.example/frame.jpg"
    }
  );

  assert.equal(row.defect_coverage, 0.09);
  assert.equal(row.box_count, 1);
  assert.equal(row.frame_url, "https://storage.example/frame.jpg");
});

test("a failed inspection row records a null coverage figure", () => {
  const row = buildInspectionRow(
    { verdict: VERDICT.REJECT, reason: "model_timeout", coverage: null, coverageThreshold: 0.005, boxCount: 0, detections: [], promptVerified: null, promptUsed: null, promptMismatch: false },
    { frameContext: FRAME, inspectionTarget: TARGET, modelInstruction: "instruction", inspectedAt: INSPECTED_AT, frameUrl: null }
  );

  assert.equal(row.defect_coverage, null);
  assert.equal(row.box_count, 0);
  assert.equal(row.prompt_verified, null);
  assert.equal(row.verdict, VERDICT.REJECT);
});

test("an inspection row survives a missing frame context", () => {
  const row = buildInspectionRow(passDecision(), {
    frameContext: null,
    inspectionTarget: TARGET,
    modelInstruction: "instruction",
    inspectedAt: INSPECTED_AT,
    frameUrl: null
  });

  assert.equal(row.camera_session, null);
  assert.equal(row.frame_sequence, null);
  assert.equal(row.frame_width, null);
  assert.equal(row.frame_height, null);
});

test("a control action row records the ESP32 outcome", () => {
  const row = buildControlActionRow({
    inspectionId: "3f2b1c4d-0000-4000-8000-000000000000",
    action: VERDICT.REJECT,
    esp32Accepted: true,
    esp32Status: 200,
    requestedAt: INSPECTED_AT
  });

  assert.deepEqual(row, {
    inspection_id: "3f2b1c4d-0000-4000-8000-000000000000",
    action: VERDICT.REJECT,
    esp32_accepted: true,
    esp32_status: 200,
    requested_at: INSPECTED_AT
  });
});

test("a control action row records a rejected or unanswered ESP32", () => {
  const row = buildControlActionRow({
    inspectionId: "abc",
    action: VERDICT.PASS,
    esp32Accepted: false,
    esp32Status: null,
    requestedAt: INSPECTED_AT
  });

  assert.equal(row.esp32_accepted, false);
  assert.equal(row.esp32_status, null);
});

test("a prompt history row records the target change and its source", () => {
  const row = buildPromptHistoryRow({
    changedAt: INSPECTED_AT,
    inspectionTarget: TARGET,
    modelInstruction: "Locate all the instances that matches the following description: mold.",
    source: "hud",
    modelHttpStatus: 200
  });

  assert.deepEqual(row, {
    changed_at: INSPECTED_AT,
    inspection_target: TARGET,
    model_instruction: "Locate all the instances that matches the following description: mold.",
    source: "hud",
    model_http_status: 200
  });
});

test("a prompt history row records a model server that refused the change", () => {
  const row = buildPromptHistoryRow({
    changedAt: INSPECTED_AT,
    inspectionTarget: TARGET,
    modelInstruction: "instruction",
    source: "hud",
    modelHttpStatus: 500
  });

  assert.equal(row.model_http_status, 500);
});

test("a system log row records severity, component and details", () => {
  const row = buildSystemLogRow({
    loggedAt: INSPECTED_AT,
    severity: "error",
    component: "inspection-loop",
    message: "model call exceeded the verdict window",
    details: { reason: "model_timeout" }
  });

  assert.deepEqual(row, {
    logged_at: INSPECTED_AT,
    severity: "error",
    component: "inspection-loop",
    message: "model call exceeded the verdict window",
    details: { reason: "model_timeout" }
  });
});

test("a system log row tolerates missing details", () => {
  const row = buildSystemLogRow({
    loggedAt: INSPECTED_AT,
    severity: "info",
    component: "health-watchdog",
    message: "model server recovered"
  });

  assert.equal(row.details, null);
});

test("the HUD payload declares pixel space and carries the frame dimensions", () => {
  const payload = buildHudPayload({
    decision: passDecision(),
    frameContext: FRAME
  });

  assert.equal(payload.type, "detections");
  assert.equal(payload.coordinateSpace, "pixel");
  assert.equal(payload.frame.width, 1000);
  assert.equal(payload.frame.height, 1000);
  assert.equal(payload.frame.sessionId, "session-a");
  assert.equal(payload.frame.sequence, 7);
  assert.equal(payload.timestamp, "2026-08-23T12:00:00.000Z");
});

test("the HUD payload never reuses a reserved message type", () => {
  const reserved = new Set(["heartbeat", "ping", "connected"]);
  const payload = buildHudPayload({ decision: passDecision(), frameContext: FRAME });
  assert.equal(reserved.has(payload.type), false);
});

test("the HUD payload carries no confidence field", () => {
  const payload = buildHudPayload({
    decision: passDecision({ boxCount: 1, detections: [{ label: "mold", box: [0, 0, 100, 100] }] }),
    frameContext: FRAME
  });

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("confidence"), false);
});

test("the HUD payload marks detections with the verdict", () => {
  const pass = buildHudPayload({
    decision: passDecision({ boxCount: 1, detections: [{ label: "mold", box: [0, 0, 100, 100] }] }),
    frameContext: FRAME
  });
  assert.equal(pass.detections[0].status, VERDICT.PASS);

  const reject = buildHudPayload({
    decision: passDecision({ verdict: VERDICT.REJECT, boxCount: 1, detections: [{ label: "mold", box: [0, 0, 100, 100] }] }),
    frameContext: FRAME
  });
  assert.equal(reject.detections[0].status, VERDICT.REJECT);
});

test("the HUD payload includes a snapshot URL when one is available", () => {
  const withSnapshot = buildHudPayload({
    decision: passDecision(),
    frameContext: FRAME,
    snapshotUrl: "https://storage.example/frame.jpg"
  });
  assert.equal(withSnapshot.snapshotUrl, "https://storage.example/frame.jpg");

  const withoutSnapshot = buildHudPayload({ decision: passDecision(), frameContext: FRAME });
  assert.equal(withoutSnapshot.snapshotUrl, null);
});

test("the HUD payload explains a failed inspection with an empty box list", () => {
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

  assert.deepEqual(payload.detections, []);
  assert.equal(payload.status, VERDICT.REJECT);
  assert.equal(payload.reason, "model_timeout");
});

test("every row builder tolerates absent optional input", () => {
  assert.doesNotThrow(() =>
    buildInspectionRow(passDecision(), {
      frameContext: FRAME,
      inspectionTarget: TARGET,
      modelInstruction: "instruction",
      inspectedAt: INSPECTED_AT
    })
  );
  assert.doesNotThrow(() =>
    buildControlActionRow({ inspectionId: "abc", action: VERDICT.PASS, requestedAt: INSPECTED_AT })
  );
  assert.doesNotThrow(() =>
    buildPromptHistoryRow({ changedAt: INSPECTED_AT, inspectionTarget: TARGET, modelInstruction: "i" })
  );
  assert.doesNotThrow(() => buildSystemLogRow({ loggedAt: INSPECTED_AT, message: "m" }));
});
