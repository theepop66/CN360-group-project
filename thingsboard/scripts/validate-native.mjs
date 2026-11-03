import assert from "node:assert/strict";
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { command } from "../../n8n/lib/inspection-test-runtime.mjs";
import { assertNativePortAvailable, nativeEnvironment, waitForNativeModel } from "../../n8n/lib/native-profile.mjs";
import { compareInspectionEvidence, scorePrediction, summarizeQuality, timingSummary, assessReadiness } from "../../n8n/lib/model-validation.mjs";
import { SoftwareValidationClient, loadValidationConfiguration, jsonRequest, waitUntil } from "../../n8n/lib/software-validation-client.mjs";
import { validationGallery } from "../../n8n/lib/validation-gallery.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { phase: { type: "string", default: "production" }, output: { type: "string", default: "docs/evidence/native-model-software-2026-11-03" },
  source: { type: "string", default: "D:/CN360/locate-anything.cpp" } } });
if (!["production", "diagnostic", "finalize"].includes(values.phase)) throw new Error("phase must be production, diagnostic or finalize");
const output = resolve(root, values.output); mkdirSync(output, { recursive: true });
const privateOutput = join(root, "thingsboard/.runtime/native-validation"); mkdirSync(privateOutput, { recursive: true });
const write = (name, object) => writeFileSync(join(output, name), JSON.stringify(object, null, 2) + "\n");
const read = name => JSON.parse(readFileSync(join(output, name), "utf8"));
const settings = JSON.parse(readFileSync(join(root, "thingsboard/software-native.local.json"), "utf8"));
const criteria = JSON.parse(readFileSync(join(root, "n8n/validation-criteria.json"), "utf8"));
const pictures = JSON.parse(readFileSync(join(root, "n8n/.runtime/software-bench/cases.json"), "utf8"));
const hashFile = async path => { const hash = createHash("sha256"); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest("hex"); };
const publicCase = picture => ({ id: picture.id, target: picture.target, hasDefect: picture.hasDefect, width: picture.width, height: picture.height,
  sourceFile: basename(picture.original), originalSha256: picture.originalSha256, servedSha256: picture.servedSha256 });

if (values.phase === "production") {
  assert.equal(settings.imageMaxSide, criteria.imageMaxSide);
  assert.equal(settings.modelProfile, "native"); assert.equal(settings.offline, false, "Production software validation checks actual audit delivery");
  const frozen = { frozenAt: new Date().toISOString(), criteria, cases: pictures.map(publicCase),
    diagnosticSamples: pictures.length * criteria.diagnosticRepetitions, productionCaseIds: criteria.productionCaseIds,
    nativeSourceRevision: (await command("git", ["rev-parse", "HEAD"], { cwd: values.source })).trim(),
    modelSha256: await hashFile(settings.modelPath), librarySha256: await hashFile(settings.modelLibrary),
    requestedBackend: settings.modelDevice, mode: "hybrid", threads: 6,
    scope: "Real LocateAnything, real n8n, actual C++ controller core on PC, actual Supabase/relay/ThingsBoard. Saved images; no physical sorting." };
  const frozenPath = join(output, "frozen-protocol.json");
  if (existsSync(frozenPath)) throw new Error("The frozen protocol already exists; choose a new output directory for a new run");
  write("frozen-protocol.json", frozen);
  const client = new SoftwareValidationClient(loadValidationConfiguration(root));
  const report = { startedAt: new Date().toISOString(), samples: [], scope: frozen.scope,
    timingDefinition: "receiptMs is the client-observed item-admission-to-inspection-response upper bound; no physical latency is claimed. modelMs is n8n's measured model HTTP node duration." };
  write("production.json", report);
  try {
    await client.connect();
    for (const id of criteria.productionCaseIds) {
      const picture = pictures.find(candidate => candidate.id === id); assert.ok(picture, "Unknown frozen production case");
      await waitForNativeModel("http://127.0.0.1:8000", settings.modelDevice);
      await waitUntil(async () => (await jsonRequest("http://127.0.0.1:8104/status")).body.admission_ready);
      const selected = await jsonRequest("http://127.0.0.1:8104/bench/picture", { id }); assert.equal(selected.httpStatus, 200);
      const started = performance.now();
      const response = await jsonRequest("http://127.0.0.1:8104/bench/item", {});
      const receiptMs = performance.now() - started;
      assert.equal(response.httpStatus, 200); const item = response.body.item;
      const telemetry = await client.telemetryFor(item);
      const visibleAfterMs = performance.now() - started;
      const records = await client.recordsFor(item);
      const execution = await client.executionFor(item);
      const discrepancies = compareInspectionEvidence(execution, { telemetry, ...records });
      const snapshot = await fetch(records.inspection.frame_url, { signal: AbortSignal.timeout(15000) });
      assert.ok(snapshot.ok); const snapshotSha256 = createHash("sha256").update(Buffer.from(await snapshot.arrayBuffer())).digest("hex");
      if (snapshotSha256 !== picture.servedSha256) discrepancies.push("Stored snapshot bytes differ from the frozen input");
      const row = { caseId: id, expected: picture.hasDefect ? "reject" : "pass", result: response.body.inspection.result,
        modelMs: execution.modelMs, receiptMs, visibleAfterMs, controlOutcome: response.body.inspection.control.controlOutcome,
        execution, telemetry, ...records, snapshotSha256, discrepancies };
      report.samples.push(row); write("production.json", report);
      console.log(`${id}: ${row.result}; model ${row.modelMs} ms; response ${receiptMs.toFixed(0)} ms; visible ${visibleAfterMs.toFixed(0)} ms; discrepancies ${discrepancies.length}`);
    }
    report.finishedAt = new Date().toISOString();
    report.timing = { model: timingSummary(report.samples.map(row => row.modelMs)), response: timingSummary(report.samples.map(row => row.receiptMs)),
      visibility: timingSummary(report.samples.map(row => row.visibleAfterMs)) };
    write("production.json", report);
  } finally { client.close(); }
}

