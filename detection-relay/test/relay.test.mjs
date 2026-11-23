import test from "node:test";
import assert from "node:assert/strict";

import { TOKEN_HEADER, stripConfidence, validatePayload } from "../lib/relay.mjs";
import { connectClient, delay, post, readyClient, samplePayload, startRelay } from "./helpers.mjs";

async function withRelay(options, run) {
  const harness = await startRelay(options);
  try {
    await run(harness);
  } finally {
    await harness.relay.close();
  }
}

test("a posted payload reaches every connected HUD unchanged", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    const first = await readyClient(wsUrl());
    const second = await readyClient(wsUrl());
    const payload = samplePayload();

    const response = await post(httpUrl(), payload);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { delivered: 2 });

    assert.deepEqual(await first.next(), payload);
    assert.deepEqual(await second.next(), payload);
  }));

test("posting with no HUD connected still succeeds", () =>
  withRelay({}, async ({ httpUrl }) => {
    const response = await post(httpUrl(), samplePayload());
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { delivered: 0 });
  }));

test("an empty detection list is forwarded so the HUD clears its overlay", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    const client = await readyClient(wsUrl());
    const payload = samplePayload({
      status: "failed",
      reason: "model_timeout",
      frame: { id: "session-a:8", sessionId: "session-a", sequence: 8, width: null, height: null },
      detections: []
    });

    assert.equal((await post(httpUrl(), payload)).status, 202);
    assert.deepEqual(await client.next(), payload);
  }));

test("confidence is removed before the payload reaches a HUD", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    const client = await readyClient(wsUrl());
    const payload = samplePayload({
      confidence: 0.9,
      detections: [{ label: "mold", box: [1, 2, 3, 4], status: "reject", confidence: 0.42 }]
    });

    await post(httpUrl(), payload);
    const received = await client.next();

    assert.equal("confidence" in received, false);
    assert.equal("confidence" in received.detections[0], false);
    assert.deepEqual(received.detections[0].box, [1, 2, 3, 4]);
  }));

test("a HUD that connects late gets a greeting and no earlier frame", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    await post(httpUrl(), samplePayload());

    const late = connectClient(wsUrl());
    await late.opened;
    assert.deepEqual(await late.next(), { type: "connected" });

    await delay(100);
    assert.equal(late.pending(), 0, "the relay must not replay a stale frame");
  }));

test("malformed bodies are rejected and not broadcast", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    const client = await readyClient(wsUrl());
    const cases = [
      ["not json", "{"],
      ["an array", "[]"],
      ["a string", '"hello"'],
      ["the wrong type", { ...samplePayload(), type: "heartbeat" }],
      ["missing detections", { type: "detections" }],
      ["detections not an array", { ...samplePayload(), detections: {} }],
      ["a detection that is not an object", { ...samplePayload(), detections: [[1, 2, 3, 4]] }]
    ];

    for (const [name, body] of cases) {
      const response = await post(httpUrl(), body);
      assert.equal(response.status, 400, name);
    }

    await delay(100);
    assert.equal(client.pending(), 0, "nothing invalid may reach a HUD");
  }));

test("an oversized body is rejected with 413", () =>
  withRelay({ maxBodyBytes: 1024 }, async ({ httpUrl }) => {
    const payload = samplePayload({ reason: "x".repeat(2048) });
    const response = await post(httpUrl(), payload);
    assert.equal(response.status, 413);
  }));

test("other methods on the detection path get 405", () =>
  withRelay({}, async ({ httpUrl }) => {
    const response = await fetch(httpUrl(), { method: "GET" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  }));

test("unknown paths get 404 over HTTP and WebSocket", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    assert.equal((await post(httpUrl("/elsewhere"), samplePayload())).status, 404);

    const client = connectClient(wsUrl("/elsewhere"));
    await assert.rejects(client.opened);
  }));

test("the health endpoint reports connected HUDs and the last ingest", () =>
  withRelay({}, async ({ httpUrl, wsUrl }) => {
    const before = await (await fetch(httpUrl("/health"))).json();
    assert.deepEqual(before, { ok: true, clients: 0, lastIngestAt: null });

    await readyClient(wsUrl());
    await post(httpUrl(), samplePayload());

    const after = await (await fetch(httpUrl("/health"))).json();
    assert.equal(after.clients, 1);
    assert.equal(typeof after.lastIngestAt, "string");
  }));

test("healthy HUDs receive heartbeats the HUD parser ignores", () =>
  withRelay({ heartbeatMs: 50 }, async ({ wsUrl }) => {
    const client = await readyClient(wsUrl());
    const message = await client.next();
    assert.equal(message.type, "heartbeat");

    await delay(200);
    assert.equal(client.ws.readyState, client.ws.OPEN, "a HUD that answers pings stays connected");
  }));

test("a HUD that stops answering pings is dropped", () =>
  withRelay({ heartbeatMs: 50 }, async ({ relay, wsUrl }) => {
    const client = await readyClient(wsUrl(), { autoPong: false });
    await client.closed;
    // The client can see the close before the server finishes its own side.
    for (let i = 0; i < 20 && relay.clientCount > 0; i += 1) await delay(10);
    assert.equal(relay.clientCount, 0);
  }));

test("with no ingest token configured, any token header is ignored", () =>
  withRelay({}, async ({ httpUrl }) => {
    assert.equal((await post(httpUrl(), samplePayload())).status, 202);
    assert.equal((await post(httpUrl(), samplePayload(), { [TOKEN_HEADER]: "anything" })).status, 202);
  }));

test("with an ingest token configured, only the matching token is accepted", () =>
  withRelay({ ingestToken: "s3cret-token" }, async ({ httpUrl, wsUrl }) => {
    const client = await readyClient(wsUrl());

    assert.equal((await post(httpUrl(), samplePayload())).status, 401);
    assert.equal((await post(httpUrl(), samplePayload(), { [TOKEN_HEADER]: "wrong" })).status, 401);
    assert.equal((await post(httpUrl(), samplePayload(), { [TOKEN_HEADER]: "s3cret-token" })).status, 202);

    assert.equal((await client.next()).type, "detections");
    await delay(50);
    assert.equal(client.pending(), 0, "rejected posts must not be broadcast");
  }));

test("validatePayload and stripConfidence handle the edge cases directly", () => {
  assert.equal(validatePayload(null), "body must be a JSON object");
  assert.equal(validatePayload(samplePayload()), null);
  assert.equal(validatePayload(samplePayload({ detections: [] })), null);

  const input = samplePayload({ detections: [{ label: "mold", box: [0, 0, 1, 1], confidence: 0.1 }] });
  const output = stripConfidence(input);
  assert.equal("confidence" in output.detections[0], false);
  assert.equal(input.detections[0].confidence, 0.1, "the input is not mutated");
});
