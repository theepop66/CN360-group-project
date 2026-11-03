import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { disableCloudAuditForDemo, startSoftwareBench } from "../lib/software-bench.mjs";
import { configureWorkflows } from "../configure.mjs";

const bytes = readFileSync(new URL("../../test-assets/product-defects/bottle__good__000.png", import.meta.url));
const picture = { bytes, width: 900, height: 900 };
const hudDirectory = fileURLToPath(new URL("../../pico-webapp", import.meta.url));
function transport() {
  return { reset: async () => ({ admission_ready: true }), step: async () => ({ admission_ready: true }),
    verdict: async body => ({ httpStatus: 200, body }), close: async () => {} };
}

test("software capture preserves picture bytes and advances frame identity", async t => {
  const bench = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0 });
  t.after(() => bench.close());
  const first = await fetch(bench.origin + "/capture");
  assert.equal(first.headers.get("x-frame-width"), "900");
  assert.equal(first.headers.get("x-frame-height"), "900");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), bytes);
  const second = await fetch(bench.origin + "/capture");
  assert.equal(second.headers.get("x-camera-session"), first.headers.get("x-camera-session"));
  assert.notEqual(second.headers.get("x-frame-sequence"), first.headers.get("x-frame-sequence"));
});

test("bench serves the real HUD with resolved endpoints and a software-only label", async t => {
  const bench = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0 });
  t.after(() => bench.close());
  const page = await (await fetch(bench.origin + "/hud/")).text();
  assert.match(page, /No physical hardware/);
  const config = await (await fetch(bench.origin + "/hud/config.js")).text();
  assert.ok(config.includes(bench.origin + "/frame.jpg"));
  assert.ok(config.includes('"cameraSource":"remote"'));
  assert.equal((await fetch(bench.origin + "/hud/..%2f..%2fCONTEXT.md")).status, 403);
});

test("offline demonstration explicitly labels missing cloud audit delivery on the test page and HUD", async t => {
  const bench = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0, offlineAudit: true });
  t.after(() => bench.close());
  const page = await (await fetch(bench.origin + "/")).text();
  const hud = await (await fetch(bench.origin + "/hud/")).text();
  assert.match(page, /cloud audit calls are disabled/);
  assert.match(page, /does not verify Supabase delivery/);
  assert.match(hud, /cloud audit disabled/);
});

test("offline workflow suppresses cloud calls and cannot report a skipped snapshot as uploaded", () => {
  const workflows = configureWorkflows({ modelBaseUrl: "http://model", piBaseUrl: "http://capture", esp32BaseUrl: "http://controller", relayBaseUrl: "http://relay",
    supabaseBaseUrl: "http://offline.invalid", supabaseCredentialId: "unused", snapshotBucket: "offline", modelTimeoutMs: 1200, coverageThreshold: 0.005 });
  for (const workflow of Object.values(workflows)) {
    disableCloudAuditForDemo(workflow, "http://offline.invalid");
    assert.ok(workflow.nodes.every(node => node.disabled || !node.parameters.url?.includes("offline.invalid")));
  }
  const inspection = Object.values(workflows)[0];
  const upload = inspection.nodes.find(node => node.name === "upload-snapshot");
  const result = new Function(upload.parameters.jsCode)()[0].json;
  const snapshot = inspection.nodes.find(node => node.name === "build-snapshot-url");
  const nodes = { "capture-esp32-response": {}, "upload-snapshot": result, "read-frame-context": { snapshotObjectName: "test.jpg" } };
  const built = new Function("$", snapshot.parameters.jsCode)(name => ({ isExecuted: true, first: () => ({ json: nodes[name] }) }));
  assert.equal(built[0].json.snapshotStored, false);
  assert.equal(built[0].json.frameUrl, null);
});

test("prompt transport preserves n8n errors without reporting a successful change", async t => {
  let request;
  const bench = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0,
    fetchImpl: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return Response.json({ status: "error" }, { status: 502 }); } });
  t.after(() => bench.close());
  const response = await fetch(bench.origin + "/prompt", { method: "POST", body: JSON.stringify({ prompt: "scratch" }) });
  assert.equal(response.status, 502);
  assert.deepEqual(request.body, { prompt: "scratch" });
  assert.ok(request.url.endsWith("/webhook/detection-prompt"));
});

test("controlled responses are explicit and cannot be selected in the native profile", async t => {
  let selected;
  const bench = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0,
    configureModel: value => { selected = value; } });
  t.after(() => bench.close());
  const request = scenario => fetch(bench.origin + "/bench/model", { method: "POST", body: JSON.stringify({ scenario }) });
  assert.equal((await request("not-a-scenario")).status, 400);
  const response = await request("reject");
  assert.equal(response.status, 200); assert.equal((await response.json()).synthetic, true); assert.equal(selected, "reject");
  const native = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0, modelProfile: "native" });
  t.after(() => native.close());
  assert.equal((await fetch(native.origin + "/bench/model", { method: "POST", body: JSON.stringify({ scenario: "pass" }) })).status, 409);
});

test("selecting a labelled picture commits its target before replacing the capture", async t => {
  const selectedBytes = Buffer.from("selected-picture");
  let prompt;
  const bench = await startSoftwareBench({ controller: transport(), picture: { ...picture, id: "initial" }, hudDirectory, port: 0, modelProfile: "native",
    pictures: [{ id: "labelled-case", bytes: selectedBytes, width: 448, height: 224, target: "crack", hasDefect: true }],
    fetchImpl: async (_url, options) => { prompt = JSON.parse(options.body).prompt; return Response.json({ status: "updated" }); } });
  t.after(() => bench.close());
  const cases = await (await fetch(bench.origin + "/bench/pictures")).json();
  assert.equal(cases.pictures[0].id, "labelled-case");
  assert.equal(JSON.stringify(cases).includes("bytes"), false);
  const response = await fetch(bench.origin + "/bench/picture", { method: "POST", body: JSON.stringify({ id: "labelled-case" }) });
  assert.equal(response.status, 200);
  assert.equal(prompt, "crack");
  const capture = await fetch(bench.origin + "/capture");
  assert.equal(capture.headers.get("x-frame-width"), "448");
  assert.equal(capture.headers.get("x-frame-height"), "224");
  assert.deepEqual(Buffer.from(await capture.arrayBuffer()), selectedBytes);
  assert.equal((await fetch(bench.origin + "/bench/picture", { method: "POST", body: JSON.stringify({ id: "../private" }) })).status, 404);
});

test("failed target update retains the original picture and native readiness is truthful", async t => {
  const bench = await startSoftwareBench({ controller: transport(), picture, hudDirectory, port: 0, modelProfile: "native",
    pictures: [{ id: "other", bytes: Buffer.from("other"), width: 1, height: 1, target: "hole" }],
    fetchImpl: async () => Response.json({ status: "error", reason: "model_warming" }, { status: 503 }) });
  t.after(() => bench.close());
  const selected = await fetch(bench.origin + "/bench/picture", { method: "POST", body: JSON.stringify({ id: "other" }) });
  assert.equal(selected.status, 503);
  assert.deepEqual(Buffer.from(await (await fetch(bench.origin + "/capture")).arrayBuffer()), bytes);
  const health = await fetch(bench.origin + "/model/health");
  assert.equal(health.status, 503);
  assert.equal((await health.json()).reason, "model_warming");
});
