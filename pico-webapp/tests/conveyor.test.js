import test from "node:test";
import assert from "node:assert/strict";
import { createConveyorSender } from "../js/conveyor.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for command");
}

test("auto-sends neutral handshake then movement when joystick pushed immediately", async () => {
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 9, lease: 100 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: body.lease + 1 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  // Simulate XR frames refreshing direction every 20ms (like the real headset)
  let held = 1;
  const xrFrame = setInterval(() => sender.setDirection(held), 20);
  try {
    // Auto-sends 0 (neutral handshake) then 1 (actual movement)
    await waitUntil(() => commands.length >= 2);
    assert.deepEqual(commands.slice(0, 2).map((c) => c.direction), [0, 1]);
    assert.deepEqual(commands.slice(0, 2).map((c) => c.sequence), [10, 11]);
    // Backward also works without neutral
    held = null;
    sender.setDirection(null);
    await delay(50);
    held = -1;
    await waitUntil(() => commands.some((c) => c.direction === -1));
  } finally {
    clearInterval(xrFrame);
    sender.stop();
  }
});

test("does not send a command when input expires during lease acquisition", async () => {
  let resolveLease;
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return new Promise((resolve) => {
        resolveLease = () => resolve({ ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 100 }) });
      });
    }
    commands.push(JSON.parse(options.body));
    throw new Error("Unexpected conveyor command");
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  try {
    sender.setDirection(0);
    await waitUntil(() => Boolean(resolveLease));
    await delay(210);
    resolveLease();
    await delay(50);
    assert.deepEqual(commands, []);
  } finally {
    sender.stop();
  }
});

test("after null then re-push, fresh session starts and direction=1 is sent", async () => {
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 100 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: 101 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  // Simulate XR frames refreshing direction every 20ms
  let heldDirection = 1;
  const xrFrame = setInterval(() => { if (heldDirection !== null) sender.setDirection(heldDirection); }, 20);
  try {
    await waitUntil(() => commands.some((c) => c.direction === 1));
    // Stop: null clears session
    heldDirection = null;
    sender.setDirection(null);
    await delay(50);
    // Re-push: should start fresh and reach direction=1 again
    heldDirection = 1;
    const countBefore = commands.length;
    await waitUntil(() => commands.slice(countBefore).some((c) => c.direction === 1));
  } finally {
    clearInterval(xrFrame);
    sender.stop();
  }
});

test("stops renewing when XR frames stop; resumes when frames restart", async () => {
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 10 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: body.lease + 1 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  // Simulate XR frames at 20ms intervals
  const xrFrame = setInterval(() => sender.setDirection(1), 20);
  try {
    await waitUntil(() => commands.some((command) => command.direction === 1));
    // Stop XR frames
    clearInterval(xrFrame);
    await delay(350);
    const count = commands.length;
    // No new commands after frames stop (input expires)
    await delay(250);
    assert.equal(commands.length, count);
    // Restart XR frames: movement should resume
    const xrFrame2 = setInterval(() => sender.setDirection(1), 20);
    try {
      await waitUntil(() => commands.length > count + 1);
      assert.ok(commands.slice(count).some((c) => c.direction === 1), "should resume direction=1");
    } finally {
      clearInterval(xrFrame2);
    }
  } finally {
    sender.stop();
  }
});

test("re-pushing after a stale gap re-acquires a session and resumes movement", async () => {
  let clock = 0;
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 10 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: body.lease + 1 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl, now: () => clock });
  try {
    // Initial push: auto-handshake (0) then movement (1)
    sender.setDirection(1);
    await waitUntil(() => commands.some((c) => c.direction === 1));
    // Stale gap: XR frames stopped for >200ms
    clock = 500;
    await delay(50);
    // Re-push after gap: should re-acquire session and move again
    sender.setDirection(1);
    const countBefore = commands.length;
    await waitUntil(() => commands.length > countBefore + 1);
    assert.ok(commands.some((c) => c.direction === 1), "should send direction=1 after stale gap");
  } finally {
    sender.stop();
  }
});
