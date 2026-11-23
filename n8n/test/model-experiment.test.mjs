import test from "node:test";
import assert from "node:assert/strict";
import { tuneThreshold, selectCandidate, qualifyCondition, boxParity } from "../lib/model-experiment.mjs";

test("threshold tuning separates a small defect only when normal coverage allows it", () => {
  const fit = tuneThreshold([{ expected: "pass", coverage: 0 }, { expected: "reject", coverage: 0.00413 }]);
  assert.equal(fit.missedDefects, 0); assert.equal(fit.falseRejects, 0);
  assert.ok(fit.threshold > 0 && fit.threshold <= 0.00413);
  const impossible = tuneThreshold([{ expected: "pass", coverage: 0.15 }, { expected: "reject", coverage: 0.00413 }]);
  assert.ok(impossible.missedDefects + impossible.falseRejects > 0);
});

test("selection rejects held-out rows and minimizes misses before false rejects", () => {
  const samples = [
    { split: "development", variant: "a", expected: "pass", coverage: 0.1 },
    { split: "development", variant: "a", expected: "reject", coverage: 0.05 },
    { split: "development", variant: "b", expected: "pass", coverage: 0 },
    { split: "development", variant: "b", expected: "reject", coverage: 0.004 }
  ];
  assert.equal(selectCandidate(samples).variant, "b");
  assert.throws(() => selectCandidate([...samples, { ...samples[0], split: "heldout" }]), /development/);
});

test("repeats, missing classes, errors or missing production evidence cannot qualify a condition", () => {
  const samples = ["g1", "g2", "d1", "d2"].flatMap(id => [1, 2, 3].map(repetition => ({ caseId: id, originalSha256: id,
    expected: id[0] === "g" ? "pass" : "reject", actual: id[0] === "g" ? "pass" : "reject", repetition, elapsedMs: 800 })));
  const context = { expectedCaseIds: ["g1", "g2", "d1", "d2"], repetitions: 3, parityPassed: true, integrityPassed: true };
  assert.equal(qualifyCondition(samples, context).automaticApproval, false);
  assert.equal(qualifyCondition(samples, { ...context, productionPassed: true }).automaticApproval, true);
  assert.equal(qualifyCondition(samples.filter(s => s.caseId !== "d2"), { ...context, productionPassed: true }).automaticApproval, false);
  assert.equal(qualifyCondition([...samples, { ...samples[0], actual: "error" }], { ...context, productionPassed: true }).automaticApproval, false);
});

test("parity checks label, count and coordinates instead of treating empty or shifted boxes as matching", () => {
  const boxes = [{ label: "hole", box: [10, 20, 30, 40] }];
  assert.equal(boxParity(boxes, boxes).passed, true);
  assert.equal(boxParity(boxes, []).passed, false);
  assert.equal(boxParity(boxes, [{ label: "hole", box: [10, 20, 31, 40] }]).passed, false);
});
