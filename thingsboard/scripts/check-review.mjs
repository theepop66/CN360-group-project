import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createRelay } from "../../detection-relay/lib/relay.mjs";
import { startInspectionFixture } from "../../n8n/lib/static-inspection.mjs";
import { startControllerAdapter } from "../../n8n/lib/controller-test-adapter.mjs";
import { startTestN8n } from "../../n8n/lib/inspection-test-runtime.mjs";
import { buildModelInstruction } from "../../n8n/lib/inspection-records.mjs";
import { compareInspectionEvidence } from "../../n8n/lib/model-validation.mjs";
import { SoftwareValidationClient, loadValidationConfiguration, jsonRequest } from "../../n8n/lib/software-validation-client.mjs";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({ options: { output: { type: "string" } } });
if (!values.output) throw new Error("Provide --output evidence directory");
const output = resolve(values.output); mkdirSync(output, { recursive: true });
const config = loadValidationConfiguration(root);
const temporary = join(root, "thingsboard/.runtime/review-integration"); mkdirSync(temporary, { recursive: true });
const privateDirectory = join(homedir(), "AppData/Local/CN360/review-integration"); mkdirSync(privateDirectory, { recursive: true });
const credentialFile = join(privateDirectory, "credentials.json"); const credentialId = "cn360ReviewAudit";
writeFileSync(credentialFile, JSON.stringify([{ id: credentialId, name: "CN360 review integration", type: "supabaseApi",
  data: { host: config.auditConfig.supabaseBaseUrl, serviceRole: config.auditToken } }]));
const picture = JSON.parse(readFileSync(join(root, "n8n/.runtime/software-bench/cases.json"), "utf8"))[0];
const frame = { bytes: readFileSync(picture.file), width: picture.width, height: picture.height, mimeType: "image/jpeg" };
const target = "controlled software review test defect"; const instruction = buildModelInstruction(target);
const qualification = { quality: true, production: true, integrity: true, parity: true };
const policy = { version: 1, enabled: true, rules: [
  { id: "fixture-qualified", instruction, preparationProfile: "test/qualified", threshold: 0.003, width: frame.width, height: frame.height, automaticApproval: true, qualification },
  { id: "fixture-unqualified", instruction, preparationProfile: "test/unqualified", threshold: 0.003, width: frame.width, height: frame.height, automaticApproval: false }
] };
const controller = startControllerAdapter(join(root, "n8n/.runtime/controller-adapter/controller_adapter.exe"));
const fixture = await startInspectionFixture({ port: 8112, verdictHandler: (body, context) => controller.verdict(body, context.receiptAt) });
const relay = createRelay({ heartbeatMs: 1000 }); const client = new SoftwareValidationClient(config); let runtime;
const report = { startedAt: new Date().toISOString(), scope: "Real n8n, PC controller core, cloud, relay and ThingsBoard; controlled model/capture responses and synthetic qualification flags exercise policy branches only. Excluded from native quality and qualification.", cases: [] };
const save = () => writeFileSync(join(output, "review-integration.json"), JSON.stringify(report, null, 2) + "\n");
const scenarios = [
  ["unqualified-no-box", {}, "review", "pass"], ["unqualified-defect", { coverage: 0.01 }, "review", "reject"],
  ["unknown-profile", { inspectionProfile: "unknown" }, "review", "pass"],
  ["qualified-pass", { inspectionProfile: "test/qualified" }, "pass", "pass"],
  ["product-threshold", { inspectionProfile: "test/qualified", coverage: 0.004 }, "reject", "reject"],
  ["prompt-mismatch", { inspectionProfile: "test/qualified", echoMismatch: true }, "review", "pass"],
  ["model-timeout", { modelDelayMs: 1500 }, "error", null], ["invalid-box", { invalidBox: true }, "error", null],
  ["recovery", {}, "review", "pass"]
];
try {
  await relay.listen(8081, "0.0.0.0"); await client.connect(); const origin = "http://host.docker.internal:8112";
  runtime = await startTestN8n({ output: temporary, fixturePort: 8112, port: 5684, credentialFile, supabaseCredentialId: credentialId,
    runtimeConfig: { ...config.auditConfig, modelBaseUrl: origin, piBaseUrl: origin, esp32BaseUrl: origin,
      relayBaseUrl: "http://host.docker.internal:8081", telemetryBaseUrl: "http://host.docker.internal:8106",
      inspectionPolicy: policy, reviewFrameBaseUrl: undefined, monitoringProfile: "software-controlled-review-tests" } });
  writeFileSync(credentialFile, "[]");
  for (const [name, overrides, expected, suggestion] of scenarios) {
    const context = fixture.select({ id: "review-" + randomUUID(), target, frame, receiptAt: 131, inspectionProfile: "test/unqualified", ...overrides });
    await controller.reset("review-" + randomUUID()); const item = (await controller.admit(0)).active_item;
    const started = performance.now(); const response = await jsonRequest(runtime.origin + "/webhook/item-detected", { ...item, testCaseId: context.id });
    const row = { name, expected, response: response.body, responseMs: performance.now() - started }; report.cases.push(row);
    assert.equal(response.httpStatus, 200); assert.equal(response.body.result, expected);
    const telemetry = await client.telemetryFor(item); await fixture.waitFor(context, "completed", 1, 20000);
    const completion = context.completions[0]; await runtime.waitExecutions([completion.executionId]);
    Object.assign(row, { completion, telemetry, executionDetails: await runtime.executionDetails([completion.executionId]) }); save();
    const records = await client.recordsFor(item); row.discrepancies = compareInspectionEvidence({ ...completion, item }, { telemetry, ...records });
    assert.deepEqual(row.discrepancies, []); assert.equal(completion.decision.modelVerdict, suggestion);
    const shouldReview = expected === "review" || expected === "error";
    assert.equal(completion.decision.reviewRequired, shouldReview); assert.equal(records.hud.reviewRequired, shouldReview);
    assert.equal(String(telemetry.review_required), String(shouldReview));
    assert.equal(completion.decision.verdict, expected === "pass" ? "pass" : "reject");
    row.controller = await controller.step(131, true);
    assert.equal(row.controller.pass_count, expected === "pass" ? 1 : 0);
    assert.equal(row.controller.reject_count, expected === "pass" ? 0 : 1);
    if (shouldReview) {
      const queue = (await jsonRequest("http://127.0.0.1:8106/reviews")).body;
      const queued = queue.pending.find(entry => entry.values.controller_session === item.controller_session && entry.values.item_id === item.item_id);
      assert.ok(queued, "Required review missing from persistent queue");
      // This acknowledges synthetic test records only, explicitly labelled as
      // an automated integration check rather than a human product assessment.
      const recorded = await jsonRequest("http://127.0.0.1:8106/reviews", { eventId: queued.eventId, reviewer: "Automated integration check",
        disposition: "unsure", note: "Controlled fixture only; not a human product assessment or an automatic model approval." });
      assert.equal(recorded.body.controllerVerdictChanged, false); row.reviewRecord = recorded.body;
    }
    Object.assign(row, { completion, telemetry, ...records, passed: true }); save(); console.log("Verified review route: " + name);
  }
  report.passed = report.cases.every(row => row.passed); report.finishedAt = new Date().toISOString(); save();
} catch (error) { report.passed = false; report.error = error.stack; save(); throw error; }
finally { writeFileSync(credentialFile, "[]"); await runtime?.stop(); client.close(); await relay.close(); await fixture.close(); await controller.close(); }
