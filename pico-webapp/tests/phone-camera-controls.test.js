import test from "node:test";
import assert from "node:assert/strict";
import { createPhoneCameraControls } from "../js/phone-camera-controls.js";

const ready = { available: true, supported: true, status: "ready", sessionId: "phone-1", min: 1, max: 10, step: 0.1, value: 1 };
const response = body => ({ ok: true, json: async () => body });
function setup() {
  let active = true, code = "pairing-code";
  const calls = [], states = [], replies = [];
  const client = createPhoneCameraControls({ isActive: () => active, getCode: () => code, onState: state => states.push(state),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return replies.shift() ?? response(ready); } });
  return { client, calls, states, replies, setActive: value => { active = value; }, setCode: value => { code = value; } };
}

test("viewer sends authenticated source commands for the displayed phone session and keeps actual zoom until confirmed", async () => {
  const b = setup();
  await b.client.refresh();
  b.replies.push(response({ ...ready, status: "pending", available: false, commandId: 1 }));
  assert.equal(await b.client.send("in"), true);
  assert.equal(b.calls[1].url, "/phone-camera/zoom");
  assert.equal(b.calls[1].options.headers.Authorization, "Bearer pairing-code");
  assert.deepEqual(JSON.parse(b.calls[1].options.body), { action: "in", sessionId: "phone-1" });
  assert.equal(b.states.at(-1).value, 1);
  assert.equal(b.states.at(-1).status, "pending");
  assert.equal(await b.client.send("in"), false);
  b.replies.push(response({ ...ready, value: 1.1, commandId: 1 }));
  await b.client.refresh();
  assert.equal(b.states.at(-1).value, 1.1);
  assert.equal(b.calls[0].options.headers, undefined);
});

test("inactive, locked, unsupported and stale cameras cannot receive viewer commands", async () => {
  const b = setup();
  await b.client.refresh();
  b.setActive(false);
  assert.equal(await b.client.send("in"), false);
  b.setActive(true); b.setCode("");
  assert.equal(await b.client.send("in"), false);
  b.setCode("pairing-code");
  for (const state of [{ ...ready, supported: false }, { ...ready, available: false }]) {
    b.replies.push(response(state));
    await b.client.refresh();
    assert.equal(await b.client.send("in"), false);
  }
  assert.equal(b.calls.filter(c => c.options.method === "POST").length, 0);
});

test("a delayed state poll cannot overwrite a newer pending command", async () => {
  const b = setup();
  await b.client.refresh();
  let finishPoll;
  b.replies.push(new Promise(resolve => { finishPoll = resolve; }));
  const poll = b.client.refresh();
  b.replies.push(response({ ...ready, status: "pending", available: false }));
  await b.client.send("in");
  finishPoll(response(ready));
  await poll;
  assert.equal(b.states.at(-1).status, "pending");
});

test("page exit aborts polling and ignores its late response", async () => {
  const b = setup();
  let finish;
  b.replies.push(new Promise(resolve => { finish = resolve; }));
  const poll = b.client.refresh();
  b.client.stop();
  assert.equal(b.calls[0].options.signal.aborted, true);
  finish(response(ready));
  await poll;
  assert.equal(b.states.length, 0);
  assert.equal(await b.client.send("in"), false);
});
