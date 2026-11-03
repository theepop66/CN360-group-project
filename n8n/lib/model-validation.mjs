import { buildInspectionDecision, buildInspectionResponse, classifyModelOutcome } from "./inspection-logic.mjs";
import { buildModelInstruction } from "./inspection-records.mjs";

export function scorePrediction(image, response, threshold = 0.005) {
  const outcome = response.httpStatus >= 200 && response.httpStatus < 300
    ? classifyModelOutcome(response.body) : { kind: "failure", reason: response.body?.reason ?? "model_http_error" };
  const decision = buildInspectionDecision({ outcome, frameContext: { width: image.width, height: image.height },
    instruction: buildModelInstruction(image.target), threshold });
  const result = buildInspectionResponse(decision);
  return { caseId: image.id, expected: image.hasDefect ? "reject" : "pass", actual: result.result,
    operationalVerdict: decision.verdict, coverage: decision.coverage, reason: decision.reason, boxCount: decision.boxCount,
    promptMismatch: decision.promptMismatch, detections: decision.detections };
}

export function summarizeQuality(samples) {
  const count = predicate => samples.filter(predicate).length;
  const errors = count(row => !["pass", "reject"].includes(row.actual));
  const missedDefects = count(row => row.expected === "reject" && row.actual === "pass");
  const falseRejects = count(row => row.expected === "pass" && row.actual === "reject");
  const good = count(row => row.expected === "pass");
  const defective = count(row => row.expected === "reject");
  const evaluated = samples.length - errors;
  return { attempts: samples.length, evaluated, errors, good, defective, missedDefects, falseRejects,
    caseAttempts: Object.fromEntries([...Map.groupBy(samples, row => row.caseId)].map(([id, rows]) => [id, rows.length])),
    correctPasses: count(row => row.expected === "pass" && row.actual === "pass"),
    correctRejects: count(row => row.expected === "reject" && row.actual === "reject"),
    forcedRejects: count(row => row.actual === "error"),
    evaluationCoverage: samples.length ? evaluated / samples.length : null,
    missedDefectRate: defective ? missedDefects / defective : null, falseRejectRate: good ? falseRejects / good : null,
    successfulEvaluationAccuracy: evaluated ? (evaluated - missedDefects - falseRejects) / evaluated : null };
}

export function timingSummary(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const percentile = fraction => sorted.length ? sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] : null;
  return { count: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null };
}

export function assessReadiness({ quality, production, consistencyPassed }, criteria) {
  const qualityFailed = quality.missedDefects > criteria.maxMissedDefects || quality.falseRejects > criteria.maxFalseRejects || quality.errors > criteria.maxErrors;
  const timingFailed = production.some(row => row.result === "error" || !Number.isFinite(row.modelMs) || row.modelMs > criteria.modelBudgetMs ||
    !Number.isFinite(row.receiptMs) || row.receiptMs >= criteria.verdictWindowMs || row.controlOutcome !== "accepted");
  const missingQualityCases = (criteria.diagnosticCaseIds ?? []).some(id => (quality.caseAttempts?.[id] ?? 0) < criteria.diagnosticRepetitions);
  const missingProductionCases = (criteria.productionCaseIds ?? []).some(id => !production.some(row => row.caseId === id));
  const gates = {
    quality: qualityFailed ? "failed" : quality.attempts < criteria.minimumDiagnosticAttempts || missingQualityCases ? "unverified" : "passed",
    productionTiming: timingFailed ? "failed" : production.length < criteria.minimumProductionAttempts || missingProductionCases ? "unverified" : "passed",
    consistency: consistencyPassed === true ? "passed" : consistencyPassed === false ? "failed" : "unverified"
  };
  return { gates, readyForPhysicalIntegration: Object.values(gates).every(status => status === "passed"),
    physicalSortingAccepted: false, note: "Frozen sample-set assessment only; diagnostic predictions cannot approve production deadlines or physical sorting." };
}

// Compare only contracts each consumer actually exposes. Error fallback stays a
// reject Verdict; it must never be counted as a successful model evaluation.
export function compareInspectionEvidence(expected, evidence) {
  const failures = [];
  const equal = (label, actual, wanted) => { if (String(actual) !== String(wanted)) failures.push(`${label}: expected ${wanted}, received ${actual}`); };
  const { frame, item, decision, control } = expected;
  const { telemetry, inspection, action, hud } = evidence;
  for (const [name, actual] of [["ThingsBoard", telemetry], ["Inspection Result", inspection]]) {
    if (!actual) { failures.push(name + " missing"); continue; }
    equal(name + " Verdict", actual.verdict, decision.verdict);
    equal(name + " camera session", actual.camera_session, frame.sessionId ?? (name === "ThingsBoard" ? "" : null));
    equal(name + " frame sequence", actual.frame_sequence, frame.sequence ?? (name === "ThingsBoard" ? -1 : null));
    equal(name + " controller session", actual.controller_session ?? "", item?.controller_session ?? "");
    equal(name + " item", actual.item_id ?? "", item?.item_id ?? "");
  }
  if (telemetry) {
    equal("ThingsBoard reason", telemetry.verdict_reason, decision.reason);
    equal("ThingsBoard control", telemetry.control_outcome, control.controlOutcome);
    if (decision.coverage === null) {
      equal("ThingsBoard unavailable coverage", telemetry.coverage_available, false);
      equal("ThingsBoard coverage display", telemetry.defect_coverage_display, "Unavailable");
    } else equal("ThingsBoard coverage", Number(telemetry.defect_coverage), decision.coverage);
  }
  if (inspection) {
    equal("Recorded coverage", inspection.defect_coverage, decision.coverage);
    equal("Recorded width", inspection.frame_width, frame.width);
    equal("Recorded height", inspection.frame_height, frame.height);
    if (decision.promptVerified !== undefined) equal("Recorded prompt verification", inspection.prompt_verified, decision.promptVerified);
  }
  if (!action) failures.push("Control Action missing");
  else {
    equal("Control Action outcome", action.control_outcome, control.controlOutcome);
    equal("Control Action session", action.controller_session ?? "", item?.controller_session ?? "");
    equal("Control Action item", action.item_id ?? "", item?.item_id ?? "");
    if (control.controlOutcome === "accepted") {
      equal("Acknowledged session", action.ack_controller_session, item?.controller_session);
      equal("Acknowledged item", action.ack_item_id, item?.item_id);
    }
  }
  if (!hud) failures.push("HUD delivery missing");
  else {
    equal("HUD Verdict", hud.status, decision.verdict);
    equal("HUD reason", hud.reason, decision.reason);
    equal("HUD session", hud.frame?.sessionId, frame.sessionId);
    equal("HUD sequence", hud.frame?.sequence, frame.sequence);
    equal("HUD width", hud.frame?.width, frame.width);
    equal("HUD height", hud.frame?.height, frame.height);
    equal("HUD boxes", JSON.stringify((hud.detections ?? []).map(d => d.box)), JSON.stringify((decision.detections ?? []).map(d => d.box)));
  }
  return failures;
}
