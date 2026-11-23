import test from "node:test";
import assert from "node:assert/strict";
import { applyInspectionPolicy, policyRule } from "../lib/inspection-policy.mjs";
import { buildInspectionResponse } from "../lib/inspection-logic.mjs";

const instruction = "Locate all the instances that matches the following description: hole.";
const frame = { width: 448, height: 448, inspectionProfile: "hazelnut-hole/full" };
const decision = { verdict: "pass", reason: "no_defect_detected", coverage: 0, coverageThreshold: 0.005,
  promptVerified: true, promptMismatch: false, detections: [], boxCount: 0 };
const rule = { id: "hazelnut-hole", instruction, preparationProfile: frame.inspectionProfile, threshold: 0.003,
  width: 448, height: 448, automaticApproval: false };
const policy = { version: 1, enabled: true, rules: [rule] };

test("unqualified empty detections require review and a controller reject", () => {
  const guarded = applyInspectionPolicy(decision, { policy, frameContext: frame, instruction });
  assert.equal(guarded.verdict, "reject");
  assert.equal(guarded.modelVerdict, "pass");
  assert.equal(guarded.reviewRequired, true);
  assert.equal(buildInspectionResponse(guarded).result, "review");
});

test("unknown prompt or preparation never inherits a qualified rule", () => {
  const qualified = { ...policy, rules: [{ ...rule, automaticApproval: true, qualification: { quality: true, production: true, integrity: true, parity: true } }] };
  for (const overrides of [{ instruction: instruction + "changed" }, { frameContext: { ...frame, inspectionProfile: "other" } },
    { frameContext: { ...frame, width: 224 } }]) {
    assert.equal(applyInspectionPolicy(decision, { policy: qualified, frameContext: frame, instruction, ...overrides }).reviewRequired, true);
  }
});

test("a rule applies its product threshold and requires complete qualification", () => {
  assert.equal(policyRule(policy, instruction, frame).threshold, 0.003);
  const qualified = { ...policy, rules: [{ ...rule, automaticApproval: true, qualification: { quality: true, production: true, integrity: true, parity: true } }] };
  assert.equal(applyInspectionPolicy(decision, { policy: qualified, frameContext: frame, instruction }).verdict, "pass");
  assert.equal(applyInspectionPolicy(decision, { policy: qualified, frameContext: frame, instruction, modelPromptMissing: true }).reviewRequired, true);
  assert.equal(applyInspectionPolicy({ ...decision, promptVerified: false, promptMismatch: true }, { policy: qualified, frameContext: frame, instruction }).reviewRequired, true);
});

test("errors stay errors with review required; policy cannot turn them into a model rejection", () => {
  const guarded = applyInspectionPolicy({ ...decision, verdict: "reject", reason: "model_timeout", coverage: null }, { policy, frameContext: frame, instruction });
  assert.equal(buildInspectionResponse(guarded).result, "error");
  assert.equal(guarded.reviewRequired, true);
});

test("a disabled legacy policy preserves the existing decision contract", () => {
  assert.deepEqual(applyInspectionPolicy(decision, {}), decision);
});
