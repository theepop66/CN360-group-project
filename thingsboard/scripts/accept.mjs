import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { ThingsBoardApi } from "../lib/api.mjs";
import { command, startTestN8n } from "../../n8n/lib/inspection-test-runtime.mjs";
import { startInspectionFixture } from "../../n8n/lib/static-inspection.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const folder = join(root, "thingsboard");
const accounts = JSON.parse(readFileSync(join(folder, "accounts.local.json"), "utf8"));
const api = await new ThingsBoardApi(accounts.origin).login(accounts.admin.username, accounts.admin.password);
const viewer = await new ThingsBoardApi(accounts.origin).login(accounts.viewer.username, accounts.viewer.password);
const runId = randomUUID();
const output = join(folder, ".runtime/acceptance", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const settingsPath = join(root, "n8n/software-bench.local.json");
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
const python = process.env.CN360_TEST_PYTHON ?? settings.python;
if (!python) throw new Error("Set CN360_TEST_PYTHON to a Python executable with Pillow");
await command(python, [join(root, "n8n/scripts/prepare-inspection-images.py"), "--assets", join(root, "test-assets/product-defects"), "--output", output]);
const photo = JSON.parse(readFileSync(join(output, "cases.json"), "utf8")).find(item => item.id.startsWith("bottle__good"));
const frame = { bytes: readFileSync(photo.file), width: photo.width, height: photo.height, mimeType: "image/jpeg" };
const latest = async () => {
  const result = await api.request(`/api/plugins/telemetry/DEVICE/${accounts.deviceId}/values/timeseries`);
  return Object.fromEntries(Object.entries(result).map(([name, points]) => [name, points[0]?.value]));
};
async function waitFor(check, timeout = 15000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { try { const result = await check(); if (result) return result; } catch {} await delay(100); }
  throw new Error("Timed out waiting for verified monitoring state");
}
const report = { runId, scope: "Real ThingsBoard, real n8n and durable local bridge; saved image, controlled model, recording camera/controller/Supabase/relay boundaries. No physical sorting or model accuracy acceptance.",
  scenarios: [], checks: [] };
const persist = () => writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
persist();
const fixture = await startInspectionFixture({ port: 8112 });
let runtime; let thingsboardStopped = false;
const compose = ["compose", "-f", join(folder, "compose.yaml"), "--env-file", join(folder, ".env")];
async function inspect(name, options = {}, { expectLive = true } = {}) {
  const context = fixture.select({ id: runId + "-" + name, target: "scratch", frame, ...options });
  const started = performance.now();
  const startedAt = Date.now();
  const response = await fetch(runtime.origin + "/webhook/inspect-now", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ testCaseId: context.id, inspectionTarget: "scratch" }), signal: AbortSignal.timeout(6000) });
  const body = await response.json();
  const responseMs = performance.now() - started;
  await fixture.waitFor(context, "completed", 1, 20000);
  const executionId = context.completions[0].executionId;
  const matchesEvent = value => {
    try { const parts = JSON.parse(value); return parts[0] === "observation" && parts[1] === "cn360StaticTest" && parts[2] === String(executionId) && Date.parse(parts[3]) >= startedAt; }
    catch { return false; }
  };
  const row = { name, response: body, responseMs, executionId };
  Object.defineProperty(row, "matchesEvent", { value: matchesEvent });
  const execution = await runtime.waitExecutions([executionId]);
  assert.equal(execution[0].status, "success");
  if (expectLive) {
    row.telemetry = await waitFor(async () => { const values = await latest(); return matchesEvent(values.event_id) ? values : null; });
    row.eventId = row.telemetry.event_id;
    row.visibleAfterMs = performance.now() - started;
    assert.ok(row.visibleAfterMs < 5000, `${name} exceeded 5-second visibility`);
    assert.equal(row.telemetry.verdict, context.completions[0].decision.verdict);
    assert.ok(Number.isFinite(Number(row.telemetry.processing_ms)));
  }
  report.scenarios.push(row);
  persist();
  console.log(`Verified ${name}: ${body.result}; response ${responseMs.toFixed(0)} ms${row.visibleAfterMs ? "; visible " + row.visibleAfterMs.toFixed(0) + " ms" : "; monitoring queued"}`);
  return row;
}
try {
  const initial = await latest();
  report.initialCount = Number(initial.inspection_count ?? 0);
  runtime = await startTestN8n({ output, fixturePort: 8112, port: 5684,
    runtimeConfig: { telemetryBaseUrl: "http://host.docker.internal:8106", monitoringProfile: "software-controlled-acceptance" } });
  const pass = await inspect("pass", { boxes: [] });
  assert.equal(pass.telemetry.verdict, "pass"); assert.equal(Number(pass.telemetry.defect_coverage), 0);
  const reject = await inspect("reject", { boxes: [[0, 0, photo.width / 2, photo.height / 2]] });
  assert.equal(reject.telemetry.verdict, "reject"); assert.equal(Number(reject.telemetry.defect_coverage), 0.25);
  const failure = await inspect("model-error", { modelError: true });
  assert.equal(failure.telemetry.verdict, "reject"); assert.equal(String(failure.telemetry.inspection_failed), "true");
  assert.equal(failure.telemetry.defect_coverage_display, "Unavailable");
  assert.match(failure.telemetry.failure_reason, /model_/);
  const timeout = await inspect("model-timeout", { modelDelayMs: 1500 });
  assert.match(timeout.telemetry.failure_reason, /model_timeout/);
  const alarms = await waitFor(async () => {
    const result = await viewer.request(`/api/alarm/DEVICE/${accounts.deviceId}?pageSize=100&page=0&searchStatus=ANY`);
    return result.data?.find(alarm => alarm.type === "Inspection failure" && !alarm.cleared);
  });
  await viewer.request(`/api/alarm/${alarms.id.id}/ack`, { method: "POST", body: {} });
  report.checks.push("Operator can view and acknowledge the real inspection failure alarm");
  const dashboard = await viewer.request(`/api/dashboard/${accounts.dashboardId}`);
  assert.equal(Object.values(dashboard.configuration.widgets).some(widget => /rpc|control/i.test(widget.typeFullFqn ?? "")), false);
  report.checks.push("Assigned operator can open the dashboard; no machine control widgets");
  await command("docker", [...compose, "stop", "thingsboard"]); thingsboardStopped = true;
  const during = await inspect("thingsboard-outage", { boxes: [] }, { expectLive: false });
  const health = await (await fetch("http://127.0.0.1:8106/health")).json();
  assert.ok(health.pending >= 1); assert.equal(during.response.result, "pass");
  report.checks.push("Inspection completed with ThingsBoard stopped; event retained locally");
  await command("docker", [...compose, "up", "-d", "thingsboard"]); thingsboardStopped = false;
  await waitFor(async () => { const values = await latest(); return during.matchesEvent(values.event_id) ? values : null; }, 180000);
  await waitFor(async () => (await (await fetch("http://127.0.0.1:8106/health")).json()).pending === 0);
  const recovered = await latest();
  assert.equal(Number(recovered.inspection_count), report.initialCount + report.scenarios.length);
  report.checks.push("Queued event replayed after real ThingsBoard restart; absolute counts remain correct");
  const final = await inspect("recovered-reject", { boxes: [[0, 0, photo.width / 2, photo.height / 2]] });
  assert.equal(Number(final.telemetry.inspection_count), report.initialCount + report.scenarios.length);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack;
  throw error;
} finally {
  if (thingsboardStopped) await command("docker", [...compose, "up", "-d", "thingsboard"]).catch(() => {});
  await runtime?.stop(); await fixture.close();
  persist();
  console.log("Acceptance report: " + join(output, "report.json"));
}
console.log("ThingsBoard software integration acceptance passed.");
