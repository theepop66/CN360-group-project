import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { startInspectionFixture, summarizeTiming, summarizeTimingByCase, assessInspection } from "../lib/static-inspection.mjs";
import { testWorkflows } from "../lib/inspection-test-runtime.mjs";

const image = readFileSync(new URL("../../test-assets/product-defects/bottle__good__000.png", import.meta.url));
const frame = { bytes: image, width: 900, height: 900, mimeType: "image/png", file: "bottle.png" };

test("credential fixture requires both Supabase headers before any persistence side effect", async t => {
  const fixture = await startInspectionFixture({ requireSupabaseAuth: true });
  t.after(() => fixture.close());
  const context = fixture.select({ id: "credential-headers", frame });
  for (const path of ["/rest/v1/inspection_results", "/storage/v1/object/static-test/frame.png"]) {
    for (const headers of [{}, { apikey: "isolated-fixture-key" }, { authorization: "Bearer isolated-fixture-key" }]) {
      const response = await fetch(fixture.origin + path, { method: "POST", headers, body: "{}" });
      assert.equal(response.status, 401);
    }
  }
  assert.equal(context.events.filter(e => ["database-write", "snapshot-upload"].includes(e.stage)).length, 0);
  const response = await fetch(fixture.origin + "/rest/v1/inspection_results", { method: "POST", headers: {
    apikey: "isolated-fixture-key", authorization: "Bearer isolated-fixture-key"
  }, body: "{}" });
  assert.equal(response.status, 200);
  assert.equal(context.events.filter(e => e.stage === "database-write").length, 1);
});

test("owned runtime workflow identities support n8n static-data persistence", () => {
  // n8n 2.6's isWorkflowIdValid skips persistence for IDs longer than 16 characters.
  const flows = testWorkflows("http://host.docker.internal:8102");
  assert.equal(new Set(flows.map(f => f.id)).size, 3);
  assert.ok(flows.every(f => f.id.length <= 16));
});

test("capture preserves actual geometry and advances identity without changing the picture", async t => {
  const fixture = await startInspectionFixture();
  t.after(() => fixture.close());
  fixture.select({ id: "geometry", frame });
  const first = await fetch(fixture.origin + "/capture");
  assert.equal(first.headers.get("x-frame-width"), "900");
  assert.equal(first.headers.get("x-frame-height"), "900");
  assert.equal(first.headers.get("content-type"), "image/png");
  assert.equal(createHash("sha256").update(Buffer.from(await first.arrayBuffer())).digest("hex"), createHash("sha256").update(image).digest("hex"));
  const second = await fetch(fixture.origin + "/capture");
  assert.notEqual(first.headers.get("x-frame-sequence"), second.headers.get("x-frame-sequence"));
  assert.equal(first.headers.get("x-camera-session"), second.headers.get("x-camera-session"));
  fixture.select({ id: "duplicate", frame, repeatFrame: true });
  const duplicate = await fetch(fixture.origin + "/capture");
  assert.equal(second.headers.get("x-frame-sequence"), duplicate.headers.get("x-frame-sequence"));
  fixture.restartSession();
  const restarted = await fetch(fixture.origin + "/capture");
  assert.notEqual(second.headers.get("x-camera-session"), restarted.headers.get("x-camera-session"));
});

test("predict checks the actual multipart image and explicit prompt", async t => {
  const fixture = await startInspectionFixture();
  t.after(() => fixture.close());
  const context = fixture.select({ id: "multipart", frame, coverage: 0.005 });
  const form = new FormData();
  form.append("file", new Blob([image]), "frame.png");
  form.append("prompt", context.instruction);
  const response = await fetch(fixture.origin + "/predict", { method: "POST", body: form });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.prompt_used, context.instruction);
  assert.equal(result.detections[0].box[2] * result.detections[0].box[3] / (900 * 900), 0.005);
  const wrong = new FormData();
  wrong.append("image", new Blob([image]), "frame.png");
  wrong.append("prompt", context.instruction);
  assert.equal((await fetch(fixture.origin + "/predict", { method: "POST", body: wrong })).status, 422);
  assert.equal(context.events.filter(e => e.stage === "model-start").length, 2);
  assert.equal(context.events.filter(e => e.stage === "model-end").length, 2);
});

