import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { startInspectionFixture, assessInspection, summarizeTiming, summarizeTimingByCase } from "../lib/static-inspection.mjs";
import { command, startTestN8n } from "../lib/inspection-test-runtime.mjs";
import { buildModelInstruction } from "../lib/inspection-records.mjs";
import { parseDetectionPayload } from "../../pico-webapp/js/overlay.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: options } = parseArgs({ options: {
  mode: { type: "string", default: "fixtures" }, output: { type: "string" },
  python: { type: "string", default: process.env.CN360_TEST_PYTHON ?? "python" },
  repetitions: { type: "string", default: "10" }, "model-url": { type: "string", default: "http://127.0.0.1:8002" },
  "workflow-export": { type: "string" }, "fixture-port": { type: "string", default: "8102" },
  "n8n-port": { type: "string", default: "5682" }, docker: { type: "string", default: process.env.CN360_DOCKER ?? "docker" },
  image: { type: "string", default: "n8n-backup:latest" },
  "credential-store": { type: "boolean", default: false },
  "max-side": { type: "string", default: "0" }, "direct-variants": { type: "string", default: "original,jpeg" },
} });
if (!["fixtures", "real", "all", "diagnostic"].includes(options.mode)) throw new Error("mode must be fixtures, real, all or diagnostic");
const repetitions = Number(options.repetitions);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 1000) throw new Error("repetitions must be 1..1000");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolve(options.output ?? join(root, "n8n/.runtime/static-inspection", runId));
mkdirSync(output, { recursive: true });
await command(options.python, [join(root, "n8n/scripts/prepare-inspection-images.py"), "--assets", join(root, "test-assets/product-defects"), "--output", output, "--max-side", options["max-side"]]);
const cases = JSON.parse(readFileSync(join(output, "cases.json"), "utf8"));
const frameFor = c => ({ bytes: readFileSync(c.file), width: c.width, height: c.height, mimeType: "image/jpeg", file: c.file });
const report = {
  runId, startedAt: new Date().toISOString(), mode: options.mode, gitRevision: (await command("git", ["rev-parse", "HEAD"], { cwd: root })).trim(),
  scope: "Real isolated n8n webhooks; still-image capture substitute; recording actuator/database/storage/relay. Physical acceptance and actual DB/Pico delivery remain unverified.",
  settings: { threshold: 0.005, n8nModelTimeoutMs: 1200, controllerWindowMs: 3000, jpegQuality: 95, jpegSubsampling: 0, repetitions, maxSide: Number(options["max-side"]), authentication: options["credential-store"] ? "n8n-stored-supabase-credential" : "inline-fixture-key" },
  cases: [], blocked: ["Camera deployment deferred", "Physical sensor/servo and Pico acceptance not executed", "Real database/storage/relay acceptance needs configured test services"],
};
if (options.mode === "diagnostic") report.scope += " Measurement-only model service; this run cannot establish the production service's 1100 ms deadline.";
if (options["workflow-export"]) {
  const installed = JSON.parse(readFileSync(options["workflow-export"], "utf8")).filter(w => w.name.startsWith("CN360 -"));
  report.installedWorkflows = installed.map(w => ({ id: w.id, name: w.name, active: w.active,
    sha256: createHash("sha256").update(JSON.stringify(w)).digest("hex"),
    unresolvedPlaceholders: JSON.stringify(w).includes("REPLACE_"),
    compactInspectionResponse: w.nodes.some(n => n.name === "build-inspection-response"),
    checkedPromptResponse: w.nodes.some(n => n.name === "prompt-was-applied") }));
  report.scope += " Existing localhost:5678 exports were inspected read-only; the test runtime uses current repository graphs. Installed workflow drift is listed separately.";
}
const persist = () => {
  const measured = report.cases.filter(c => c.runType && c.runType !== "concurrent");
  report.summary = summarizeTiming(measured);
  report.summaryByCase = summarizeTimingByCase(measured);
  if (options["credential-store"]) {
    const checks = report.cases.flatMap(c => c.events ?? []).filter(e => e.stage === "credential-check");
    report.authentication = { checkedRequests: checks.length, invalidRequests: checks.filter(e => !e.valid).length,
      resources: [...new Set(checks.map(e => e.resource))].sort() };
  }
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
};
persist();
const fixture = await startInspectionFixture({ port: Number(options["fixture-port"]), upstream: options["model-url"], requireSupabaseAuth: options["credential-store"] });
let runtime;
const baseCase = cases.find(c => c.id.startsWith("bottle__good"));
const check = (row, condition, message) => { if (!condition) row.failures.push(message); };
async function post(path, body) {
  const started = performance.now();
  const response = await fetch(runtime.origin + "/webhook/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(["inspect-now", "item-detected"].includes(path) ? fixture.current.itemContext : {}), ...body, testCaseId: fixture.current.id }), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { invalidJson: text.slice(0, 200) }; }
  return { httpStatus: response.status, body: parsed, elapsedMs: performance.now() - started };
}
async function inspect(id, scenario = {}, c = baseCase, count = 1) {
  const context = fixture.select({ id, frame: frameFor(c), target: c.target, itemContext: { controller_session: "fixture-" + (scenario.repeatFrame ? "fresh-for-duplicate" : id), item_id: "1", verdict_window_ms: 3000 }, ...scenario });
  const row = { id, caseId: c.id, runType: count > 1 ? "concurrent" : scenario.realModel ? "sequential" : "controlled", hasDefect: c.hasDefect, target: c.target, originalSha256: c.originalSha256, servedSha256: c.servedSha256, failures: [], events: context.events, completions: context.completions };
  let inspectionStarted;
  try {
    if (scenario.realModel) {
      const prompt = await post("detection-prompt", { prompt: c.target });
      check(row, prompt.body.status === "updated", "Real prompt update was not confirmed");
      await fixture.waitFor(context, "completed");
      context.completions.length = 0;
      context.events.length = 0;
    }
    const started = performance.now();
    inspectionStarted = started;
    const responses = await Promise.all(Array.from({ length: count }, () => post(scenario.path ?? "inspect-now", { inspectionTarget: c.target })));
    row.elapsedMs = performance.now() - started;
    row.responses = responses;
    row.result = responses[0].body.result; row.reason = responses[0].body.reason;
    const receipt = context.events.find(e => e.stage === "verdict-received");
    row.verdictReceiptMs = receipt ? receipt.atMs - started : null;
    await fixture.waitFor(context, "completed", count, 30000);
    row.executions = await runtime.waitExecutions(context.completions.map(c => c.executionId));
    check(row, row.executions.every(e => e.status === "success"), "n8n execution did not finish successfully");
    if (scenario.modelDelayMs || scenario.realModel) {
      if (context.events.some(e => e.stage === "model-start")) await fixture.waitFor(context, "model-end", context.events.filter(e => e.stage === "model-start").length, 125000);
    }
    for (const completion of context.completions) {
      const assessment = assessInspection(completion);
      check(row, assessment.policyCorrect, "Independent coverage/verdict assessment failed");
      if (completion.frame?.width) check(row, completion.frame.width === c.width && completion.frame.height === c.height, "Source dimensions changed");
      check(row, context.events.some(e => e.stage === "verdict-received" && e.command.action === completion.decision?.verdict), "Verdict command missing or inconsistent");
    }
    if (scenario.expected) check(row, responses.every(r => r.body.result === scenario.expected), `Expected ${scenario.expected}, received ${row.result}`);
    for (const e of context.events.filter(e => e.stage === "model-start")) check(row, e.validFile && e.validPrompt, "Multipart/prompt contract failed");
    for (const e of context.events.filter(e => e.stage === "credential-check")) check(row, e.valid, "Stored credential did not supply both required Supabase headers");
    for (const e of context.events.filter(e => e.stage === "snapshot-upload")) {
      check(row, e.matchesCapture, "Uploaded snapshot differs from source bytes");
      check(row, e.matchesObjectName, "Uploaded snapshot object path differs from captured frame identity");
    }
    for (const e of context.events.filter(e => e.stage === "hud-delivery")) {
      try { parseDetectionPayload(e.payload); } catch (error) { row.failures.push("HUD parser: " + error.message); }
    }
    const control = context.events.find(e => e.stage === "database-write" && e.table === "control_actions");
    const inspection = context.events.find(e => e.stage === "database-write" && e.table === "inspection_results");
    if (control && inspection) check(row, control.row.inspection_id === (scenario.databaseError ? null : `${id}-inspection_results`), "Control Action FK differs from returned inspection ID");
    if (scenario.echoMismatch) check(row, context.completions[0].decision.promptVerified === false, "Prompt mismatch not recorded");
    if (scenario.verdictIgnored) check(row, context.completions[0].control?.esp32Accepted === false, "Ignored verdict recorded as accepted");
    if (scenario.repeatFrame) check(row, context.completions[0].duplicate === true && !inspection && !context.events.some(e => e.stage === "hud-delivery"), "Duplicate record/HUD suppression failed");
    if (scenario.modelDelayMs >= 1200) check(row, context.events.filter(e => e.stage === "verdict-received").length === count, "Late model success emitted another command");
    if (scenario.checkBusy) check(row, context.events.some(e => e.stage === "model-end" && e.body?.reason === "model_busy"), "Concurrent native request rejection was not observed");
  } catch (error) {
    row.failures.push(error.message); row.result ??= "error"; row.reason ??= "test_execution_failed";
    if (row.elapsedMs == null && inspectionStarted != null) { row.elapsedMs = performance.now() - inspectionStarted; row.elapsedCensored = true; }
  }
  // Downstream completion failure must not cause the next sequential case to
  // start while an expired model request is still computing in the proxy.
  if (scenario.realModel) {
    const starts = context.events.filter(e => e.stage === "model-start").length;
    if (starts > context.events.filter(e => e.stage === "model-end").length) {
      try { await fixture.waitFor(context, "model-end", starts, 125000); }
      catch (error) { row.failures.push("Upstream drain: " + error.message); }
    }
  }
  row.status = row.failures.length ? "failed" : "passed";
  row.evaluationStatus = row.result === "error" ? "failed" : "completed";
  report.cases.push(row); persist();
  console.log(`contract ${row.status}: ${id} (inspection ${row.result ?? "no response"})`);
  return row;
}
try {
  runtime = await startTestN8n({ output, fixturePort: Number(options["fixture-port"]), port: Number(options["n8n-port"]), docker: options.docker, image: options.image,
    ...(options["credential-store"] ? { supabaseCredentialId: "cn360TestSb" } : {}) });
  report.workflowExportSha256 = createHash("sha256").update(readFileSync(join(output, "workflows.json"))).digest("hex");
  report.runtimeImage = options.image;
  if (["fixtures", "all"].includes(options.mode)) {
    const scenarios = [
      ["empty", { expected: "pass" }], ["below-threshold", { coverage: 0.0049, expected: "pass" }],
      ["at-threshold", { coverage: 0.005, expected: "reject" }], ["above-threshold", { coverage: 0.0051, expected: "reject" }],
      ["overlap-clamp", { boxes: [[0, 0, 900, 900], [0, 0, 900, 900]], expected: "reject" }],
      ["model-error", { modelError: true, expected: "error" }], ["missing-status", { missingStatus: true, expected: "error" }],
      ["http-error", { httpError: true, expected: "error" }], ["invalid-box", { invalidBox: true, expected: "error" }],
      ["malformed-json", { malformed: true, expected: "error" }], ["model-offline", { modelOffline: true, expected: "error" }],
      ["capture-offline", { captureOffline: true, expected: "error" }], ["invalid-frame-headers", { invalidHeaders: true, expected: "error" }],
      ["prompt-echo-mismatch", { echoMismatch: true, coverage: 0.01, expected: "reject" }],
      ["ignored-verdict", { verdictIgnored: true, expected: "pass" }], ["verdict-offline", { verdictOffline: true, expected: "pass" }],
      ["snapshot-offline", { snapshotError: true, expected: "pass" }], ["database-offline", { databaseError: true, expected: "pass" }],
      ["relay-offline", { relayError: true, expected: "pass" }], ["item-event", { path: "item-detected", expected: "pass" }],
      ["fresh-for-duplicate", { expected: "pass" }], ["repeat-frame", { repeatFrame: true, verdictIgnored: true, expected: "pass" }],
      ["fresh-sequence", { expected: "pass" }],
      ["model-delay-900", { modelDelayMs: 900, expected: "pass" }], ["model-delay-1190", { modelDelayMs: 1190 }],
      ["model-delay-1250", { modelDelayMs: 1250, expected: "error" }], ["model-delay-1500", { modelDelayMs: 1500, expected: "error" }],
    ];
    for (const [id, scenario] of scenarios) await inspect(id, scenario);
    fixture.restartSession(); await inspect("new-session", { expected: "pass" });
    for (const count of [2, 5]) await inspect(`concurrent-${count}`, { expected: "reject", coverage: 0.01 }, baseCase, count);
    for (const [id, target, failure, http] of [["prompt-normalized", " scratch. ", false, 200], ["prompt-blank", " ", false, 400], ["prompt-failure", "hole", true, 502]]) {
      const context = fixture.select({ id, frame: frameFor(baseCase), promptError: failure });
      const response = await post("detection-prompt", { prompt: target });
      await fixture.waitFor(context, "completed");
      await runtime.waitExecutions(context.completions.map(c => c.executionId));
      const failures = [];
      if (response.httpStatus !== http) failures.push("Incorrect prompt update result");
      const history = context.events.filter(e => e.stage === "database-write" && e.table === "prompt_history");
      if (history.length !== (http === 400 ? 0 : 1)) failures.push("Prompt audit write missing or duplicated");
      report.cases.push({ id, status: failures.length ? "failed" : "passed", response, events: context.events, failures }); persist();
    }
    let previous;
    for (const [id, offline] of [["health-up", false], ["health-down", true], ["health-still-down", true], ["health-recovered", false]]) {
      const context = fixture.select({ id, frame: frameFor(baseCase), modelOffline: offline, captureOffline: offline });
      await post("static-health", {}); await fixture.waitFor(context, "completed", 2); await runtime.waitExecutions([...new Set(context.completions.map(c => c.executionId))]);
      const logs = context.events.filter(e => e.stage === "database-write");
      const expected = previous === offline ? 0 : 2;
      report.cases.push({ id, status: logs.length === expected ? "passed" : "failed", failures: logs.length === expected ? [] : [`Expected ${expected} transition logs, got ${logs.length}`], events: context.events }); previous = offline; persist();
    }
  }
  if (["real", "all", "diagnostic"].includes(options.mode)) {
    const health = await fetch(options["model-url"] + "/health", { signal: AbortSignal.timeout(2000) }).then(r => r.json());
    report.modelHealth = health;
    assert.equal(health.status, "ok", "Real model is not ready");
    for (const c of cases) {
      for (const kind of options["direct-variants"].split(",").filter(Boolean)) {
        if (!["original", "jpeg"].includes(kind)) throw new Error("direct-variants supports original,jpeg");
        const bytes = readFileSync(kind === "original" ? c.original : c.file);
        const form = new FormData(); form.append("file", new Blob([bytes]), kind === "original" ? "frame.png" : "frame.jpg"); form.append("prompt", buildModelInstruction(c.target));
        const start = performance.now();
        report.directModel ??= [];
        try {
          const response = await fetch(options["model-url"] + "/predict", { method: "POST", body: form, signal: AbortSignal.timeout(125000) });
          const body = await response.json();
          report.directModel.push({ caseId: c.id, kind, elapsedMs: performance.now() - start, httpStatus: response.status, body });
        } catch (error) {
          report.directModel.push({ caseId: c.id, kind, elapsedMs: performance.now() - start, body: { status: "error", reason: error.message } });
        }
        persist();
      }
    }
    const afterDirect = await fetch(options["model-url"] + "/health", { signal: AbortSignal.timeout(2000) }).then(r => r.json());
    if (afterDirect.status !== "ok") throw new Error(`Warm repetitions blocked after direct evaluation: ${afterDirect.reason}`);
    for (let repetition = 0; repetition < repetitions; repetition++) {
      for (const c of cases) await inspect(`real-${repetition + 1}-${c.id}`, { realModel: true }, c);
    }
    for (const count of [2, 5]) await inspect(`real-concurrent-${count}`, { realModel: true, checkBusy: true }, baseCase, count);
  }
} catch (error) { report.fatalError = error.message; report.blocked.push(error.message); console.error(error.message); }
finally {
  report.finishedAt = new Date().toISOString(); persist();
  await runtime?.stop(); await fixture.close();
}
report.failedCases = report.cases.filter(c => c.status === "failed").map(c => c.id);
persist();
console.log(`Evidence: ${join(output, "report.json")}`);
if (report.fatalError || report.failedCases.length || (options["credential-store"] && (!report.authentication.checkedRequests || report.authentication.invalidRequests))) process.exitCode = 1;
