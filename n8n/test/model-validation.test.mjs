import test from "node:test";
import assert from "node:assert/strict";
import { scorePrediction, summarizeQuality, assessReadiness, compareInspectionEvidence } from "../lib/model-validation.mjs";
import { buildHudPayload } from "../lib/inspection-records.mjs";

const image = { id: "good", width: 100, height: 100, hasDefect: false, target: "scratch" };
const result = detections => ({ status: "success", prompt_used: "Locate all the instances that matches the following description: scratch.", detections });
test("quality uses coverage, preserves small detections and keeps failed evaluations separate", () => {
  const small = scorePrediction(image, { httpStatus: 200, body: result([{ box: [0, 0, 1, 1] }]) });
  assert.equal(small.actual, "pass"); assert.equal(small.coverage, 0.0001);
  const bad = scorePrediction(image, { httpStatus: 504, body: { status: "error", reason: "model_timeout" } });
  assert.equal(bad.actual, "error"); assert.equal(bad.operationalVerdict, "reject");
  const missed = scorePrediction({ ...image, hasDefect: true }, { httpStatus: 200, body: result([]) });
  const falseReject = scorePrediction(image, { httpStatus: 200, body: result([{ box: [0, 0, 50, 50] }]) });
  const summary = summarizeQuality([small, bad, missed, falseReject]);
  assert.equal(summary.attempts, 4); assert.equal(summary.evaluated, 3); assert.equal(summary.errors, 1);
  assert.equal(summary.missedDefects, 1); assert.equal(summary.falseRejects, 1);
  assert.equal(summary.evaluationCoverage, 0.75);
});
test("a perfect diagnostic run cannot approve failed production deadlines or incomplete sample counts", () => {
  const criteria = { maxMissedDefects: 0, maxFalseRejects: 0, maxErrors: 0, modelBudgetMs: 1200, verdictWindowMs: 3000, minimumDiagnosticAttempts: 2, minimumProductionAttempts: 2 };
  const quality = summarizeQuality([scorePrediction(image, { httpStatus: 200, body: result([]) })]);
  const report = assessReadiness({ quality, production: [{ result: "error", modelMs: 1300, receiptMs: 1500, controlOutcome: "accepted" }], consistencyPassed: true }, criteria);
  assert.equal(report.readyForPhysicalIntegration, false);
  assert.equal(report.gates.quality, "unverified");
  assert.equal(report.gates.productionTiming, "failed");
});

test("repeating one easy case cannot satisfy a frozen multi-case acceptance set", () => {
  const quality = summarizeQuality([scorePrediction(image, { httpStatus: 200, body: result([]) }), scorePrediction(image, { httpStatus: 200, body: result([]) })]);
  const report = assessReadiness({ quality, production: [{ caseId: "good", result: "pass", modelMs: 500, receiptMs: 700, controlOutcome: "accepted" }], consistencyPassed: true },
    { maxMissedDefects: 0, maxFalseRejects: 0, maxErrors: 0, modelBudgetMs: 1200, verdictWindowMs: 3000,
      minimumDiagnosticAttempts: 2, minimumProductionAttempts: 1, diagnosticCaseIds: ["good", "defect"], diagnosticRepetitions: 1, productionCaseIds: ["good"] });
  assert.equal(report.gates.quality, "unverified");
  assert.equal(report.readyForPhysicalIntegration, false);
});
test("cross-service evidence distinguishes an error fallback and refuses mismatched identity or geometry", () => {
  const expected = { frame: { sessionId: "camera", sequence: 2, width: 100, height: 100 }, item: { controller_session: "boot", item_id: "7" },
    decision: { verdict: "reject", reason: "model_timeout", coverage: null, boxCount: 0 }, response: { status: "error", result: "error" }, control: { controlOutcome: "accepted" } };
  const evidence = { telemetry: { verdict: "reject", verdict_reason: "model_timeout", coverage_available: false, defect_coverage_display: "Unavailable", camera_session: "camera", frame_sequence: 2, controller_session: "boot", item_id: "7", control_outcome: "accepted" },
    inspection: { verdict: "reject", defect_coverage: null, camera_session: "camera", frame_sequence: 2, frame_width: 100, frame_height: 100, controller_session: "boot", item_id: "7" },
    action: { control_outcome: "accepted", controller_session: "boot", item_id: "7", ack_controller_session: "boot", ack_item_id: "7" },
    hud: buildHudPayload({ decision: expected.decision, frameContext: expected.frame }) };
  assert.deepEqual(compareInspectionEvidence(expected, evidence), []);
  const wrong = structuredClone(evidence); wrong.telemetry.item_id = "8"; wrong.hud.frame.width = 50;
  assert.ok(compareInspectionEvidence(expected, wrong).length >= 2);
});
