import test from "node:test";
import assert from "node:assert/strict";
import { buildInspectionDecision, buildInspectionResponse, classifyModelOutcome } from "../lib/inspection-logic.mjs";
import { buildAllWorkflows, WORKFLOW_FILES } from "../lib/workflow-definitions.mjs";

const frame = { sessionId: "session", sequence: 7, width: 100, height: 100 };
const instruction = "Locate all the instances that matches the following description: scratch.";

function decide(response, overrides = {}) {
  return buildInspectionDecision({ outcome: classifyModelOutcome(response), frameContext: frame, instruction, ...overrides });
}

test("compact responses report pass/reject by coverage and keep small boxes", () => {
  for (const [box, expected] of [[null, "pass"], [[0, 0, 1, 1], "pass"], [[0, 0, 5, 10], "reject"], [[0, 0, 10, 10], "reject"]]) {
    const detections = box ? [{ label: "scratch", box, confidence: 0 }] : [];
    const decision = decide({ status: "success", prompt_used: instruction, detections });
    assert.deepEqual(buildInspectionResponse(decision), { status: "success", result: expected });
    assert.equal(decision.detections.length, detections.length);
  }
});

test("evaluation failures display error even though the actuator must reject", () => {
  const valid = { status: "success", prompt_used: instruction, detections: [] };
  for (const decision of [
    decide({ error: "Request timed out" }),
    decide({ status: "error", reason: "inference_failed" }),
    decide({ ...valid, detections: [{ box: [5, 5, 1, 1] }] }),
    decide(valid, { threshold: null }),
    decide(valid, { frameCaptureFailed: true }),
    decide(valid, { budget: { fits: false } })
  ]) {
    assert.equal(decision.verdict, "reject");
    assert.deepEqual(buildInspectionResponse(decision), { status: "error", result: "error", reason: decision.reason });
  }
});

test("the shipped model request matches the local HTTP adapter", () => {
  const workflows = buildAllWorkflows();
  const inspection = workflows[WORKFLOW_FILES.inspectionLoop];
  const request = inspection.nodes.find(node => node.name === "detect-defects").parameters;
  assert.match(request.url, /^=http:\/\//);
  assert.equal(request.bodyParameters.parameters.find(field => field.parameterType === "formBinaryData").name, "file");
});

test("real webhook body prompts are accepted and prompt failures cannot respond updated", () => {
  const workflow = buildAllWorkflows()[WORKFLOW_FILES.promptCapture];
  const build = workflow.nodes.find(node => node.name === "build-instruction");
  const input = { first: () => ({ json: { body: { prompt: "scratch" } } }) };
  const output = new Function("$input", build.parameters.jsCode)(input);
  assert.equal(output[0].json.modelInstruction, instruction);
  assert.equal(workflow.nodes.find(node => node.name === "trigger-detection-prompt").parameters.responseMode, "responseNode");
  assert.ok(workflow.nodes.some(node => node.name === "prompt-was-applied"));
});
