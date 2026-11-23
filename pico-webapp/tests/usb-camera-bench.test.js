import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPhoneCamera } from "../tools/phone-camera.mjs";
import { selectUsbAdapter, createUsbBenchHandler } from "../tools/usb-camera-bench.mjs";

const apple = (extra = {}) => ({ name: "Ethernet 2", description: "Apple Mobile Device Ethernet", status: "Up", addresses: ["172.20.10.2"], ...extra });

test("USB selection never falls back to Wi-Fi, VPN, or a USB Wi-Fi dongle", () => {
  const others = [
    apple({ description: "MediaTek Wi-Fi", name: "Wi-Fi" }),
    apple({ description: "Radmin VPN" }),
    apple({ description: "Realtek Wireless LAN USB NIC" })
  ];
  assert.throws(() => selectUsbAdapter(others), /Apple USB/);
  assert.deepEqual(selectUsbAdapter([...others, apple()]), { ...apple(), address: "172.20.10.2" });
  assert.throws(() => selectUsbAdapter(others, "172.20.10.2"), /Apple USB/);
});

test("USB selection rejects disconnected and unassigned adapters and requires an explicit choice when ambiguous", () => {
  assert.throws(() => selectUsbAdapter([apple({ status: "Down" })]), /Apple USB/);
  for (const address of ["169.254.1.2", "127.0.0.1", "0.0.0.0", "bad-ip", "::1"]) {
    assert.throws(() => selectUsbAdapter([apple({ addresses: [address] })]), /Apple USB/);
  }
  const two = [apple(), apple({ name: "Ethernet 3", addresses: ["172.20.10.3"] })];
  assert.throws(() => selectUsbAdapter(two), /--ip/);
  assert.equal(selectUsbAdapter(two, "172.20.10.3").name, "Ethernet 3");
});

