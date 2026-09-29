import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COVERAGE_THRESHOLD,
  FailureReason,
  MODEL_TIMEOUT_MS,
  MODEL_SUCCESS_STATUS,
  VERDICT,
  VERDICT_WINDOW_MS,
  boxArea,
  buildHealthProbe,
  buildInspectionDecision,
  decideVerdict,
  defectCoverage,
  hasUsableFrameGeometry,
  parseFrameContext
} from "../lib/inspection-logic.mjs";

const FRAME = {
  sessionId: "session-a",
  sequence: 7,
  capturedAt: "2026-08-23T12:00:00.000Z",
  width: 1000,
  height: 1000
};

const INSTRUCTION = "Locate all the instances that matches the following description: mold.";

function okResponse(detections, promptUsed = INSTRUCTION) {
  return {
    kind: "ok",
    response: { status: MODEL_SUCCESS_STATUS, prompt_used: promptUsed, detections }
  };
}

function detection(box, label = "mold") {
  return { label, box, confidence: 0.0 };
}

// A 100x100 box on a 1000x1000 frame is exactly 1% coverage.
const ONE_PERCENT_BOX = [0, 0, 100, 100];

test("boxArea measures pixel extent", () => {
  assert.equal(boxArea([0, 0, 10, 20]), 200);
  assert.equal(boxArea([5, 5, 15, 15]), 100);
});

test("boxArea treats degenerate and inverted boxes as zero area", () => {
  assert.equal(boxArea([10, 10, 10, 20]), 0, "zero width");
  assert.equal(boxArea([10, 10, 20, 10]), 0, "zero height");
  assert.equal(boxArea([20, 20, 10, 10]), 0, "inverted corners");
});

test("boxArea rejects non-array and non-finite input", () => {
  assert.equal(boxArea(null), 0);
  assert.equal(boxArea(undefined), 0);
  assert.equal(boxArea([1, 2, 3]), 0, "too few coordinates");
  assert.equal(boxArea([1, 2, 3, Number.NaN]), 0);
  assert.equal(boxArea([1, 2, 3, Number.POSITIVE_INFINITY]), 0);
  assert.equal(boxArea({ x1: 1, y1: 2, x2: 3, y2: 4 }), 0);
});

test("defectCoverage is the summed box area over the frame area", () => {
  const coverage = defectCoverage([detection([0, 0, 500, 500])], 1000, 1000);
  assert.equal(coverage, 0.25);
});

test("defectCoverage is zero for an empty detection list", () => {
  assert.equal(defectCoverage([], 1000, 1000), 0);
});

test("defectCoverage clamps a full-frame box to exactly 1", () => {
  assert.equal(defectCoverage([detection([0, 0, 1000, 1000])], 1000, 1000), 1);
});

test("defectCoverage clamps overlapping boxes that sum past the frame", () => {
  // Two boxes each covering 60% of the frame sum to 120% before clamping.
  const coverage = defectCoverage(
    [detection([0, 0, 600, 1000]), detection([400, 0, 1000, 1000])],
    1000,
    1000
  );
  assert.equal(coverage, 1, "must never exceed the frame area");
});

test("defectCoverage ignores degenerate boxes rather than inflating coverage", () => {
  const coverage = defectCoverage(
    [detection([10, 10, 10, 10]), detection([20, 20, 5, 40])],
    1000,
    1000
  );
  assert.equal(coverage, 0);
});

test("defectCoverage returns null when frame geometry is unusable", () => {
  assert.equal(defectCoverage([detection(ONE_PERCENT_BOX)], 0, 1000), null);
  assert.equal(defectCoverage([detection(ONE_PERCENT_BOX)], 1000, 0), null);
  assert.equal(defectCoverage([detection(ONE_PERCENT_BOX)], -100, 1000), null);
  assert.equal(defectCoverage([detection(ONE_PERCENT_BOX)], Number.NaN, 1000), null);
  assert.equal(defectCoverage([detection(ONE_PERCENT_BOX)], undefined, 1000), null);
});

