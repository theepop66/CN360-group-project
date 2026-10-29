import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../js/phone-camera-sender.js", import.meta.url), "utf8");
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function sender({ presentFrames = true } = {}) {
  const elements = new Map();
  for (const id of ["sender-form", "start", "stop", "pairing-code", "status", "preview"]) {
    const events = new Map();
    elements.set(id, { value: "test-code", disabled: false, textContent: "", events,
      addEventListener: (name, fn) => events.set(name, fn) });
  }
  const documentEvents = new Map();
  const streamRequest = deferred();
  const video = elements.get("preview");
  let callbackId = 0;
  const callbacks = new Map();
  Object.assign(video, { play: async () => {}, videoWidth: 640, videoHeight: 480, readyState: 3,
    requestVideoFrameCallback(fn) {
      const id = ++callbackId;
      callbacks.set(id, fn);
      if (presentFrames) queueMicrotask(() => { if (callbacks.has(id)) fn(); });
      return id;
    },
    cancelVideoFrameCallback(id) { callbacks.delete(id); } });
  const requests = [];
  let stopped = 0;
  const trackEvents = new Map();
  const track = { muted: false, stop() { stopped++; }, addEventListener(name, fn) { trackEvents.set(name, fn); } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const document = { hidden: false, querySelector: selector => elements.get(selector.slice(1)),
    addEventListener: (name, fn) => documentEvents.set(name, fn),
    createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: fn => fn(new Blob(["jpeg"])) }) };
  const uploadResponse = deferred();
  runInNewContext(source, {
    document, window: { isSecureContext: true, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: () => streamRequest.promise } },
    performance: { now: () => 0 }, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("frame")) return uploadResponse.promise;
      return { ok: true, json: async () => ({ token: "session-token", serverTime: 1800000000000 }) };
    }
  });
  return { elements, document, documentEvents, requests, streamRequest, stream, uploadResponse, track, trackEvents, callbacks,
    get stopped() { return stopped; },
    start: () => elements.get("sender-form").events.get("submit")({ preventDefault() {} }),
    stop: () => elements.get("stop").events.get("click")() };
}

test("stopping while camera permission is pending releases the eventual stream", async () => {
  const s = sender();
  const started = s.start();
  s.stop();
  s.streamRequest.resolve(s.stream);
  await started;
  assert.equal(s.stopped, 1);
  assert.equal(s.requests.length, 0);
  assert.equal(s.elements.get("start").disabled, false);
});

test("backgrounding stops the camera and invalidates an in-flight upload", async () => {
  const s = sender();
  const started = s.start();
  s.streamRequest.resolve(s.stream);
  // Wait through promises until the actual upload is pending.
  for (let attempt = 0; attempt < 30 && !s.requests.some(r => r.url.endsWith("frame")); attempt++) await Promise.resolve();
  assert.equal(s.requests.filter(r => r.url.endsWith("frame")).length, 1);
  s.document.hidden = true;
  s.documentEvents.get("visibilitychange")();
  assert.equal(s.stopped, 1);
  const upload = s.requests.find(r => r.url.endsWith("frame"));
  assert.equal(upload.options.signal.aborted, true);
  s.uploadResponse.resolve({ ok: true, json: async () => ({ sequence: 1 }) });
  await started;
  assert.equal(s.requests.filter(r => r.url.endsWith("frame")).length, 1);
  assert.equal(s.requests.at(-1).options.method, "DELETE");
  assert.equal(s.elements.get("preview").srcObject, null);
});

test("a frozen video is never restamped and uploaded as a new frame", async () => {
  const s = sender({ presentFrames: false });
  const started = s.start();
  s.streamRequest.resolve(s.stream);
  for (let attempt = 0; attempt < 30 && !s.callbacks.size; attempt++) await Promise.resolve();
  assert.equal(s.callbacks.size, 1);
  assert.equal(s.requests.filter(r => r.url.endsWith("frame")).length, 0);
  s.stop();
  await started;
  assert.equal(s.callbacks.size, 0);
  assert.equal(s.stopped, 1);
});

test("a muted camera stops its session immediately", async () => {
  const s = sender({ presentFrames: false });
  const started = s.start();
  s.streamRequest.resolve(s.stream);
  for (let attempt = 0; attempt < 30 && !s.callbacks.size; attempt++) await Promise.resolve();
  s.track.muted = true;
  s.trackEvents.get("mute")();
  await started;
  assert.equal(s.stopped, 1);
  assert.equal(s.requests.filter(r => r.url.endsWith("frame")).length, 0);
  assert.equal(s.requests.at(-1).options.method, "DELETE");
});
