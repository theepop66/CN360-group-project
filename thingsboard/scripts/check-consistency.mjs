import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { createRelay } from "../../detection-relay/lib/relay.mjs";
import { startInspectionFixture } from "../../n8n/lib/static-inspection.mjs";
import { startControllerAdapter } from "../../n8n/lib/controller-test-adapter.mjs";
import { startTestN8n } from "../../n8n/lib/inspection-test-runtime.mjs";
import { compareInspectionEvidence } from "../../n8n/lib/model-validation.mjs";
import { SoftwareValidationClient, loadValidationConfiguration, jsonRequest, waitUntil } from "../../n8n/lib/software-validation-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { output: { type: "string", default: "docs/evidence/native-model-software-2026-11-03" } } });
const output = resolve(root, values.output); mkdirSync(output, { recursive: true });
const temporary = join(root, "thingsboard/.runtime/consistency"); mkdirSync(temporary, { recursive: true });
const report = { startedAt: new Date().toISOString(), cases: [],
  scope: "Real n8n, actual controller C++ core on PC with deterministic virtual time, actual cloud audit/relay/ThingsBoard. Camera and model faults deliberately injected; excluded from native-model quality scores." };
const save = () => writeFileSync(join(output, "consistency.json"), JSON.stringify(report, null, 2) + "\n");
const config = loadValidationConfiguration(root);
const privateFolder = join(homedir(), "AppData/Local/CN360/native-validation"); mkdirSync(privateFolder, { recursive: true });
const credentialFile = join(privateFolder, "credentials.json");
const credentialId = "cn360NativeValidationAudit";
writeFileSync(credentialFile, JSON.stringify([{ id: credentialId, name: "CN360 validation audit", type: "supabaseApi",
  data: { host: config.auditConfig.supabaseBaseUrl, serviceRole: config.auditToken } }]));
const pictures = JSON.parse(readFileSync(join(root, "n8n/.runtime/software-bench/cases.json"), "utf8"));
const photo = pictures[0]; const frame = { bytes: readFileSync(photo.file), width: photo.width, height: photo.height, mimeType: "image/jpeg" };
const run = randomUUID().slice(0, 8);
const controller = startControllerAdapter(join(root, "n8n/.runtime/controller-adapter/controller_adapter.exe"));
const fixture = await startInspectionFixture({ port: 8112, verdictHandler: (command, context) => controller.verdict(command, context.receiptAt) });
const relay = createRelay({ heartbeatMs: 1000 });
const client = new SoftwareValidationClient(config);
let runtime;
const cases = [
  ["pass", {}, "pass"], ["reject", { coverage: 0.25 }, "reject"],
  ["model-error", { modelError: true }, "error"], ["model-timeout", { modelDelayMs: 1500 }, "error"],
  ["model-unavailable", { modelOffline: true }, "error"], ["capture-failure", { captureOffline: true }, "error"],
  ["invalid-output", { invalidBox: true }, "error"], ["prompt-mismatch", { echoMismatch: true }, "pass"],
  ["expired-controller", { receiptAt: 3031 }, "pass"], ["recovery", {}, "pass"]
];
try {
  await relay.listen(8081, "0.0.0.0"); await client.connect();
  const origin = "http://host.docker.internal:8112";
  runtime = await startTestN8n({ output: temporary, fixturePort: 8112, port: 5684, credentialFile, supabaseCredentialId: credentialId,
    runtimeConfig: { ...config.auditConfig, modelBaseUrl: origin, piBaseUrl: origin, esp32BaseUrl: origin, relayBaseUrl: "http://host.docker.internal:8081",
      telemetryBaseUrl: "http://host.docker.internal:8106", monitoringProfile: "software-controlled-fault-injection", inspectionPolicy: undefined } });
  writeFileSync(credentialFile, "[]");
  for (const [name, options, expected] of cases) {
    const row = { name, expected, discrepancies: [] }; report.cases.push(row);
    try {
      await controller.reset("validation-" + run + "-" + name);
      const station = await controller.admit(0); const item = station.active_item;
      const context = fixture.select({ id: run + "-" + name, target: photo.target, frame, receiptAt: 131, ...options });
      const started = performance.now();
      const response = await jsonRequest(runtime.origin + "/webhook/item-detected", { ...item, testCaseId: context.id, inspectionTarget: photo.target });
      row.responseMs = performance.now() - started; row.response = response;
      assert.equal(response.httpStatus, 200); assert.equal(response.body.result, expected);
      const telemetry = await client.telemetryFor(item); row.visibleAfterMs = performance.now() - started;
      await fixture.waitFor(context, "completed", 1, 20000);
      const completion = context.completions[0];
      const executions = await runtime.waitExecutions([completion.executionId]); assert.equal(executions[0].status, "success");
      const records = await client.recordsFor(item);
      const normalized = { ...completion, item, frame: completion.frame, control: completion.control };
      row.discrepancies.push(...compareInspectionEvidence(normalized, { telemetry, ...records }));
      assert.equal(response.body.control.controlOutcome, name === "expired-controller" ? "ignored" : "accepted");
      assert.ok(row.visibleAfterMs < 5000, "Dashboard visibility exceeded five seconds");
      if (name === "prompt-mismatch") assert.equal(records.inspection.prompt_verified, false);
      if (expected === "error") assert.equal(response.body.status, "error");
      row.completion = completion; row.telemetry = telemetry; Object.assign(row, records);
      row.controllerAfter = await controller.step(options.receiptAt ?? 131, true);
      if (name === "pass") {
        const before = Number(telemetry.inspection_count);
        const journalBefore = (await jsonRequest("http://127.0.0.1:8106/health")).body.inspectionCount;
        context.repeatFrame = true;
        const duplicate = await jsonRequest(runtime.origin + "/webhook/item-detected", { ...item, testCaseId: context.id, inspectionTarget: photo.target });
        await fixture.waitFor(context, "completed", 2, 20000);
        assert.equal(duplicate.body.control.controlOutcome, "ignored");
        const after = await client.telemetryFor(item); assert.equal(Number(after.inspection_count), before);
        assert.equal((await jsonRequest("http://127.0.0.1:8106/health")).body.inspectionCount, journalBefore);
        const duplicateState = await controller.step(131, true);
        assert.equal(duplicateState.pass_count, row.controllerAfter.pass_count);
        assert.equal(duplicateState.reject_count, row.controllerAfter.reject_count);
        const inspections = await client.rows("inspection_results", { controller_session: "eq." + item.controller_session, item_id: "eq." + item.item_id });
        assert.equal(inspections.length, 1); row.duplicateResponse = duplicate.body;
      }
      row.passed = row.discrepancies.length === 0;
    } catch (error) { row.discrepancies.push(error.message); row.passed = false; }
    save(); console.log(`${name}: ${row.passed ? "passed" : "FAILED"}${row.discrepancies.length ? ": " + row.discrepancies.join("; ") : ""}`);
  }
  report.finishedAt = new Date().toISOString(); report.passed = report.cases.every(row => row.passed); save();
  if (!report.passed) process.exitCode = 1;
} finally {
  writeFileSync(credentialFile, "[]"); client.close(); await runtime?.stop(); await fixture.close(); await relay.close(); await controller.close();
}
