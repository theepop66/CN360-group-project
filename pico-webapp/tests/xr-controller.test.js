import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setMode, runSweep } from "../js/servo.js";

import {
  attachXrControllerShortcuts,
  clampAngle,
  createEdgeTracker,
  createStickRepeater,
  DEFAULT_CONTROLLER_SHORTCUTS,
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
  const events = new Map();
  return {
    inputSources: [],
    requestAnimationFrame(callback) {
      queue.push(callback);
      return queue.length;
    },
    addEventListener(name, callback) { events.set(name, callback); },
    end() { events.get("end")?.(); },
    frame(time) {
      const callback = queue.shift();
      if (callback) callback(time, {});
    },
    pendingFrames() {
      return queue.length;
    }
  };
}

// Independent oracle: PICO's registered WebXR layout includes the unused
// touchpad slot. Omitting it was what shifted X/Y/A/B in the old tests.
const pico = JSON.parse(readFileSync(new URL("./fixtures/pico-4-inputs.json", import.meta.url), "utf8"));
const expected = {
  left: [null, "sweep", null, "reset-zoom", "manual", "capture"],
  right: [null, "sweep", null, null, "reject", "pass"]
};
for (const hand of ["left", "right"]) {
  for (const [index, component] of pico[hand].entries()) {
    test(`registered PICO ${hand} ${component ?? "unused touchpad"} [${index}] dispatches the intended shortcut`, () => {
      const session = createFakeSession();
      const actions = [];
      attachXrControllerShortcuts({ session,
        onAction: (action) => actions.push(action),
        onCameraZoom: (action) => actions.push(action === "reset" ? "reset-zoom" : action) });
      session.inputSources = [pad(hand, { buttons: pico[hand].map((_name, i) => i === index) })];
      session.frame(0);
      session.frame(16);
      assert.deepEqual(actions, expected[hand][index] ? [expected[hand][index]] : []);
    });
  }
}

test("physical PICO X followed by Grip selects Manual before the sweep request", async () => {
  const session = createFakeSession();
  const commands = [];
  let mode = "auto";
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    commands.push({ url, body });
    if (url.endsWith("/mode")) mode = body.mode;
    return { ok: true, json: async () => ({ accepted: mode === "manual", mode }) };
  };
  let pending;
  attachXrControllerShortcuts({ session, onAction: (action) => {
    pending = action === "manual"
      ? setMode({ url: "https://hud.test/esp/mode", mode: action, fetchImpl })
      : runSweep({ url: "https://hud.test/esp/servo", fetchImpl });
  } });
  session.inputSources = [pad("left", { buttons: pico.left.map((name) => name === "X") })];
  session.frame(0);
  assert.equal((await pending).accepted, true);
  session.inputSources = [pad("right", { buttons: pico.right.map((name) => name === "grip") })];
  session.frame(400);
  assert.equal((await pending).accepted, true);
  assert.deepEqual(commands, [
    { url: "https://hud.test/esp/mode", body: { mode: "manual" } },
    { url: "https://hud.test/esp/servo", body: { sweep: true } }
  ]);
});

test("haptic driver failures do not stop grip dispatch or further XR frames", () => {
  const session = createFakeSession();
  const actions = [];
  const controller = pad("right", { buttons: [false, true, false, false, false, false] });
  controller.gamepad.hapticActuators = [{ pulse() { throw new Error("driver unavailable"); } }];
  attachXrControllerShortcuts({ session, onAction: (action) => actions.push(action) });
  session.inputSources = [controller];
  session.frame(0);
  controller.gamepad.buttons[1] = { pressed: false, value: 0 };
  session.frame(16);
  controller.gamepad.buttons[1] = { pressed: true, value: 1 };
  session.frame(400);
  assert.deepEqual(actions, ["sweep", "sweep"]);
  assert.equal(session.pendingFrames(), 1);
});

