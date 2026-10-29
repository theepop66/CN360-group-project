import test from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { readFileSync } from "node:fs";
import { createPhoneCamera, jpegDimensions } from "../tools/phone-camera.mjs";
import { createHandler } from "../tools/hud-server.mjs";
import { cameraConfig } from "../js/camera-config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Actual small JPEG fixture, not a fake transport body.
const jpeg = readFileSync(new URL("../../docs/evidence/real-model-gallery-2026-10-28/images/bottle__broken_large__000.jpg", import.meta.url));

async function bench(t) {
  let time = 1800000000000;
  const camera = createPhoneCamera({ pairingCode: "test-pairing", now: () => time });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const server = createServer(createHandler({ root, controlUnit: "http://127.0.0.1:1", phoneCamera: camera }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { camera.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (pathname, options = {}) => fetch(base + pathname, options);
  const pair = async () => {
    const response = await call("/phone-camera/session", { method: "POST", headers: { Authorization: "Bearer test-pairing" } });
    assert.equal(response.status, 201);
    return response.json();
  };
  const upload = (owner, sequence = 1, body = jpeg, capturedAt = time, revision = 0) => call("/phone-camera/frame", {
    method: "POST", body, headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "image/jpeg", "X-Frame-Sequence": String(sequence), "X-Captured-At-Ms": String(capturedAt), "X-Camera-Zoom-Command": String(revision) }
  });
  const json = (pathname, token, body) => call(pathname, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const report = (owner, body) => json("/phone-camera/camera-state", owner.token, body);
  const zoom = (owner, action = "in", token = "test-pairing") => json("/phone-camera/zoom", token, { action, sessionId: owner.sessionId });
  return { camera, base, call, pair, upload, report, zoom, advance: ms => { time += ms; } };
}

const zoomReport = { supported: true, min: 0.5, max: 10, step: 0.1, value: 1, commandId: 0 };

test("source zoom requires camera confirmation and a new frame with the confirmed revision", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  assert.equal((await b.report(owner, zoomReport)).status, 200);
  await b.upload(owner);
  const queued = await (await b.zoom(owner)).json();
  assert.equal(queued.status, "pending");
  assert.equal(queued.value, 1);
  assert.equal((await b.call("/capture")).status, 503);
  assert.equal((await b.zoom(owner)).status, 409);
  const command = (await (await b.upload(owner, 2)).json()).zoomCommand;
  assert.deepEqual(command, { id: 1, value: 1.1 });
  assert.equal((await b.report(owner, { ...zoomReport, commandId: 1 })).status, 409);
  assert.equal((await b.report(owner, { ...zoomReport, value: 1.1 })).status, 409);
  assert.equal((await b.report(owner, { ...zoomReport, value: 1.1, commandId: 1 })).status, 200);
  assert.equal((await b.call("/capture")).status, 503);
  // An upload begun before the acknowledgement must not restore old pixels.
  assert.equal((await (await b.upload(owner, 3)).json()).accepted, false);
  assert.equal((await b.call("/capture")).status, 503);
  assert.equal((await (await b.upload(owner, 4, jpeg, owner.serverTime, 1)).json()).accepted, true);
  assert.equal((await b.call("/capture")).headers.get("x-frame-sequence"), "4");
  const actual = await (await b.call("/phone-camera/zoom")).json();
  assert.equal(actual.value, 1.1);
  assert.equal(actual.status, "ready");
});

test("camera zoom controls are authenticated, session bound, bounded and unavailable without fresh pixels", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  assert.equal((await b.zoom(owner)).status, 503);
  await b.upload(owner);
  assert.equal((await b.zoom(owner)).status, 400); // no camera capabilities yet
  assert.equal((await b.zoom(owner, "in", "wrong")).status, 401);
  assert.equal((await b.report({ token: "test-pairing" }, zoomReport)).status, 401);
  assert.equal((await b.zoom({ sessionId: "previous-phone" })).status, 409);
  const oversized = await b.call("/phone-camera/camera-state", { method: "POST", headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" }, body: " ".repeat(2049) });
  assert.equal(oversized.status, 413);
  assert.equal((await b.report(owner, { ...zoomReport, max: Infinity })).status, 400);
  await b.report(owner, { ...zoomReport, value: 10 });
  assert.equal((await (await b.zoom(owner)).json()).status, "ready"); // bound is a no-op
  assert.equal((await b.call("/capture")).status, 200);
  b.advance(10001);
  const replacement = await b.pair();
  assert.equal((await b.report(owner, zoomReport)).status, 401);
  await b.report(replacement, zoomReport);
  await b.upload(replacement);
  assert.equal((await b.zoom(owner)).status, 409);
  assert.equal((await (await b.call("/phone-camera/zoom")).json()).commandId, 0);
});

test("camera apply failure reports actual settings and resumes only under its acknowledged revision", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  await b.report(owner, zoomReport);
  await b.upload(owner);
  await b.zoom(owner);
  const response = await b.report(owner, { ...zoomReport, commandId: 1, error: "constraint rejected" });
  const state = await response.json();
  assert.equal(state.status, "error");
  assert.equal(state.value, 1);
  assert.equal((await b.call("/capture")).status, 503);
  await b.upload(owner, 2, jpeg, owner.serverTime, 1);
  assert.equal((await b.call("/capture")).status, 200);
  assert.equal((await b.zoom(owner)).status, 200);
});

test("phone capture preserves JPEG bytes and the five n8n identity headers", async t => {
  const b = await bench(t);
  assert.equal((await b.call("/capture")).status, 503);
  const owner = await b.pair();
  assert.equal((await b.upload(owner)).status, 200);
  const capture = await b.call("/capture");
  assert.equal(capture.status, 200);
  assert.deepEqual(Buffer.from(await capture.arrayBuffer()), jpeg);
  const dimensions = jpegDimensions(jpeg);
  assert.equal(capture.headers.get("x-camera-session"), owner.sessionId);
  assert.equal(capture.headers.get("x-frame-sequence"), "1");
  assert.equal(capture.headers.get("x-captured-at"), new Date(owner.serverTime).toISOString());
  assert.equal(capture.headers.get("x-frame-width"), String(dimensions.width));
  assert.equal(capture.headers.get("x-frame-height"), String(dimensions.height));
  assert.equal((await b.call("/health")).status, 200);
  assert.equal(capture.headers.get("cache-control"), "no-store");
});

test("pairing owns one sender, restarted sessions reject the old publisher", async t => {
  const b = await bench(t);
  assert.equal((await b.call("/phone-camera/session", { method: "POST" })).status, 401);
  const first = await b.pair();
  assert.equal((await b.call("/phone-camera/session", { method: "POST", headers: { Authorization: "Bearer test-pairing" } })).status, 409);
  await b.upload(first);
  b.advance(10001);
  const second = await b.pair();
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal((await b.upload(first, 2)).status, 401);
  assert.equal((await b.call("/capture")).status, 503);
  assert.equal((await b.upload(second)).status, 200);
  assert.equal((await b.call("/phone-camera/session", { method: "DELETE", headers: { Authorization: `Bearer ${first.token}` } })).status, 401);
  assert.equal((await b.call("/phone-camera/session", { method: "DELETE", headers: { Authorization: `Bearer ${second.token}` } })).status, 200);
  assert.equal((await b.call("/capture")).status, 503);
});

test("stale and reordered uploads never replace a newer frame; fresh capture recovers", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  await b.upload(owner, 2);
  assert.equal((await b.upload(owner, 1)).status, 409);
  assert.equal((await b.upload(owner, 2)).status, 409);
  b.advance(2001);
  for (const url of ["/capture", "/health", "/phone-camera/stream.mjpg"]) assert.equal((await b.call(url)).status, 503);
  assert.equal((await b.upload(owner, 3, jpeg, owner.serverTime)).status, 409);
  assert.equal((await b.upload(owner, 3)).status, 200);
  assert.equal((await b.call("/capture")).headers.get("x-frame-sequence"), "3");
});

test("rejects malformed, oversized, future-dated and unauthenticated uploads", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  assert.equal((await b.upload({ token: "wrong" })).status, 401);
  assert.equal((await b.upload(owner, 1, Buffer.from("not an image"))).status, 422);
  assert.equal((await b.upload(owner, 1, Buffer.alloc(512 * 1024 + 1))).status, 413);
  assert.equal((await b.upload(owner, 1, jpeg, owner.serverTime + 1000)).status, 409);
  assert.equal((await b.upload(owner, 0)).status, 409);
  assert.equal((await b.upload(owner)).status, 200);
  assert.equal(jpegDimensions(Buffer.from([255, 216, 255, 255, 255, 217])), null);
});

