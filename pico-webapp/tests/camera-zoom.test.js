import test from "node:test";
import assert from "node:assert/strict";
import { readCameraZoom, applyCameraZoom, requestedCameraZoom } from "../js/camera-zoom.js";
import { createCameraZoomState } from "../tools/camera-zoom-state.mjs";

const report = { supported: true, min: 0.5, max: 10, step: 0.1, value: 1 };

test("reads the real track range and settings; missing capabilities/readback are unsupported", () => {
  assert.deepEqual(readCameraZoom({ getCapabilities: () => ({ zoom: { min: 0.5, max: 10, step: 0.1 } }), getSettings: () => ({ zoom: 2 }), applyConstraints() {} }), { ...report, value: 2 });
  for (const track of [{}, { getCapabilities: () => ({ zoom: { min: 1, max: 4, step: 0.1 } }), getSettings: () => ({}), applyConstraints() {} }]) {
    assert.equal(readCameraZoom(track).supported, false);
  }
});

test("WebKit min/max-only camera ranges remain controllable with verified readback", async () => {
  let value = 1;
  const track = { getCapabilities: () => ({ zoom: { min: 0.5, max: 10 } }), getSettings: () => ({ zoom: value }),
    applyConstraints: async constraints => { value = constraints.advanced[0].zoom; } };
  const camera = readCameraZoom(track);
  assert.equal(camera.supported, true);
  assert.equal(camera.step, 0);
  assert.equal(requestedCameraZoom(camera, "in"), 1.1);
  assert.equal((await applyCameraZoom(track, 1.1)).value, 1.1);
});

test("applies zoom to the capture track and verifies it after new source frames", async () => {
  let value = 1;
  const calls = [];
  const track = { getCapabilities: () => ({ zoom: report }), getSettings: () => ({ zoom: value }),
    applyConstraints: async constraints => { calls.push(constraints); value = constraints.advanced[0].zoom; } };
  const actual = await applyCameraZoom(track, 2, async () => calls.push("new-camera-frames"));
  assert.deepEqual(calls, [{ advanced: [{ zoom: 2 }] }, "new-camera-frames"]);
  assert.equal(actual.value, 2);
});

test("a successful but ignored applyConstraints promise is never a zoom confirmation", async () => {
  const track = { getCapabilities: () => ({ zoom: report }), getSettings: () => ({ zoom: 1 }), applyConstraints: async () => {} };
  await assert.rejects(applyCameraZoom(track, 2), /camera_zoom_not_confirmed/);
});

test("a hung camera operation has a bounded timeout", async () => {
  const track = { getCapabilities: () => ({ zoom: report }), getSettings: () => ({ zoom: 1 }), applyConstraints: () => new Promise(() => {}) };
  await assert.rejects(applyCameraZoom(track, 2, async () => {}, 10), /camera_zoom_timeout/);
});

test("commands follow device range/step, including below 1x and above 4x", () => {
  assert.equal(requestedCameraZoom({ ...report, value: 4 }, "in"), 4.1);
  assert.equal(requestedCameraZoom({ ...report, value: 0.5 }, "out"), 0.5);
  assert.equal(requestedCameraZoom({ ...report, value: 10 }, "in"), 10);
  assert.equal(requestedCameraZoom({ ...report, min: 2, value: 4 }, "reset"), 2);
  assert.equal(requestedCameraZoom(report, "reset"), 1);
  assert.throws(() => requestedCameraZoom(report, "sweep"), /invalid_zoom_action/);
});

test("queued zoom stays pending until a matching camera readback; errors keep actual value", () => {
  const state = createCameraZoomState();
  state.report(report);
  const command = state.request("in");
  assert.equal(state.state().value, 1);
  assert.equal(state.state().status, "pending");
  assert.throws(() => state.request("in"), /zoom_command_pending/);
  assert.throws(() => state.report({ ...report, value: 1.1, commandId: command.id - 1 }), /zoom_ack_mismatch/);
  assert.throws(() => state.report({ ...report, commandId: command.id }), /zoom_not_confirmed/);
  state.report({ ...report, value: 1.1, commandId: command.id });
  assert.equal(state.state().status, "ready");
  assert.equal(state.state().value, 1.1);
  const failed = state.request("in");
  state.report({ ...report, value: 1.1, commandId: failed.id, error: "failed" });
  assert.equal(state.state().value, 1.1);
  assert.equal(state.state().status, "error");
});
