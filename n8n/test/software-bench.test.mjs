import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startSoftwareBench } from "../lib/software-bench.mjs";

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