test("MJPEG streams the captured bytes and stops rather than replaying stale images", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  await b.upload(owner);
  const stream = await new Promise((resolve, reject) => {
    const req = get(b.base + "/phone-camera/stream.mjpg", resolve);
    req.on("error", reject);
  });
  assert.match(stream.headers["content-type"], /multipart\/x-mixed-replace/);
  const first = await new Promise(resolve => stream.once("data", resolve));
  assert.ok(first.includes(jpeg));
  assert.match(first.toString("latin1"), new RegExp(`X-Camera-Session: ${owner.sessionId}`));
  const ended = new Promise(resolve => stream.once("end", resolve));
  stream.resume(); b.advance(2001);
  await ended;
  assert.equal((await b.call("/capture")).status, 503);
});

test("phone viewer shortcut uses HTTPS same-origin and leaves ordinary defaults intact", () => {
  const saved = { cameraSource: "local", streamUrl: "http://old-camera/", healthUrl: "http://old-camera/health" };
  assert.deepEqual(cameraConfig(saved, {}, new URL("https://pc:8443/?camera=phone")), {
    cameraSource: "remote", streamUrl: "https://pc:8443/phone-camera/stream.mjpg", healthUrl: "https://pc:8443/phone-camera/health"
  });
  assert.deepEqual(cameraConfig(saved, {}, new URL("https://pc:8443/")), saved);
});

test("phone sender page is served without leaking a pairing code", async t => {
  const b = await bench(t);
  const response = await b.call("/phone-camera.html");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /playsinline/);
  assert.doesNotMatch(html, /test-pairing/);
});

test("caps MJPEG viewers and releases capacity when a viewer disconnects", async t => {
  const b = await bench(t);
  const owner = await b.pair();
  await b.upload(owner);
  const streams = [];
  for (let index = 0; index < 8; index++) {
    streams.push(await new Promise((resolve, reject) => {
      const req = get(b.base + "/phone-camera/stream.mjpg", resolve);
      req.on("error", reject);
    }));
  }
  assert.equal((await b.call("/phone-camera/stream.mjpg")).status, 503);
  streams[0].destroy();
  // Observe disconnect processing by the server, without a fixed sleep.
  let replacement;
  for (let attempt = 0; attempt < 10; attempt++) {
    replacement = await b.call("/phone-camera/stream.mjpg");
    if (replacement.status === 200) break;
    await replacement.arrayBuffer();
  }
  assert.equal(replacement.status, 200);
  await replacement.body.cancel();
  streams.forEach(stream => stream.destroy());
});