test("defectCoverage never divides by zero into NaN or Infinity", () => {
  const values = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, "1000"];
  for (const width of values) {
    const coverage = defectCoverage([detection(ONE_PERCENT_BOX)], width, 1000);
    if (coverage !== null) {
      assert.ok(Number.isFinite(coverage), `expected finite or null, got ${coverage}`);
    }
  }
});

test("defectCoverage tolerates a non-array detection list", () => {
  assert.equal(defectCoverage(null, 1000, 1000), 0);
  assert.equal(defectCoverage(undefined, 1000, 1000), 0);
  assert.equal(defectCoverage("nope", 1000, 1000), 0);
});

test("decideVerdict rejects at exactly the coverage threshold", () => {
  assert.equal(decideVerdict(0.005, 0.005), VERDICT.REJECT);
});

test("decideVerdict passes just below the coverage threshold", () => {
  assert.equal(decideVerdict(0.004999, 0.005), VERDICT.PASS);
});

test("decideVerdict passes an item with no detections", () => {
  assert.equal(decideVerdict(0, DEFAULT_COVERAGE_THRESHOLD), VERDICT.PASS);
});

test("decideVerdict rejects an unusable threshold rather than failing open", () => {
  for (const threshold of [Number.NaN, undefined, null, -1, "high", {}]) {
    assert.equal(
      decideVerdict(0, threshold),
      VERDICT.REJECT,
      `threshold ${String(threshold)} must not silently pass`
    );
  }
});

test("decideVerdict rejects when coverage could not be computed", () => {
  assert.equal(decideVerdict(null, DEFAULT_COVERAGE_THRESHOLD), VERDICT.REJECT);
  assert.equal(decideVerdict(Number.NaN, DEFAULT_COVERAGE_THRESHOLD), VERDICT.REJECT);
});

const WIDE_FRAME = {
  sessionId: "session-a",
  sequence: 7,
  capturedAt: "2026-08-23T12:00:00.000Z",
  width: 1920,
  height: 1080
};

test("parseFrameContext reads the Pi capture headers case-insensitively", () => {
  const frame = parseFrameContext({
    "x-camera-session": "session-a",
    "x-frame-sequence": "7",
    "x-captured-at": "2026-08-23T12:00:00.000Z",
    "x-frame-width": "1920",
    "x-frame-height": "1080"
  });

  assert.deepEqual(frame, WIDE_FRAME);
});

test("parseFrameContext preserves the original header casing", () => {
  const frame = parseFrameContext({
    "X-Camera-Session": "session-a",
    "X-Frame-Sequence": "7",
    "X-Captured-At": "2026-08-23T12:00:00.000Z",
    "X-Frame-Width": "1920",
    "X-Frame-Height": "1080"
  });

  assert.deepEqual(frame, WIDE_FRAME);
});

test("parseFrameContext nulls out values it cannot read", () => {
  const frame = parseFrameContext({ "x-frame-width": "not-a-number" });

  assert.equal(frame.width, null);
  assert.equal(frame.sessionId, null);
  assert.equal(frame.sequence, null);
  assert.equal(frame.capturedAt, null);
});

test("parseFrameContext tolerates missing headers entirely", () => {
  assert.deepEqual(parseFrameContext(undefined), {
    sessionId: null,
    sequence: null,
    capturedAt: null,
    width: null,
    height: null
  });
});

test("hasUsableFrameGeometry only requires positive frame dimensions", () => {
  assert.equal(hasUsableFrameGeometry(FRAME), true);
  assert.equal(hasUsableFrameGeometry({ ...FRAME, width: 0 }), false);
  assert.equal(hasUsableFrameGeometry({ ...FRAME, height: 0 }), false);
  assert.equal(hasUsableFrameGeometry({ ...FRAME, width: null }), false);
  // Session and sequence are optional; the HUD degrades gracefully without them.
  assert.equal(hasUsableFrameGeometry({ ...FRAME, sessionId: null, sequence: null }), true);
});

