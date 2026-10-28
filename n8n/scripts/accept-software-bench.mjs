import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { command, startTestN8n } from "../lib/inspection-test-runtime.mjs";
import { startInspectionFixture } from "../lib/static-inspection.mjs";
import { parseDetectionPayload } from "../../pico-webapp/js/overlay.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "n8n/.runtime/issue17-acceptance", String(Date.now())); mkdirSync(output, { recursive: true });
const settings = JSON.parse(readFileSync(join(root, "n8n/software-bench.local.json"), "utf8"));
const config = JSON.parse(readFileSync(join(root, "n8n/runtime.local.json"), "utf8"));
const running = JSON.parse(readFileSync(join(root, "n8n/.runtime/software-bench/running.json"), "utf8"));
assert.equal(running.modelProfile, "controlled", "Acceptance uses explicitly controlled model responses");
const key = readFileSync(settings.keyFile, "utf8").match(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
assert.equal(key?.length, 1);
const token = key[0];
const clean = text => String(text).replaceAll(token, "[redacted]");
const bench = "http://127.0.0.1:8104"; const n8n = "http://127.0.0.1:5680";
const workflow = "rBfAR3HgczhHFlui";
const runId = "issue17-" + Date.now();
const target = runId + " scratch";
const report = { runId, startedAt: new Date().toISOString(),
  scope: "Deployed n8n, real C++ controller core on PC, actual Supabase DB/Storage, real relay/WebSocket and HUD parser. Static test picture and controlled model responses; no hardware or AI-quality acceptance.", cases: [] };
const persist = () => writeFileSync(join(output, "report.json"), clean(JSON.stringify(report, null, 2)) + "\n");
async function jsonRequest(url, body) {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.json() };
}
async function db(table, params = {}) {
  const response = await fetch(config.supabaseBaseUrl + "/rest/v1/" + table + "?" + new URLSearchParams({ select: "*", ...params }), {
    headers: { apikey: token, Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Database read failed: ${response.status}`); return response.json();
}
async function until(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(200); }
  throw new Error("Acceptance observation timed out");
}
async function sql(statement) {
  const source = `const d=new(require('node:sqlite').DatabaseSync)('/home/node/.n8n/database.sqlite',{readOnly:true});console.log(JSON.stringify(d.prepare(${JSON.stringify(statement)}).all()));`;
  return JSON.parse(await command("docker", ["exec", "cn360-software-n8n", "node", "--disable-warning=ExperimentalWarning", "-e", source]));
}
const latestExecution = async () => Number((await sql("SELECT COALESCE(MAX(id),0) AS id FROM execution_entity"))[0].id);
async function finished(after, count = 1, id = workflow, timeout = 20000) {
  return until(async () => { const rows = await sql(`SELECT id,status FROM execution_entity WHERE id>${Number(after)} AND workflowId='${id}'`);
    if (rows.length >= count && rows.every(r => r.status !== "running" && r.status !== "new")) {
      assert(rows.every(r => r.status === "success"), "A deployed n8n execution failed"); return rows;
    } return null; }, timeout);
}
const state = async () => (await jsonRequest(bench + "/status")).body;
const ready = () => until(async () => { const s = await state(); return s.admission_ready ? s : null; }, 10000);
async function scenario(value) { assert.equal((await jsonRequest(bench + "/bench/model", { scenario: value })).status, 200); }
const messages = [];
async function connect() {
  const socket = new WebSocket("ws://127.0.0.1:8081/detections");
  socket.addEventListener("message", event => { messages.push(JSON.parse(event.data)); });
  await new Promise((accept, reject) => { socket.addEventListener("open", accept, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  return socket;
}
await until(async () => { try { return (await fetch(n8n + "/healthz/readiness", { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 60000);
await until(async () => {
  const log = await command("docker", ["logs", running.container]);
  return ["Inspection Loop", "Prompt Capture", "Health Watchdog"].every(name => log.includes(`Activated workflow "CN360 - ${name}"`));
}, 60000);
let socket = await connect();
const picture = (JSON.parse(readFileSync(join(root, "n8n/.runtime/software-bench/cases.json"), "utf8"))).find(c => c.id === "bottle__good__000-1");
const expectedHash = createHash("sha256").update(readFileSync(picture.file)).digest("hex");
async function test(id, action) {
  const row = { id, failures: [] }; report.cases.push(row);
  try { await action(row); row.status = "passed"; }
  catch (error) { row.failures.push(clean(error.message)); row.status = "failed"; }
  persist(); console.log(id + ": " + row.status);
}
async function checkRecord(row, item, expectedAttempts = 1) {
  const inspections = await db("inspection_results", { controller_session: "eq." + item.controller_session, item_id: "eq." + item.item_id });
  assert.equal(inspections.length, 1, "Physical item audit was not idempotent");
  const inspection = inspections[0]; row.inspection = inspection;
  const controls = await db("control_actions", { inspection_id: "eq." + inspection.id });
  assert.equal(controls.length, expectedAttempts); row.control = controls[0]; row.controls = controls;
  assert.equal(controls[0].ack_controller_session, item.controller_session);
  assert.equal(controls[0].ack_item_id, item.item_id);
  assert(inspection.frame_url?.startsWith(config.supabaseBaseUrl + "/storage/v1/object/public/" + config.snapshotBucket + "/"));
  const image = await fetch(inspection.frame_url); assert(image.ok);
  assert.equal(createHash("sha256").update(Buffer.from(await image.arrayBuffer())).digest("hex"), expectedHash);
  const payload = await until(() => messages.find(m => m.type === "detections" && m.frame?.sessionId === inspection.camera_session && m.frame?.sequence === inspection.frame_sequence));
  const parsed = parseDetectionPayload(payload); assert(parsed);
  assert.equal(payload.snapshotUrl, inspection.frame_url);
  assert.equal(parsed.source.width, inspection.frame_width); assert.equal(parsed.source.height, inspection.frame_height);
  row.relayPayload = payload; row.snapshotSha256 = expectedHash;
  return inspection;
}
await test("prompt-normalization-and-history", async row => {
  const response = await jsonRequest(bench + "/prompt", { prompt: "  " + target + ".  " });
  assert.equal(response.status, 200); assert.equal(response.body.status, "updated");
  const history = await until(async () => { const rows = await db("prompt_history", { model_instruction: "eq." + `Locate all the instances that matches the following description: ${target}.` }); return rows.length ? rows : null; });
  assert.equal(history.length, 1); assert.equal(history[0].model_instruction, `Locate all the instances that matches the following description: ${target}.`);
  row.history = history[0];
  assert.equal((await jsonRequest(bench + "/prompt", { prompt: " " })).status, 400);
});
for (const [name, expected] of [["pass", "pass"], ["reject", "reject"], ["error", "error"], ["timeout", "error"]]) {
  await test("item-" + name, async row => {
    const before = await ready(); await scenario(name); const execution = await latestExecution();
    const response = await jsonRequest(bench + "/bench/item", {}); assert.equal(response.status, 200);
    row.response = response.body; assert.equal(response.body.inspection.result, expected);
    assert.equal(response.body.inspection.control.controlOutcome, "accepted");
    row.executions = await finished(execution);
    const inspection = await checkRecord(row, response.body.item);
    assert.equal(inspection.verdict, expected === "error" ? "reject" : expected);
    const after = await state(); row.controllerBefore = before; row.controllerAfter = after;
    assert.equal(after.pass_count - before.pass_count, expected === "pass" ? 1 : 0);
    assert.equal(after.reject_count - before.reject_count, expected === "pass" ? 0 : 1);
    if (name === "reject") assert.deepEqual(row.relayPayload.detections[0].box, [180, 180, 450, 450]);
  });
}
await test("duplicate-five-events-one-controller-resolution", async row => {
  const before = await ready(); await scenario("reject"); const execution = await latestExecution();
  const admitted = await jsonRequest(bench + "/bench/admit", {}); assert.equal(admitted.status, 201); const item = admitted.body.item;
  const replies = await Promise.all(Array.from({ length: 5 }, () => jsonRequest(n8n + "/webhook/item-detected", item)));
  assert(replies.every(r => r.status === 200));
  assert.equal(replies.filter(r => r.body.control.controlOutcome === "accepted").length, 1);
  assert.equal(replies.filter(r => r.body.control.controlOutcome === "ignored").length, 4);
  row.responses = replies; row.executions = await finished(execution, 5);
  await checkRecord(row, item, 5); const after = await state();
  assert.equal(after.reject_count - before.reject_count, 1); assert.equal(after.pass_count, before.pass_count);
  row.controllerBefore = before; row.controllerAfter = after;
});
await test("manual-observation-does-not-actuate", async row => {
  const before = await ready(); await scenario("pass"); const execution = await latestExecution();
  const result = await jsonRequest(n8n + "/webhook/inspect-now", {});
  assert.equal(result.body.control.controlOutcome, "not_requested"); row.response = result;
  row.executions = await finished(execution); const after = await state();
  assert.equal(after.pass_count, before.pass_count); assert.equal(after.reject_count, before.reject_count);
});
await test("relay-heartbeat-and-reconnect", async row => {
  await until(() => messages.some(m => m.type === "heartbeat"), 4000);
  socket.close(); const count = messages.length; socket = await connect();
  await delay(1300); assert(messages.slice(count).some(m => m.type === "connected"));
  assert.equal(messages.slice(count).filter(m => m.type === "detections").length, 0, "Reconnect replayed stale frames");
  row.messages = messages.slice(count);
});
await test("watchdog-outage-dedup-and-recovery", async row => {
  const baseline = (await db("system_logs", { component: "eq.model-server", order: "id.desc", limit: "1" }))[0]?.id ?? 0;
  await scenario("offline");
  const down = await until(async () => { const rows = await db("system_logs", { component: "eq.model-server", id: "gt." + baseline, severity: "eq.error" }); return rows[0]; }, 75000);
  const offlineExecution = await latestExecution();
  row.secondOfflinePoll = await finished(offlineExecution, 1, "i01sMLn8WgW6EtZq", (settings.healthIntervalSeconds ?? 15) * 1000 + 20000);
  const repeated = await db("system_logs", { component: "eq.model-server", id: "gt." + baseline, severity: "eq.error" }); assert.equal(repeated.length, 1);
  await scenario("reject");
  const recovered = await until(async () => { const rows = await db("system_logs", { component: "eq.model-server", id: "gt." + down.id, severity: "eq.info" }); return rows[0]; }, 75000);
  row.down = down; row.recovered = recovered;
});
await test("actual-scheduled-observation", async row => {
  const before = await ready();
  const frame = { bytes: readFileSync(picture.file), width: picture.width, height: picture.height, mimeType: "image/jpeg" };
  const fixture = await startInspectionFixture({ port: 8106 });
  const context = fixture.select({ id: "ambient", frame, target, coverage: 0.01 });
  const privateFolder = join(homedir(), "AppData/Local/CN360");
  const credentialFile = join(privateFolder, "ambient-credential.json");
  writeFileSync(credentialFile, JSON.stringify([{ id: "cn360AmbientSb", name: "CN360 Supabase", type: "supabaseApi", data: { host: config.supabaseBaseUrl, serviceRole: token } }]));
  let runtime;
  try {
    runtime = await startTestN8n({ output: join(output, "ambient"), fixturePort: 8106, port: 5684,
      supabaseCredentialId: "cn360AmbientSb", credentialFile, ambient: true,
      runtimeConfig: { ...config, modelBaseUrl: "http://host.docker.internal:8106" } });
    writeFileSync(credentialFile, "[]");
    await fixture.waitFor(context, "completed", 1, 20000);
    row.executions = await runtime.waitExecutions([context.completions[0].executionId]);
    assert(row.executions.every(e => e.status === "success"));
    assert.equal(context.completions[0].control.controlOutcome, "not_requested");
    const after = await state(); assert.equal(after.pass_count, before.pass_count); assert.equal(after.reject_count, before.reject_count);
    row.completion = context.completions[0];
  } finally { writeFileSync(credentialFile, "[]"); await runtime?.stop(); await fixture.close(); }
});
await scenario("reject"); socket.close();
report.finishedAt = new Date().toISOString(); report.failedCases = report.cases.filter(c => c.status !== "passed").map(c => c.id); persist();
console.log("Evidence: " + join(output, "report.json"));
if (report.failedCases.length) process.exitCode = 1;