test("a disconnected controller cannot keep commanding conveyor motion or leave buttons latched", () => {
  const session = createFakeSession();
  const actions = [], directions = [];
  const controller = pad("left", { buttons: [false, true, false, false, false, false], axes: [0, 0, 0, -1] });
  attachXrControllerShortcuts({ session,
    onAction: (action) => actions.push(action), onConveyor: (direction) => directions.push(direction) });
  session.inputSources = [controller];
  session.frame(0);
  controller.gamepad.connected = false;
  session.frame(16);
  controller.gamepad.connected = true;
  session.frame(400);
  assert.deepEqual(directions, [1, null, 1]);
  assert.deepEqual(actions, ["sweep", "sweep"]);
});

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
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 4 }), "reject");
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 5 }), "pass");
  assert.equal(resolveButtonAction({ ...left, buttonIndex: 4 }), "manual");
  assert.equal(resolveButtonAction({ ...left, buttonIndex: 5 }), "capture");
  assert.equal(resolveButtonAction({ ...left, buttonIndex: 3 }), "reset-zoom");
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 1 }), "sweep");
  assert.equal(resolveButtonAction({ handedness: "left", buttonIndex: 1 }), "sweep");
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 0 }), null);
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 2 }), null);
  assert.equal(resolveButtonAction({ ...right, buttonIndex: 3 }), null);
  assert.equal(resolveButtonAction({ ...left, buttonIndex: 2 }), null);
  assert.equal(resolveButtonAction({ handedness: "", buttonIndex: 3 }), null);
});

test("puts capture on the left secondary button and keeps the other shortcuts", () => {
  assert.deepEqual({ ...DEFAULT_CONTROLLER_SHORTCUTS.buttons }, {
    squeeze: "sweep",
    rightPrimary: "reject",
    rightSecondary: "pass",
    leftPrimary: "manual",
    leftSecondary: "capture",
    leftStick: "reset-zoom"
  });
});

