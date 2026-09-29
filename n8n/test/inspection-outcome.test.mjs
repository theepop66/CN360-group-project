const CTX_A7 = { sessionId: "session-a", sequence: 7, width: 1000, height: 1000 };
const CTX_A8 = { sessionId: "session-a", sequence: 8, width: 1000, height: 1000 };
const CTX_B7 = { sessionId: "session-b", sequence: 7, width: 1000, height: 1000 };
const CTX_ANON = { sessionId: null, sequence: null, width: 1000, height: 1000 };

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPTURE_TIMEOUT_MS,
  FailureReason,
  MODEL_PROMPT_TIMEOUT_MS,
  MODEL_TIMEOUT_MS,
  PRE_VERDICT_BUDGET_MS,
  SNAPSHOT_UPLOAD_TIMEOUT_MS,
  VERDICT_POST_TIMEOUT_MS,
  VERDICT_WINDOW_MS,
  buildInspectionDecision,
  buildSnapshotObjectName,
  classifyModelOutcome,
  resolveCoverageThreshold,
  resolveVerdictBudget,
  shouldSuppressDuplicate
} from "../lib/inspection-logic.mjs";
import { MODEL_SUCCESS_STATUS } from "../lib/inspection-logic.mjs";

test("the whole pre-verdict budget fits inside the ESP32 verdict window", () => {
  assert.ok(
    PRE_VERDICT_BUDGET_MS + VERDICT_POST_TIMEOUT_MS < VERDICT_WINDOW_MS,
    `budget ${PRE_VERDICT_BUDGET_MS} + verdict ${VERDICT_POST_TIMEOUT_MS} must leave headroom in ${VERDICT_WINDOW_MS}`
  );
});

test("each stage is budgeted individually", () => {
  assert.equal(
    PRE_VERDICT_BUDGET_MS,
    MODEL_PROMPT_TIMEOUT_MS +
      CAPTURE_TIMEOUT_MS +
      SNAPSHOT_UPLOAD_TIMEOUT_MS +
      MODEL_TIMEOUT_MS
  );
  assert.ok(MODEL_PROMPT_TIMEOUT_MS < CAPTURE_TIMEOUT_MS, "reading a prompt is cheaper than a capture");
  assert.ok(MODEL_TIMEOUT_MS < VERDICT_WINDOW_MS);
});

test("a clean model response is classified as an ok outcome", () => {
  const outcome = classifyModelOutcome({
    status: MODEL_SUCCESS_STATUS,
    prompt_used: "instruction",
    detections: []
  });

  assert.equal(outcome.kind, "ok");
  assert.equal(outcome.response.status, MODEL_SUCCESS_STATUS);
});

test("a n8n timeout error is classified as a model timeout", () => {
  const outcome = classifyModelOutcome({ error: { message: "Request timed out after 1500ms" } });

  assert.equal(outcome.kind, "failure");
  assert.equal(outcome.reason, FailureReason.MODEL_TIMEOUT);
});

test("a connection error is classified as an unreachable model", () => {
  for (const message of [
    "connect ECONNREFUSED 127.0.0.1:8000",
    "getaddrinfo ENOTFOUND model-host",
    "connect EHOSTUNREACH 192.168.1.9:8000",
    "fetch failed"
  ]) {
    const outcome = classifyModelOutcome({ error: { message } });
    assert.equal(outcome.kind, "failure", message);
    assert.equal(outcome.reason, FailureReason.MODEL_UNREACHABLE, message);
  }
});

test("any other error is classified as an HTTP error", () => {
  const outcome = classifyModelOutcome({ error: { message: "500 Internal Server Error" } });

  assert.equal(outcome.kind, "failure");
  assert.equal(outcome.reason, FailureReason.MODEL_HTTP_ERROR);
});

test("an error without a message still classifies as a failure", () => {
  for (const error of [{}, { message: "" }, { message: null }]) {
    const outcome = classifyModelOutcome({ error });
    assert.equal(outcome.kind, "failure", JSON.stringify(error));
  }
});

test("a thrown-error string is classified as a failure", () => {
  const outcome = classifyModelOutcome({ error: "socket hang up" });
  assert.equal(outcome.kind, "failure");
});

test("a timeout is not mistaken for a connection failure", () => {
  // A timeout is the expected path today, and must be distinguishable from
  // "the server is not there" in the recorded reason.
  const outcome = classifyModelOutcome({ error: { message: "Timeout of 1500ms exceeded" } });
  assert.equal(outcome.reason, FailureReason.MODEL_TIMEOUT);
});

