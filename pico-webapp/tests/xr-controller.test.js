import test from "node:test";
import assert from "node:assert/strict";

import {
  attachXrControllerShortcuts,
  clampAngle,
  createEdgeTracker,
  createStickRepeater,
  resolveButtonAction,
  stickDirection
} from "../js/xr-controller.js";

function pad(handedness, { buttons = [], axes = [] } = {}) {
  return {
    handedness,
    gamepad: {
      buttons: buttons.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
      axes
    }
  };
}

function createFakeSession() {
  const queue = [];
  return {
    inputSources: [],
    requestAnimationFrame(callback) {
      queue.push(callback);
      return queue.length;
    },
    addEventListener() {},
    frame(time) {
      const callback = queue.shift();
      if (callback) callback(time, {});
    },
    pendingFrames() {
      return queue.length;
    }
  };
}

test("clamps and rounds the angle into the servo range", () => {
  assert.equal(clampAngle(-10), 0);
  assert.equal(clampAngle(0), 0);
  assert.equal(clampAngle(47.6), 48);
  assert.equal(clampAngle(180), 180);
  assert.equal(clampAngle(240), 180);
  assert.equal(clampAngle("90"), 90);
  assert.equal(clampAngle("not a number"), 0);
});

test("maps thumbstick axes to a direction", () => {
  assert.equal(stickDirection([0, 0, 1, 0]), 1);
  assert.equal(stickDirection([0, 0, -1, 0]), -1);
  assert.equal(stickDirection([0, 0, 0, -1]), 1);
  assert.equal(stickDirection([0, 0, 0, 1]), -1);
  assert.equal(stickDirection([0, 0, 0.2, 0.2]), 0);
  assert.equal(stickDirection([]), 0);
  assert.equal(stickDirection([0.9, 0]), 1);
});

test("resolves the configured PICO buttons per hand", () => {
  const right = { handedness: "right" };
  const left = { handedness: "left" };
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 3 }), "reject");
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 4 }), "pass");
  assert.equal(resolveButtonAction({ ...left, buttonIndex: 3 }), "manual");
  assert.equal(resolveButtonAction({ ...left, buttonIndex: 4 }), "auto");
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 1 }), "sweep");
  assert.equal(resolveButtonAction({ handedness: "left", buttonIndex: 1 }), "sweep");
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 0 }), null);
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 2 }), null);
  assert.equal(resolveButtonAction({ handedness: "", buttonIndex: 3 }), null);
});

test("fires once per press and honours the cooldown", () => {
  const edges = createEdgeTracker({ cooldownMs: 300 });
  assert.equal(edges.update("right:3", true, 0), true);
  assert.equal(edges.update("right:3", true, 16), false);
  assert.equal(edges.update("right:3", false, 32), false);
  // Pressed again inside the cooldown: suppressed, and it must not fire later
  // just because the button is still down.
  assert.equal(edges.update("right:3", true, 100), false);
  assert.equal(edges.update("right:3", true, 400), false);
  assert.equal(edges.update("right:3", false, 420), false);
  assert.equal(edges.update("right:3", true, 500), true);
});

test("repeats a held stick direction on a fixed cadence", () => {
  const repeater = createStickRepeater({ repeatMs: 200, firstRepeatMs: 300 });
  assert.equal(repeater.update(1, 0), 1);
  assert.equal(repeater.update(1, 100), 0);
  assert.equal(repeater.update(1, 300), 1);
  assert.equal(repeater.update(1, 400), 0);
  assert.equal(repeater.update(1, 500), 1);
  assert.equal(repeater.update(0, 600), 0);
  assert.equal(repeater.update(-1, 610), -1);
});

test("button presses dispatch one action while held", () => {
  const session = createFakeSession();
  const actions = [];
  attachXrControllerShortcuts({
    session,
    onAction: (action) => actions.push(action)
  });

  session.inputSources = [pad("right", { buttons: [false, false, false, true, false] })];
  session.frame(0);
  session.frame(16);
  assert.deepEqual(actions, ["reject"]);

  session.inputSources = [pad("right", { buttons: [false, false, false, false, true] })];
  session.frame(100);
  assert.deepEqual(actions, ["reject", "pass"]);

  session.inputSources = [pad("left", { buttons: [false, true, false, false, false] })];
  session.frame(200);
  assert.deepEqual(actions, ["reject", "pass", "sweep"]);
});

test("thumbstick jogs the angle immediately, then on repeat only", () => {
  const session = createFakeSession();
  const angles = [];
  const handle = attachXrControllerShortcuts({
    session,
    initialAngle: 90,
    shortcuts: { stepDeg: 10, repeatMs: 200, firstRepeatMs: 300, deadzone: 0.35 },
    onAngle: (angle) => angles.push(angle)
  });

  session.inputSources = [pad("right", { axes: [0, 0, 1, 0] })];
  session.frame(0);
  assert.deepEqual(angles, [100]);
  assert.equal(handle.angle(), 100);

  session.frame(100);
  assert.deepEqual(angles, [100]);

  session.frame(300);
  assert.deepEqual(angles, [100, 110]);

  session.inputSources = [pad("right", { axes: [0, 0, 0, 0] })];
  session.frame(400);
  assert.deepEqual(angles, [100, 110]);
});

test("negative jog stops at zero instead of wrapping", () => {
  const session = createFakeSession();
  const angles = [];
  attachXrControllerShortcuts({
    session,
    initialAngle: 0,
    shortcuts: { stepDeg: 10, repeatMs: 200, firstRepeatMs: 300, deadzone: 0.35 },
    onAngle: (angle) => angles.push(angle)
  });

  session.inputSources = [pad("left", { axes: [0, 0, -1, 0] })];
  session.frame(0);
  assert.deepEqual(angles, [0]);
});

test("stop() keeps the poll loop from rescheduling", () => {
  const session = createFakeSession();
  const handle = attachXrControllerShortcuts({ session });
  handle.stop();
  session.frame(0);
  assert.equal(session.pendingFrames(), 0);
});