test("a clean inspection with no detections passes", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([]),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.PASS);
  assert.equal(decision.coverage, 0);
  assert.equal(decision.boxCount, 0);
  assert.deepEqual(decision.detections, []);
  assert.equal(decision.reason, "no_defect_detected");
  assert.equal(decision.promptVerified, true);
});

test("a detection above the coverage threshold rejects the item", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([detection([0, 0, 300, 300])]),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.coverage, 0.09);
  assert.equal(decision.boxCount, 1);
  assert.equal(decision.reason, "defect_detected");
});

test("every returned box is kept for display regardless of the verdict", () => {
  const detections = [detection([0, 0, 10, 10]), detection([20, 20, 30, 30])];
  const decision = buildInspectionDecision({
    outcome: okResponse(detections),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  // 2 boxes x 100px each on a 1000x1000 frame = 0.2% coverage, under the
  // 0.5% default, so the item passes - but both boxes must still reach the HUD.
  assert.equal(decision.verdict, VERDICT.PASS);
  assert.equal(decision.detections.length, 2);
});

test("the coverage threshold is recorded on the decision", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([]),
    frameContext: FRAME,
    instruction: INSTRUCTION,
    threshold: 0.02
  });

  assert.equal(decision.coverageThreshold, 0.02);
});

test("the decision defaults to the documented coverage threshold", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([]),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.coverageThreshold, DEFAULT_COVERAGE_THRESHOLD);
});

test("a mismatched model prompt is recorded rather than trusted", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([], "Locate all the instances that matches the following description: scratch."),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.promptVerified, false);
  assert.equal(decision.promptUsed, "Locate all the instances that matches the following description: scratch.");
  assert.equal(decision.promptMismatch, true);
});

test("every transport and content failure rejects the item", () => {
  const failures = [
    { kind: "failure", reason: FailureReason.MODEL_TIMEOUT },
    { kind: "failure", reason: FailureReason.MODEL_UNREACHABLE },
    { kind: "failure", reason: FailureReason.MODEL_HTTP_ERROR },
    { kind: "failure", reason: FailureReason.MODEL_INVALID_RESPONSE },
    { kind: "failure", reason: FailureReason.FRAME_CAPTURE_FAILED }
  ];

  for (const outcome of failures) {
    const decision = buildInspectionDecision({ outcome, frameContext: FRAME, instruction: INSTRUCTION });
    assert.equal(decision.verdict, VERDICT.REJECT, `${outcome.reason} must reject`);
    assert.equal(decision.reason, outcome.reason);
    assert.deepEqual(decision.detections, [], `${outcome.reason} must not forward boxes`);
  }
});

test("an unknown failure reason still rejects", () => {
  const decision = buildInspectionDecision({
    outcome: { kind: "failure", reason: "something_new" },
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
});

test("a missing outcome rejects rather than passing", () => {
  for (const outcome of [undefined, null, {}, { kind: "unknown" }]) {
    const decision = buildInspectionDecision({ outcome, frameContext: FRAME, instruction: INSTRUCTION });
    assert.equal(decision.verdict, VERDICT.REJECT, `outcome ${JSON.stringify(outcome)} must reject`);
  }
});

test("a model error status rejects", () => {
  const decision = buildInspectionDecision({
    outcome: { kind: "ok", response: { status: "error", detail: "model exploded" } },
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.reason, FailureReason.MODEL_ERROR_STATUS);
});

test("a non-object model response rejects", () => {
  for (const response of [null, undefined, "ok", 42, []]) {
    const decision = buildInspectionDecision({
      outcome: { kind: "ok", response },
      frameContext: FRAME,
      instruction: INSTRUCTION
    });

    assert.equal(decision.verdict, VERDICT.REJECT, `response ${JSON.stringify(response)} must reject`);
    assert.equal(decision.reason, FailureReason.MODEL_INVALID_RESPONSE);
  }
});

test("a non-array detections field rejects", () => {
  const decision = buildInspectionDecision({
    outcome: { kind: "ok", response: { status: MODEL_SUCCESS_STATUS, detections: "none" } },
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.reason, FailureReason.MODEL_INVALID_RESPONSE);
});

test("invalid box geometry rejects and forwards no boxes", () => {
  const bad = [
    detection([10, 10, 10, 20]),
    detection([20, 20, 10, 10]),
    detection([1, 2, 3]),
    detection([1, 2, 3, Number.NaN]),
    detection({ x1: 1, y1: 2, x2: 3, y2: 4 }),
    { label: "mold" }
  ];

  for (const box of bad) {
    const decision = buildInspectionDecision({
      outcome: okResponse([box]),
      frameContext: FRAME,
      instruction: INSTRUCTION
    });

    assert.equal(decision.verdict, VERDICT.REJECT, `box ${JSON.stringify(box)} must reject`);
    assert.equal(decision.reason, FailureReason.MODEL_INVALID_BOX);
    assert.deepEqual(decision.detections, [], "an unrenderable box must not reach the HUD");
  }
});

test("a bad box anywhere in the list rejects the whole inspection", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([detection([0, 0, 100, 100]), detection([0, 0, 0, 5])]),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.reason, FailureReason.MODEL_INVALID_BOX);
  assert.equal(decision.detections.length, 0);
});

test("a detection with no label still renders", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([{ box: [0, 0, 100, 100] }]),
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.detections[0].label, "defect");
});