test("a first verdict for a frame is never suppressed", () => {
  const store = {};
  assert.equal(shouldSuppressDuplicate(store, CTX_A7, 1000), false);
});

test("a second verdict for the same frame inside the window is suppressed", () => {
  const store = {};
  shouldSuppressDuplicate(store, CTX_A7, 1000);

  assert.equal(shouldSuppressDuplicate(store, CTX_A7, 2000), true);
  assert.equal(shouldSuppressDuplicate(store, CTX_A7, 3999), true);
});

test("a later verdict for the same frame outside the window is allowed", () => {
  const store = {};
  shouldSuppressDuplicate(store, CTX_A7, 1000);

  assert.equal(shouldSuppressDuplicate(store, CTX_A7, 1000 + VERDICT_WINDOW_MS), false);
});

test("a different frame is never suppressed", () => {
  const store = {};
  shouldSuppressDuplicate(store, CTX_A7, 1000);

  assert.equal(shouldSuppressDuplicate(store, CTX_A8, 1100), false);
  assert.equal(shouldSuppressDuplicate(store, CTX_B7, 1100), false);
});

test("suppression is recorded in the store it is given", () => {
  const store = {};
  shouldSuppressDuplicate(store, CTX_A7, 5000);

  assert.equal(typeof store.lastVerdictAt["session-a:7"], "number");
});

test("a frame with no identity cannot be deduplicated", () => {
  const store = {};
  assert.equal(shouldSuppressDuplicate(store, CTX_ANON, 1000), false);
  assert.equal(shouldSuppressDuplicate(store, undefined, 1000), false);
});

test("suppression survives a store that was never initialised", () => {
  assert.doesNotThrow(() => shouldSuppressDuplicate({}, CTX_A7, 1));
  assert.doesNotThrow(() => shouldSuppressDuplicate(undefined, CTX_A7, 1));
});

test("a snapshot object name is derived from the frame identity", () => {
  const name = buildSnapshotObjectName({
    sessionId: "session-a",
    sequence: 7,
    width: 1000,
    height: 1000
  });

  assert.equal(name, "session-a-7.jpg");
});

test("a frame with no identity still produces a usable object name", () => {
  const name = buildSnapshotObjectName({ sessionId: null, sequence: null, width: 1000, height: 1000 });

  assert.match(name, /^[A-Za-z0-9._-]+\.jpg$/);
  assert.equal(name.includes("undefined"), false);
  assert.equal(name.includes("/"), false, "an object name must not escape the bucket");
});

test("the shipped budget defaults fit the verdict window", () => {
  const budget = resolveVerdictBudget(undefined);

  assert.equal(budget.modelTimeoutMs, MODEL_TIMEOUT_MS);
  assert.equal(budget.fits, true);
  assert.ok(budget.totalMs < VERDICT_WINDOW_MS);
});

test("the unconfigured placeholder falls back to the shipped default", () => {
  // The workflow ships with REPLACE_MODEL_TIMEOUT_MS in the HTTP node. Until the
  // operator replaces it, the budget guard must reason about the real default.
  const budget = resolveVerdictBudget("REPLACE_MODEL_TIMEOUT_MS");

  assert.equal(budget.modelTimeoutMs, MODEL_TIMEOUT_MS);
  assert.equal(budget.fits, true);
});

test("a configured model timeout is accepted when it still fits", () => {
  const budget = resolveVerdictBudget(MODEL_TIMEOUT_MS - 100);

  assert.equal(budget.modelTimeoutMs, MODEL_TIMEOUT_MS - 100);
  assert.equal(budget.fits, true);
});

test("a model timeout that cannot leave headroom is refused", () => {
  const budget = resolveVerdictBudget(VERDICT_WINDOW_MS);

  assert.equal(budget.fits, false);
});

test("a nonsense configured timeout falls back rather than breaking the guard", () => {
  for (const configured of ["", "  ", null, 0, -1, Number.NaN, "abc"]) {
    const budget = resolveVerdictBudget(configured);

    assert.equal(budget.modelTimeoutMs, MODEL_TIMEOUT_MS, String(configured));
    assert.equal(budget.fits, true, String(configured));
  }
});

test("the budget total is the sum of every stage including the verdict post", () => {
  const budget = resolveVerdictBudget(undefined);

  assert.equal(
    budget.totalMs,
    MODEL_PROMPT_TIMEOUT_MS +
      CAPTURE_TIMEOUT_MS +
      SNAPSHOT_UPLOAD_TIMEOUT_MS +
      MODEL_TIMEOUT_MS +
      VERDICT_POST_TIMEOUT_MS
  );
});