test("delayed response retains its case when the next case is selected", async t => {
  const fixture = await startInspectionFixture();
  t.after(() => fixture.close());
  const context = fixture.select({ id: "old", frame, modelDelayMs: 50 });
  const form = new FormData();
  form.append("file", new Blob([image]), "frame.png");
  form.append("prompt", context.instruction);
  const response = fetch(fixture.origin + "/predict", { method: "POST", body: form });
  await fixture.waitFor(context, "model-start");
  fixture.select({ id: "new", frame });
  await (await response).json();
  assert.ok(context.events.some(e => e.stage === "model-end"));
  assert.equal(fixture.current.events.length, 0);
});

test("a late execution callback belongs to its original case", async t => {
  const fixture = await startInspectionFixture();
  t.after(() => fixture.close());
  const original = fixture.select({ id: "expired-execution", frame });
  const next = fixture.select({ id: "next-execution", frame });
  await fetch(fixture.origin + "/completed", { method: "POST", body: JSON.stringify({ testCaseId: original.id, executionId: "3" }) });
  assert.equal(original.completions.length, 1);
  assert.equal(next.completions.length, 0);
  await fetch(fixture.origin + "/verdict", { method: "POST", headers: { "X-CN360-Test-Case": original.id }, body: JSON.stringify({ action: "reject" }) });
  await fetch(fixture.origin + "/rest/v1/inspection_results", { method: "POST", headers: { "X-CN360-Test-Case": original.id }, body: JSON.stringify({ verdict: "reject" }) });
  assert.equal(original.events.filter(e => e.stage === "verdict-received").length, 1);
  assert.equal(original.events.filter(e => e.stage === "database-write").length, 1);
  assert.equal(next.events.length, 0);
});

test("timing summaries retain failures and do not count them as successful measurements", () => {
  const result = summarizeTiming([{ elapsedMs: 10, result: "pass" }, { elapsedMs: 30, result: "reject" }, { elapsedMs: 1200, result: "error", reason: "model_timeout" }]);
  assert.equal(result.count, 3);
  assert.equal(result.failures, 1);
  assert.equal(result.timeouts, 1);
  assert.equal(result.allAttempts.maxMs, 1200);
  assert.equal(result.successfulOnly.count, 2);
  const missing = summarizeTiming([{ result: "error", reason: "connection lost" }]);
  assert.equal(missing.count, 1);
  assert.equal(missing.failures, 1);
  assert.equal(missing.missingVerdictReceipts, 1);
});

test("case timing summaries keep failures within the correct image/target group", () => {
  const result = summarizeTimingByCase([{ caseId: "normal", elapsedMs: 12, result: "pass" }, { caseId: "damaged", elapsedMs: 1100, result: "error", reason: "model_timeout" }]);
  assert.equal(result.normal.successes, 1);
  assert.equal(result.damaged.timeouts, 1);
  assert.equal(result.damaged.successfulOnly.count, 0);
});

test("independent policy assessment distinguishes small defects and ignored actuator commands", () => {
  const completion = { decision: { verdict: "pass", coverage: 0.004, coverageThreshold: 0.005, detections: [{ box: [0, 0, 40, 100] }] }, frame: { width: 1000, height: 1000 }, response: { status: "success", result: "pass" }, control: { esp32Accepted: false } };
  const assessment = assessInspection(completion);
  assert.equal(assessment.policyCorrect, true);
  assert.equal(assessment.controllerAccepted, false);
  completion.decision.coverage = 0.5;
  assert.equal(assessInspection(completion).policyCorrect, false);
});