if (values.phase === "diagnostic") {
  const frozen = read("frozen-protocol.json");
  assert.equal(await hashFile(settings.modelPath), frozen.modelSha256); assert.equal(await hashFile(settings.modelLibrary), frozen.librarySha256);
  assert.deepEqual(pictures.map(publicCase), frozen.cases, "Prepared inputs changed after the protocol was frozen");
  await command("powershell.exe", ["-NoProfile", "-File", join(root, "n8n/scripts/stop-software-bench.ps1")], { cwd: root });
  await assertNativePortAvailable(8002);
  const log = openSync(join(privateOutput, "diagnostic-model.log"), "w");
  const child = spawn(settings.python, ["-m", "cn360_model"], { cwd: join(root, "model-service"), windowsHide: true,
    env: { ...nativeEnvironment(settings, pictures[0].file, { profile: "diagnostic", port: 8002 }), PYTHONPATH: join(root, "model-service") }, stdio: ["ignore", log, log] });
  closeSync(log);
  const report = { profile: "native-diagnostic-measurement-only", startedAt: new Date().toISOString(), samples: [],
    scope: "Native prediction quality with a 120-second diagnostic allowance. No item-bound controller request; cannot approve production timing or physical sorting." };
  try {
    report.health = await waitForNativeModel("http://127.0.0.1:8002", settings.modelDevice, { child });
    for (const picture of pictures) {
      for (let repetition = 1; repetition <= frozen.criteria.diagnosticRepetitions; repetition++) {
        const body = new FormData(); body.append("file", new Blob([readFileSync(picture.file)], { type: "image/jpeg" }), "frame.jpg");
        body.append("prompt", `Locate all the instances that matches the following description: ${picture.target}.`);
        const started = performance.now();
        const response = await fetch("http://127.0.0.1:8002/predict", { method: "POST", body, signal: AbortSignal.timeout(125000) });
        const prediction = await response.json();
        const row = { ...scorePrediction(picture, { httpStatus: response.status, body: prediction }, frozen.criteria.coverageThreshold),
          repetition, httpStatus: response.status, elapsedMs: performance.now() - started, response: prediction };
        report.samples.push(row); write("diagnostic.json", report);
        console.log(`${picture.id} ${repetition}/${frozen.criteria.diagnosticRepetitions}: expected ${row.expected}, actual ${row.actual}; ${row.elapsedMs.toFixed(0)} ms`);
      }
    }
    report.finishedAt = new Date().toISOString(); report.quality = summarizeQuality(report.samples); report.timing = timingSummary(report.samples.map(row => row.elapsedMs));
    report.byCase = Object.fromEntries(pictures.map(picture => [picture.id, { ...summarizeQuality(report.samples.filter(row => row.caseId === picture.id)),
      timing: timingSummary(report.samples.filter(row => row.caseId === picture.id).map(row => row.elapsedMs)) }]));
    write("diagnostic.json", report);
  } finally {
    if (child.exitCode === null) await command("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
  }
}

if (values.phase === "finalize") {
  const frozen = read("frozen-protocol.json"); const diagnostic = read("diagnostic.json"); const production = read("production.json");
  for (const row of production.samples) row.discrepancies = compareInspectionEvidence(row.execution, row);
  production.evidenceRecheckedAt = new Date().toISOString();
  write("production.json", production);
  const consistency = existsSync(join(output, "consistency.json")) ? read("consistency.json") : null;
  const quality = summarizeQuality(diagnostic.samples);
  const readiness = assessReadiness({ quality, production: production.samples,
    consistencyPassed: consistency ? consistency.passed && production.samples.every(row => row.discrepancies.length === 0) : null },
    { ...frozen.criteria, diagnosticCaseIds: frozen.cases.map(picture => picture.id), minimumDiagnosticAttempts: frozen.diagnosticSamples, minimumProductionAttempts: frozen.productionCaseIds.length });
  const summary = { assessedAt: new Date().toISOString(), criteria: frozen.criteria, quality, diagnosticTiming: diagnostic.timing, productionTiming: production.timing,
    diagnosticSamples: diagnostic.samples.length, productionSamples: production.samples.length, ...readiness };
  write("readiness.json", summary);
  const gallery = validationGallery({ summary, samples: diagnostic.samples,
    pictures: pictures.map(picture => ({ ...publicCase(picture), dataUri: "data:image/jpeg;base64," + readFileSync(picture.file).toString("base64") })) });
  writeFileSync(join(output, "gallery.html"), gallery);
  const client = new SoftwareValidationClient(loadValidationConfiguration(root));
  await client.api.login(client.accounts.admin.username, client.accounts.admin.password);
  await client.api.request(`/api/plugins/telemetry/DEVICE/${client.accounts.deviceId}/timeseries/ANY`, { method: "POST", body: { ts: Date.now(), values: {
    validation_status: readiness.readyForPhysicalIntegration ? "passed" : "failed",
    validation_missed_defects: quality.missedDefects, validation_false_rejects: quality.falseRejects, validation_errors: quality.errors,
    validation_samples: quality.attempts, validation_quality_gate: readiness.gates.quality, validation_timing_gate: readiness.gates.productionTiming,
    validation_consistency_gate: readiness.gates.consistency, validation_assessed_at: summary.assessedAt
  } } });
  console.log(JSON.stringify(summary, null, 2));
}