test("the verdict budget is an inspector-visible reason", () => {
  assert.equal(FailureReason.INVALID_VERDICT_BUDGET, "invalid_verdict_budget");
});

// A budget that cannot fit is a setup error, but it must never produce a pass,
// and it must not hide the boxes the model did return.
test("a budget that cannot fit forces a reject", () => {
  const outcome = classifyModelOutcome({
    status: MODEL_SUCCESS_STATUS,
    prompt_used: "instruction",
    detections: [{ label: "defect", box: [0, 0, 10, 10] }]
  });

  const decision = buildInspectionDecision({
    outcome,
    frameContext: CTX_A7,
    instruction: "instruction",
    threshold: 0.005,
    budget: { fits: false, totalMs: 5000 }
  });

  assert.equal(decision.verdict, "reject");
  assert.equal(decision.reason, FailureReason.INVALID_VERDICT_BUDGET);
});

test("a refused budget still shows the boxes and the measured coverage", () => {
  const outcome = classifyModelOutcome({
    status: MODEL_SUCCESS_STATUS,
    prompt_used: "instruction",
    detections: [{ label: "defect", box: [0, 0, 100, 100] }]
  });

  const decision = buildInspectionDecision({
    outcome,
    frameContext: CTX_A7,
    instruction: "instruction",
    threshold: 0.005,
    budget: { fits: false, totalMs: 5000 }
  });

  assert.equal(decision.boxCount, 1, "the threshold never hides a box");
  assert.equal(decision.detections.length, 1);
  assert.equal(decision.coverage, 0.01);
});

test("a fitting budget leaves the ordinary verdict alone", () => {
  const outcome = classifyModelOutcome({
    status: MODEL_SUCCESS_STATUS,
    prompt_used: "instruction",
    detections: []
  });

  const decision = buildInspectionDecision({
    outcome,
    frameContext: CTX_A7,
    instruction: "instruction",
    threshold: 0.005,
    budget: { fits: true, totalMs: 2950 }
  });

  assert.equal(decision.verdict, "pass");
  assert.equal(decision.reason, "no_defect_detected");
});

test("no budget at all behaves exactly as before", () => {
  const outcome = classifyModelOutcome({
    status: MODEL_SUCCESS_STATUS,
    prompt_used: "instruction",
    detections: []
  });

  const decision = buildInspectionDecision({
    outcome,
    frameContext: CTX_A7,
    instruction: "instruction",
    threshold: 0.005
  });

  assert.equal(decision.verdict, "pass");
});

// The Model Instruction is what makes the box meaningful. If the model server's
// prompt could not be read there is nothing to verify against, so the item
// cannot be trusted â€” but it must still be reject, not a guess.
test("an instruction that cannot be read is a named fail-safe reason", () => {
  assert.equal(FailureReason.MODEL_INSTRUCTION_MISSING, "model_instruction_missing");

  const outcome = classifyModelOutcome({ status: MODEL_SUCCESS_STATUS, detections: [] });
  const decision = buildInspectionDecision({
    outcome,
    frameContext: CTX_A7,
    instruction: null,
    threshold: 0.005
  });

  assert.equal(decision.reason, FailureReason.MODEL_INSTRUCTION_MISSING);
});

// A missing instruction forces the Verdict, not the overlay: the boxes the model
// found are still what the operator needs to see.
test("a missing instruction still shows the boxes it found", () => {
  const decision = buildInspectionDecision({
    outcome: classifyModelOutcome({
      status: MODEL_SUCCESS_STATUS,
      detections: [{ label: "mould", box: [0, 0, 320, 240] }]
    }),
    frameContext: CTX_A7,
    instruction: "   ",
    threshold: 0.005
  });

  assert.equal(decision.verdict, "reject");
  assert.equal(decision.reason, "model_instruction_missing");
  assert.equal(decision.boxCount, 1, "the threshold never hides a box");
  assert.deepEqual(decision.detections, [{ label: "mould", box: [0, 0, 320, 240] }]);
  assert.ok(decision.coverage > 0);
});

test("a model outcome is not classified as a failure when there is no instruction", () => {
  const outcome = classifyModelOutcome({ status: MODEL_SUCCESS_STATUS, detections: [] });

  assert.equal(outcome.kind, "ok", "the transport succeeded; the instruction is the missing part");
});
// A configured timeout that cannot be read is a deployment fault. Falling back
// to the shipped default is safe, but it must be reported rather than silent.
test("an unreadable configured timeout is substituted and reported, never silent", () => {
  for (const bad of ["abc", 0, -1, null, undefined, "REPLACE_MODEL_TIMEOUT_MS"]) {
    const budget = resolveVerdictBudget(bad);
    assert.equal(budget.readable, false, `${bad} is not a usable timeout`);
    assert.equal(budget.substituted, true);
    assert.equal(budget.modelTimeoutMs, MODEL_TIMEOUT_MS, "the shipped default is used");
    assert.equal(budget.fits, true, "the substituted default still fits the window");
  }

  assert.equal(resolveVerdictBudget(900).readable, true);
  assert.equal(resolveVerdictBudget(900).modelTimeoutMs, 900);
});

