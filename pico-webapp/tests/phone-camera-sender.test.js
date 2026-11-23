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
function sender({ presentFrames = true, supportZoom = false, profile, dimensions = [640, 480], jpegSizes = [], maxFrameBytes, fps, frameTimes, uploadReplies = [] } = {}) {
  const elements = new Map();
  for (const id of ["sender-form", "start", "stop", "pairing-code", "status", "preview", "camera-zoom-status"]) {
    const events = new Map();
    elements.set(id, { value: "test-code", disabled: false, textContent: "", events,
      addEventListener: (name, fn) => events.set(name, fn) });
  }
  if (profile) elements.set("camera-quality", { value: profile });
  if (fps) elements.set("camera-rate", { value: String(fps) });
  const documentEvents = new Map();
  const streamRequest = deferred();
  const video = elements.get("preview");
  let callbackId = 0;
  let now = 0;
  const callbacks = new Map();
  Object.assign(video, { play: async () => {}, videoWidth: dimensions[0], videoHeight: dimensions[1], readyState: 3,
    requestVideoFrameCallback(fn) {
      const id = ++callbackId;
      callbacks.set(id, fn);
      if (presentFrames) queueMicrotask(() => {
        if (!callbacks.has(id)) return;
        if (frameTimes) {
          if (!frameTimes.length) return;
          now = frameTimes.shift();
        }
        fn();
      });
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
  const encodes = [];
  const cameraRequests = [];
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const document = { hidden: false, querySelector: selector => elements.get(selector.slice(1)),
    addEventListener: (name, fn) => documentEvents.set(name, fn),
    createElement: () => ({ getContext: () => ({ drawImage() { drawnZooms.push(cameraZoom); } }),
      toBlob(fn, type, quality) {
        const size = jpegSizes[encodes.length] ?? 4;
        encodes.push({ width: this.width, height: this.height, quality });
        fn(new Blob([new Uint8Array(size)], { type }));
      } }) };
  const uploadResponse = deferred();
  const laterUploadResponse = deferred();
  runInNewContext(source, {
    document, window: { isSecureContext: true, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: constraints => { cameraRequests.push(constraints); return streamRequest.promise; } } },
    performance: { now: () => now }, AbortController, setTimeout, clearTimeout, readCameraZoom, applyCameraZoom,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("frame")) {
        const index = requests.filter(r => r.url.endsWith("frame")).length - 1;
        return uploadReplies[index] ?? (index === 0 ? uploadResponse.promise : laterUploadResponse.promise);
      }
      return { ok: true, json: async () => ({ token: "session-token", serverTime: 1800000000000, maxFrameBytes }) };
    }
  });
  return { elements, document, documentEvents, requests, streamRequest, stream, uploadResponse, laterUploadResponse, track, trackEvents, callbacks, applied, drawnZooms, encodes, cameraRequests,
    get stopped() { return stopped; },
    start: () => elements.get("sender-form").events.get("submit")({ preventDefault() {} }),
    stop: () => elements.get("stop").events.get("click")() };
}

test("high detail keeps a rotated Full HD frame and reduces the next frame when both encodes exceed the negotiated limit", async () => {
  const s = sender({ profile: "detail", dimensions: [1080, 1920], jpegSizes: [201, 101, 90], maxFrameBytes: 100 });
  const started = s.start();
  s.streamRequest.resolve(s.stream);
  for (let attempt = 0; attempt < 50 && !s.requests.some(r => r.url.endsWith("frame")); attempt++) await Promise.resolve();
  assert.equal(s.cameraRequests[0].video.width.ideal, 1920);
  assert.equal(s.cameraRequests[0].video.height.ideal, 1080);
  assert.deepEqual(s.encodes, [
    { width: 1080, height: 1920, quality: 0.9 },
    { width: 1080, height: 1920, quality: 0.75 },
    { width: 810, height: 1440, quality: 0.9 }
  ]);
  const [upload] = s.requests.filter(r => r.url.endsWith("frame"));
  assert.equal(upload.options.body.size, 90);
  assert.equal(upload.options.headers["X-Frame-Sequence"], "1");
  assert.equal(s.elements.get("camera-quality").disabled, true);
  s.stop();
  s.uploadResponse.resolve({ ok: true, json: async () => ({ accepted: true, sequence: 1 }) });
  await started;
  assert.equal(s.elements.get("camera-quality").disabled, false);
});

test("a stale upload is skipped and a 10 FPS schedule stays aligned on a 24 FPS source", async () => {
  const s = sender({ fps: 10, frameTimes: [0, 42, 83, 125, 167, 208], uploadReplies: [
    { ok: false, json: async () => ({ error: "stale_frame" }) },
    { ok: true, json: async () => ({ accepted: true, sequence: 2 }) }
  ] });
  const started = s.start();
  s.streamRequest.resolve(s.stream);
  let uploads;
  for (let attempt = 0; attempt < 80; attempt++) {
    uploads = s.requests.filter(r => r.url.endsWith("frame"));
    if (uploads.length === 3) break;
    await Promise.resolve();
  }
  s.stop();
  s.laterUploadResponse.resolve({ ok: true, json: async () => ({ accepted: true, sequence: 3 }) });
  await started;
  assert.deepEqual(uploads.map(r => Number(r.options.headers["X-Captured-At-Ms"]) - 1800000000000), [0, 125, 208]);
});

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
