import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { readCameraZoom, applyCameraZoom } from "../js/camera-zoom.js";

const source = readFileSync(new URL("../js/phone-camera-sender.js", import.meta.url), "utf8").replace(/^import[^\n]+\n/, "");
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function sender({ presentFrames = true, supportZoom = false } = {}) {
  const elements = new Map();
  for (const id of ["sender-form", "start", "stop", "pairing-code", "status", "preview", "camera-zoom-status"]) {
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
  let cameraZoom = 1;
  const applied = [];
  const track = { muted: false, stop() { stopped++; }, addEventListener(name, fn) { trackEvents.set(name, fn); },
    getCapabilities: () => supportZoom ? { zoom: { min: 1, max: 10, step: 0.1 } } : {},
    getSettings: () => ({ zoom: cameraZoom }),
    applyConstraints: async constraints => { applied.push(constraints); cameraZoom = constraints.advanced[0].zoom; } };
  const drawnZooms = [];
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const document = { hidden: false, querySelector: selector => elements.get(selector.slice(1)),
    addEventListener: (name, fn) => documentEvents.set(name, fn),
    createElement: () => ({ getContext: () => ({ drawImage() { drawnZooms.push(cameraZoom); } }), toBlob: fn => fn(new Blob(["jpeg"])) }) };
  const uploadResponse = deferred();
  const laterUploadResponse = deferred();
  runInNewContext(source, {
    document, window: { isSecureContext: true, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: () => streamRequest.promise } },
    performance: { now: () => 0 }, AbortController, setTimeout, clearTimeout, readCameraZoom, applyCameraZoom,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("frame")) return requests.filter(r => r.url.endsWith("frame")).length === 1 ? uploadResponse.promise : laterUploadResponse.promise;
      return { ok: true, json: async () => ({ token: "session-token", serverTime: 1800000000000 }) };
    }
  });
  return { elements, document, documentEvents, requests, streamRequest, stream, uploadResponse, laterUploadResponse, track, trackEvents, callbacks, applied, drawnZooms,
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

test("receiver command changes the phone track before a newly captured upload is marked confirmed", async () => {
  const s = sender({ supportZoom: true });
  const started = s.start();
  s.streamRequest.resolve(s.stream);
  for (let attempt = 0; attempt < 50 && !s.requests.some(r => r.url.endsWith("frame")); attempt++) await Promise.resolve();
  assert.equal(s.drawnZooms[0], 1);
  s.uploadResponse.resolve({ ok: true, json: async () => ({ sequence: 1, accepted: false, zoomCommand: { id: 1, value: 2 } }) });
  for (let attempt = 0; attempt < 50 && s.requests.filter(r => r.url.endsWith("camera-state")).length < 2; attempt++) await Promise.resolve();
  assert.equal(s.applied.length, 1);
  assert.equal(s.applied[0].advanced[0].zoom, 2);
  const confirmation = s.requests.filter(r => r.url.endsWith("camera-state"))[1];
  assert.equal(JSON.parse(confirmation.options.body).value, 2);
  assert.equal(JSON.parse(confirmation.options.body).commandId, 1);
  // One bounded 125ms publishing gap, then observe the next capture.
  for (let attempt = 0; attempt < 30 && s.drawnZooms.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(s.drawnZooms, [1, 2]);
  assert.equal(s.requests.filter(r => r.url.endsWith("frame"))[1].options.headers["X-Camera-Zoom-Command"], "1");
  s.stop();
  s.laterUploadResponse.resolve({ ok: true, json: async () => ({ sequence: 2 }) });
  await started;
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