test("a budget that cannot fit the window is refused rather than trusted", () => {
  const budget = resolveVerdictBudget(3000);
  assert.equal(budget.readable, true);
  assert.equal(budget.fits, false, "a timeout that overruns the Verdict Window must not be trusted");
});

// The Coverage Threshold decides pass or reject, so an unreadable value is
// never guessed at. An unconfigured placeholder takes the documented default.
test("coverage threshold resolution separates unconfigured from unreadable", () => {
  const unconfigured = resolveCoverageThreshold("REPLACE_COVERAGE_THRESHOLD");
  assert.equal(unconfigured.value, 0.005, "a fresh import gets the documented default");
  assert.equal(unconfigured.readable, true);
  assert.equal(unconfigured.defaulted, true);

  assert.equal(resolveCoverageThreshold(undefined).value, 0.005);
  assert.equal(resolveCoverageThreshold("").value, 0.005);

  for (const bad of ["abc", -0.1, 1.5, true, {}]) {
    const resolved = resolveCoverageThreshold(bad);
    assert.equal(resolved.readable, false, `${bad} must not be guessed at`);
    assert.equal(resolved.value, null);

    const decision = buildInspectionDecision({
      outcome: classifyModelOutcome({ status: "success", detections: [] }),
      frameContext: CTX_A7,
      instruction: "Look for mould.",
      threshold: resolved.value
    });
    assert.equal(decision.verdict, "reject");
    assert.equal(decision.reason, "invalid_threshold");
  }

  assert.equal(resolveCoverageThreshold("0.02").value, 0.02);
});

test("a failed frame capture is named as a capture failure, not a model failure", () => {
  const decision = buildInspectionDecision({
    outcome: classifyModelOutcome({ error: { message: "ECONNREFUSED" } }),
    frameContext: CTX_A7,
    instruction: "Look for mould.",
    threshold: 0.005,
    frameCaptureFailed: true
  });

  assert.equal(decision.verdict, "reject");
  assert.equal(
    decision.reason,
    "frame_capture_failed",
    "a dead Pi must not be logged as a model problem"
  );
});

test("a budget refusal still shows the boxes and the measured coverage", () => {
  const decision = buildInspectionDecision({
    outcome: classifyModelOutcome({
      status: "success",
      detections: [{ label: "mould", box: [0, 0, 320, 240] }]
    }),
    frameContext: CTX_A7,
    instruction: "Look for mould.",
    threshold: 0.005,
    budget: { fits: false, totalMs: 4200, modelTimeoutMs: 3600 }
  });

  assert.equal(decision.verdict, "reject");
  assert.equal(decision.reason, "invalid_verdict_budget");
  assert.equal(decision.boxCount, 1, "the threshold never hides a box");
  assert.ok(decision.coverage > 0);
});
// A configured model timeout that overruns the window cannot simply be trusted:
// the wire timeout is clamped so the forced reject actually reaches the ESP32
// before its auto-pass fallback fires. The clamp never hides the misconfiguration
// — fits stays false and the decision is still a named reject.
test("an over-budget model timeout is clamped at the wire and refused in the verdict", () => {
  const budget = resolveVerdictBudget(5000);

  assert.equal(budget.fits, false, "refused, not trusted");
  assert.equal(budget.modelTimeoutMs, 5000, "the configured value is recorded as given");
  assert.equal(
    budget.appliedModelTimeoutMs,
    MODEL_TIMEOUT_MS,
    "the wire waits no longer than the budgeted share"
  );
});

test("a fitting configured model timeout passes through unclamped", () => {
  const budget = resolveVerdictBudget(900);

  assert.equal(budget.fits, true);
  assert.equal(budget.appliedModelTimeoutMs, 900);
});

test("an unreadable configured model timeout applies the documented default", () => {
  const budget = resolveVerdictBudget("REPLACE_MODEL_TIMEOUT_MS");

  assert.equal(budget.readable, false);
  assert.equal(budget.fits, true, "the documented default fits the window");
  assert.equal(budget.appliedModelTimeoutMs, MODEL_TIMEOUT_MS);
});