test("left Y asks for a capture and no longer switches to Auto", () => {
  const session = createFakeSession();
  const actions = [];
  attachXrControllerShortcuts({ session, onAction: (action) => actions.push(action) });

  // Y is the registered PICO secondary button (index 5); X is index 4.
  session.inputSources = [pad("left", { buttons: [false, false, false, false, false, true] })];
  session.frame(0);
  assert.deepEqual(actions, ["capture"]);

  // X still selects Manual; its own key is not held back by Y's cooldown.
  session.inputSources = [pad("left", { buttons: [false, false, false, false, true, false] })];
  session.frame(100);
  assert.deepEqual(actions, ["capture", "manual"]);
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

  session.inputSources = [pad("right", { buttons: [false, false, false, false, true, false] })];
  session.frame(0);
  session.frame(16);
  assert.deepEqual(actions, ["reject"]);

  session.inputSources = [pad("right", { buttons: [false, false, false, false, false, true] })];
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

test("right-stick negative jog stops at zero instead of wrapping", () => {
  const session = createFakeSession();
  const angles = [];
  attachXrControllerShortcuts({
    session,
    initialAngle: 0,
    shortcuts: { stepDeg: 10, repeatMs: 200, firstRepeatMs: 300, deadzone: 0.35 },
    onAngle: (angle) => angles.push(angle)
  });

  session.inputSources = [pad("right", { axes: [0, 0, -1, 0] })];
  session.frame(0);
  assert.deepEqual(angles, [0]);
});

test("left thumbstick does not move the servo", () => {
  const session = createFakeSession();
  const angles = [];
  attachXrControllerShortcuts({ session, onAngle: (angle) => angles.push(angle) });

  session.inputSources = [pad("left", { axes: [0, 0, 0, -1] })];
  session.frame(0);
  assert.deepEqual(angles, []);
});

test("left stick cannot cancel a simultaneous right servo command", () => {
  const session = createFakeSession();
  const angles = [];
  attachXrControllerShortcuts({ session, onAngle: (angle) => angles.push(angle) });

  session.inputSources = [
    pad("left", { axes: [0, 0, 0, 1] }),
    pad("right", { axes: [0, 0, 0, -1] })
  ];
  session.frame(0);
  assert.deepEqual(angles, [5]);
});

test("left stick reports conveyor direction and stops when released or disconnected", () => {
  const session = createFakeSession();
  const directions = [];
  attachXrControllerShortcuts({ session, onConveyor: (direction) => directions.push(direction) });

  session.inputSources = [pad("left", { axes: [0, 0, 0, -1] })];
  session.frame(0);
  session.inputSources = [pad("left", { axes: [0, 0, 0, 1] })];
  session.frame(16);
  session.inputSources = [pad("left", { axes: [0, 0, 0, 0] })];
  session.frame(32);
  session.inputSources = [];
  session.frame(48);
  session.inputSources = [pad("left", { axes: [] })];
  session.frame(64);
  assert.deepEqual(directions, [1, -1, 0, null, null]);
});

test("stop() keeps the poll loop from rescheduling", () => {
  const session = createFakeSession();
  const handle = attachXrControllerShortcuts({ session });
  handle.stop();
  session.frame(0);
  assert.equal(session.pendingFrames(), 0);
});

test("left-stick zoom and right-stick servo operate independently and simultaneously", () => {
  const session = createFakeSession();
  const angles = [], zooms = [];
  attachXrControllerShortcuts({ session, initialAngle: 90,
    onAngle: angle => angles.push(angle), onCameraZoom: action => zooms.push(action) });
  session.inputSources = [pad("left", { axes: [0, 0, 1, 0] })];
  session.frame(0);
  assert.deepEqual(zooms, ["in"]);
  assert.deepEqual(angles, []);
  session.inputSources.push(pad("right", { axes: [0, 0, 1, 0] }));
  session.frame(350);
  assert.deepEqual(zooms, ["in", "in"]);
  assert.deepEqual(angles, [95]);
});

test("left stick horizontal zoom and vertical conveyor commands use separate axes", () => {
  const session = createFakeSession();
  const zooms = [];
  const directions = [];
  attachXrControllerShortcuts({ session,
    onCameraZoom: action => zooms.push(action),
    onConveyor: direction => directions.push(direction) });
  session.inputSources = [pad("left", { axes: [0, 0, 1, 0] })];
  session.frame(0);
  session.inputSources = [pad("left", { axes: [0, 0, 0, -1] })];
  session.frame(16);
  assert.deepEqual(zooms, ["in"]);
  assert.deepEqual(directions, [0, 1]);
});

test("left-stick vertical motion and horizontal drift do not zoom or move a servo", () => {
  const session = createFakeSession();
  const updates = [];
  attachXrControllerShortcuts({ session, onAngle: () => updates.push("servo"), onCameraZoom: () => updates.push("zoom") });
  for (const axes of [[0, 0, 0, 1], [0, 0, 0.1, 0]]) {
    session.inputSources = [pad("left", { axes })]; session.frame(0);
  }
  assert.deepEqual(updates, []);
});

test("joystick emits camera commands without inventing an applied zoom", () => {
  const session = createFakeSession();
  const zooms = [], actions = [];
  const handle = attachXrControllerShortcuts({ session,
    onCameraZoom: action => zooms.push(action), onAction: action => actions.push(action) });
  session.inputSources = [pad("left", { axes: [0, 0, 1, 0] })]; session.frame(0);
  session.inputSources = [pad("left", { buttons: [false, false, false, true, false, false], axes: [0, 0, 1, 0] })]; session.frame(20);
  assert.deepEqual(actions, []);
  session.inputSources = [pad("left", { axes: [0, 0, -1, 0] })]; session.frame(40);
  session.frame(400);
  handle.stop(); session.frame(800);
  assert.deepEqual(zooms, ["in", "reset", "out", "out"]);
});

test("ending an XR session stops further zoom and servo input", () => {
  const session = createFakeSession();
  const updates = [];
  attachXrControllerShortcuts({ session, onCameraZoom: () => updates.push("zoom"), onAngle: () => updates.push("servo") });
  session.inputSources = [pad("left", { axes: [0, 0, 0, -1] }), pad("right", { axes: [0, 0, 1, 0] })];
  session.end(); session.frame(0);
  assert.deepEqual(updates, []);
  assert.equal(session.pendingFrames(), 0);
});