test("unusable frame geometry rejects before any coverage math", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([detection(ONE_PERCENT_BOX)]),
    frameContext: { ...FRAME, width: 0 },
    instruction: INSTRUCTION
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.reason, FailureReason.FRAME_CONTEXT_INVALID);
  assert.equal(decision.coverage, null);
});

test("an unusable coverage threshold rejects rather than passing", () => {
  const decision = buildInspectionDecision({
    outcome: okResponse([]),
    frameContext: FRAME,
    instruction: INSTRUCTION,
    threshold: Number.NaN
  });

  assert.equal(decision.verdict, VERDICT.REJECT);
  assert.equal(decision.reason, FailureReason.INVALID_THRESHOLD);
});

test("a failed inspection reports no coverage figure", () => {
  const decision = buildInspectionDecision({
    outcome: { kind: "failure", reason: FailureReason.MODEL_TIMEOUT },
    frameContext: FRAME,
    instruction: INSTRUCTION
  });

  assert.equal(decision.coverage, null);
  assert.equal(decision.boxCount, 0);
  assert.equal(decision.promptVerified, null, "there is no answer to verify against");
});

test("the model timeout sits inside the ESP32 verdict window", () => {
  assert.ok(MODEL_TIMEOUT_MS < VERDICT_WINDOW_MS, "the verdict POST needs headroom");
  assert.equal(VERDICT_WINDOW_MS, 3000);
});

// Both watchdog probes read a different response shape but share one rule: a
// throw is a failure, and only a well-formed answer can be healthy.
test("a probe reports healthy when its reader and predicate agree", () => {
  const probe = buildHealthProbe("model-server", () => ({ status: "ok" }), (body) => body.status === "ok");

  assert.deepEqual(probe, {
    component: "model-server",
    healthy: true,
    detail: { status: "ok" },
    error: null
  });
});

test("a probe reports unhealthy without throwing", () => {
  const probe = buildHealthProbe("model-server", () => ({ status: "loading" }), (body) => body.status === "ok");

  assert.equal(probe.healthy, false);
  assert.deepEqual(probe.detail, { status: "loading" });
});

test("a probe whose reader throws is unhealthy and keeps the message", () => {
  const probe = buildHealthProbe(
    "capture-service",
    () => {
      throw new Error("no headers");
    },
    () => true
  );

  assert.equal(probe.healthy, false);
  assert.equal(probe.detail, null);
  assert.equal(probe.error, "no headers");
});

test("a non-boolean verdict from the predicate is never treated as healthy", () => {
  for (const verdict of ["yes", 1, {}, null, undefined]) {
    const probe = buildHealthProbe("model-server", () => ({}), () => verdict);

    assert.equal(probe.healthy, false, String(verdict));
  }
});