async function bench(t) {
  let time = 1800000000000;
  const camera = createPhoneCamera({ pairingCode: "bench-code", now: () => time, maxFrameBytes: 2 * 1024 * 1024 });
  const fallback = (req, res) => {
    if (camera.handle(req, res, new URL(req.url, "http://localhost").pathname)) return;
    res.writeHead(404); res.end();
  };
  const server = createServer(createUsbBenchHandler({ handler: fallback, usbAddress: "127.0.0.1", now: () => time }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { camera.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (url, options) => fetch(origin + url, options);
  const response = await call("/phone-camera/session", { method: "POST", headers: { Authorization: "Bearer bench-code" } });
  const owner = await response.json();
  const jpeg = readFileSync(new URL("../../docs/evidence/real-model-gallery-2026-10-28/images/bottle__broken_large__000.jpg", import.meta.url));
  const upload = (sequence, token = owner.token, zoomRevision = 0, body = jpeg, age = 0) => call("/phone-camera/frame", { method: "POST", body,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "X-Frame-Sequence": String(sequence), "X-Captured-At-Ms": String(time - age), "X-Camera-Zoom-Command": String(zoomRevision) } });
  return { call, upload, owner, jpeg, advance(ms) { time += ms; } };
}

test("USB diagnostics describe only accepted JPEG frames, capture bytes are preserved, and metadata expires", async t => {
  const b = await bench(t);
  assert.equal((await (await b.call("/usb-bench/status")).json()).lastFrame, null);
  await b.upload(1, "wrong-token");
  assert.equal((await (await b.call("/usb-bench/status")).json()).lastFrame, null);
  assert.equal((await b.upload(1)).status, 200);
  const status = await (await b.call("/usb-bench/status")).json();
  assert.equal(status.lastFrame.sequence, 1);
  assert.equal(status.lastFrame.localAddress, "127.0.0.1");
  assert.equal(status.lastFrame.remoteAddress, "127.0.0.1");
  assert.equal(status.lastFrame.atUsbAddress, true);
  assert.equal(status.lastFrame.fresh, true);
  assert.equal(status.lastFrame.bytes, b.jpeg.length);
  assert.ok(status.lastFrame.width > 0 && status.lastFrame.height > 0);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(b.owner.token));
  assert.deepEqual(Buffer.from(await (await b.call("/capture")).arrayBuffer()), b.jpeg);
  // A request from an unconfirmed zoom revision returns 200/accepted:false.
  // It must not masquerade as a newly accepted frame in the diagnostics.
  const refused = await (await b.upload(2, b.owner.token, 99)).json();
  assert.equal(refused.accepted, false);
  assert.equal((await (await b.call("/usb-bench/status")).json()).lastFrame.sequence, 1);
  b.advance(2001);
  assert.equal((await (await b.call("/usb-bench/status")).json()).lastFrame.fresh, false);
  assert.equal((await b.call("/capture")).status, 503);
});

test("bench diagnostics and capture retain accepted JPEGs above the old size limit and measure received FPS", async t => {
  const b = await bench(t);
  // Insert valid JPEG comment segments without modifying any image pixels.
  const comment = Buffer.alloc(60004);
  comment.set([0xff, 0xfe]);
  comment.writeUInt16BE(comment.length - 2, 2);
  const jpeg = Buffer.concat([b.jpeg.subarray(0, 2), ...Array(9).fill(comment), b.jpeg.subarray(2)]);
  assert.ok(jpeg.length > 512 * 1024);
  assert.equal(b.owner.maxFrameBytes, 2 * 1024 * 1024);
  for (let index = 1; index <= 6; index++) {
    b.advance(100);
    assert.equal((await b.upload(index, b.owner.token, 0, jpeg, 35)).status, 200);
  }
  const { lastFrame } = await (await b.call("/usb-bench/status")).json();
  assert.equal(lastFrame.bytes, jpeg.length);
  assert.ok(lastFrame.width > 0 && lastFrame.height > 0);
  assert.equal(lastFrame.fps, 10);
  assert.equal(lastFrame.arrivalAgeMs, 35);
  assert.deepEqual(Buffer.from(await (await b.call("/capture")).arrayBuffer()), jpeg);
  assert.equal((await b.upload(7, b.owner.token, 0, Buffer.alloc(b.owner.maxFrameBytes + 1))).status, 413);
});

test("ending a camera session clears transport evidence and a non-USB destination is never labelled USB", async t => {
  const b = await bench(t);
  await b.upload(1);
  const response = await b.call("/phone-camera/session", { method: "DELETE", headers: { Authorization: `Bearer ${b.owner.token}` } });
  assert.equal(response.status, 200);
  assert.equal((await (await b.call("/usb-bench/status")).json()).lastFrame, null);
  const fakeResponse = { writeHead(status) { this.statusCode = status; }, end(body) { this.body = body; } };
  const handler = createUsbBenchHandler({ usbAddress: "172.20.10.2", handler(req, res) { res.end(JSON.stringify({ accepted: true, sequence: 1 })); } });
  handler({ method: "POST", url: "/phone-camera/frame", socket: { localAddress: "172.22.7.88", remoteAddress: "172.22.7.1" }, headers: { "content-length": "123" } }, fakeResponse);
  const statusResponse = { writeHead() {}, end(body) { this.body = body; } };
  handler({ method: "GET", url: "/usb-bench/status", headers: {} }, statusResponse);
  assert.equal(fakeResponse.statusCode, 403);
  assert.equal(JSON.parse(statusResponse.body).lastFrame, null);
});

test("the actual diagnostic page script runs and accepts a newer healthy frame from the same session", async t => {
  const b = await bench(t);
  const html = await (await b.call("/usb-bench")).text();
  const script = new Script(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
  const frame = { fresh: true, atUsbAddress: true, sequence: 1, sessionId: "session-a", width: 640, height: 480, bytes: 100, localAddress: "172.20.10.2", remoteAddress: "172.20.10.1" };
  for (const sessionId of ["session-a", "session-b"]) {
    const status = {};
    await script.runInNewContext({ document: { querySelector: () => status }, setTimeout() {},
      fetch: async url => ({ ok: true, json: async () => url === "/usb-bench/status" ? { lastFrame: frame } : { camera: { sequence: 2, sessionId } } }) });
    assert.match(status.textContent, sessionId === "session-a" ? /Receiving at the Apple USB address/ : /Waiting for a fresh/);
  }
});

test("Windows preflight resolves cached PowerShell or gives setup instructions when pwsh is not on PATH", { skip: process.platform !== "win32" }, () => {
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0") };
  delete env.CN360_PWSH;
  let output;
  try {
    output = execFileSync(process.execPath, [fileURLToPath(new URL("../tools/usb-camera-bench.mjs", import.meta.url)), "--check"],
      { env, encoding: "utf8", windowsHide: true, timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    // No iPhone is needed in CI: a successful adapter inspection can correctly
    // report that none is connected. A shell launch/execution failure cannot.
    output = String(error.stderr);
    assert.match(output, /No active Apple USB network|PowerShell 7\.2\+ was not found/);
  }
  assert.match(output, /\[USB\]|No active Apple USB network|PowerShell 7\.2\+ was not found/);
  assert.doesNotMatch(output, /ENOENT|requires Windows PowerShell version/);
});
