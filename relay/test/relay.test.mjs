import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";

import { readConfig } from "../src/config.mjs";
import { createRelay } from "../src/relay.mjs";
import { parseDetectionPayload } from "../../pico-webapp/js/overlay.js";
import { buildInspectionDecision, MODEL_SUCCESS_STATUS } from "../../n8n/lib/inspection-logic.mjs";
import { buildHudPayload } from "../../n8n/lib/inspection-records.mjs";

const FRAME = { sessionId: "s1", sequence: 7, capturedAt: "2026-08-23T12:00:00.000Z", width: 1920, height: 1080 };
const INSTRUCTION = "Locate all the instances that matches the following description: mold.";

async function startRelay(env = {}) {
  const relay = createRelay(readConfig({ RELAY_HOST: "127.0.0.1", RELAY_PORT: "0", ...env }));
  const { port } = await relay.listen();
  return { relay, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/detections` };
}

function connect(url, options) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url, options);
    const messages = [];
    const waiters = [];
    client.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(message); else messages.push(message);
    });
    client.next = () => messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((res) => waiters.push(res));
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

function post(base, body, headers = { "Content-Type": "application/json" }) {
  return fetch(`${base}/detections`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function n8nPayload(detections) {
  const decision = buildInspectionDecision({
    outcome: { kind: "ok", response: { status: MODEL_SUCCESS_STATUS, prompt_used: INSTRUCTION, detections } },
    frameContext: FRAME,
    instruction: INSTRUCTION
  });
  return buildHudPayload({ decision, frameContext: FRAME });
}

test("an n8n broadcast reaches a HUD and round-trips through the HUD parser", async () => {
  const { relay, base, ws } = await startRelay();
  const client = await connect(ws);
  try {
    assert.equal((await client.next()).type, "connected");
    const response = await post(base, n8nPayload([{ label: "mold", box: [100, 200, 300, 400], confidence: 0 }]));
    assert.equal(response.status, 202);
    assert.equal((await response.json()).delivered, 1);

    const parsed = parseDetectionPayload(await client.next());
    const [box] = parsed.detections;
    assert.deepEqual([box.x1, box.y1, box.x2, box.y2], [100, 200, 300, 400]);
  } finally {
    client.close();
    await relay.close();
  }
});

test("rejects bodies the HUD would drop or misread", async () => {
  const { relay, base } = await startRelay();
  try {
    assert.equal((await post(base, "{not json")).status, 400);
    assert.equal((await post(base, { hello: "world" })).status, 400);
    assert.equal((await post(base, { type: "heartbeat" })).status, 400);
    assert.equal((await post(base, { type: "detections", detections: [{ box: [5, 5, 1, 1] }] })).status, 400);
    assert.equal((await post(base, { type: "detections" }, { "Content-Type": "text/plain" })).status, 415);
  } finally {
    await relay.close();
  }
});

test("enforces the optional ingest token", async () => {
  const { relay, base } = await startRelay({ RELAY_INGEST_TOKEN: "secret" });
  try {
    const payload = n8nPayload([]);
    assert.equal((await post(base, payload)).status, 401);
    const ok = await post(base, payload, { "Content-Type": "application/json", Authorization: "Bearer secret" });
    assert.equal(ok.status, 202);
  } finally {
    await relay.close();
  }
});

test("refuses WebSocket upgrades on other paths", async () => {
  const { relay, base } = await startRelay();
  try {
    await assert.rejects(connect(`${base.replace("http", "ws")}/other`));
  } finally {
    await relay.close();
  }
});

test("a reconnecting HUD gets nothing replayed, so its camera choice and ordering survive", async () => {
  const { relay, base, ws } = await startRelay();
  try {
    const source = {
      type: "camera.source",
      camera: { mode: "mjpeg", streamUrl: "http://192.168.1.20:8000/stream.mjpg" }
    };
    assert.equal((await post(base, source)).status, 202);
    assert.equal((await post(base, n8nPayload([]))).status, 202);

    const late = await connect(ws);
    try {
      assert.equal((await late.next()).type, "connected");
      const nextOrNothing = await Promise.race([
        late.next(),
        new Promise((resolve) => setTimeout(() => resolve(null), 150))
      ]);
      assert.equal(nextOrNothing, null, "no camera.source or detection may be replayed");
    } finally {
      late.close();
    }
  } finally {
    await relay.close();
  }
});

test("a POST that offers an h2c upgrade is still handled as a POST", async () => {
  const { relay, base, ws } = await startRelay();
  const client = await connect(ws);
  try {
    await client.next();
    // fetch() refuses to send Connection/Upgrade itself, hence node:http.
    const body = JSON.stringify(n8nPayload([]));
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/detections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "Upgrade, HTTP2-Settings",
          Upgrade: "h2c",
          "HTTP2-Settings": "AAMAAABkAARAAAAAAAIAAAAA"
        }
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(status, 202);
    assert.equal((await client.next()).type, "detections");
  } finally {
    client.close();
    await relay.close();
  }
});

test("the relay and the HUD agree on which messages carry detections", async () => {
  const { relay, base } = await startRelay();
  try {
    const frame = { type: "camera.frame", snapshotUrl: "https://x.test/f.jpg" };
    const nullDetections = await post(base, { ...frame, detections: null });
    assert.equal(nullDetections.status, 202);
    assert.equal((await nullDetections.json()).kind, "detections");
    assert.equal((await post(base, { ...frame, boxes: "none" })).status, 400);
    const plainFrame = await post(base, frame);
    assert.equal((await plainFrame.json()).kind, "camera.frame");
  } finally {
    await relay.close();
  }
});

test("oversized bodies get 413 and the relay keeps serving", async () => {
  const { relay, base } = await startRelay({ RELAY_MAX_BODY_BYTES: "2048" });
  try {
    const big = n8nPayload([]);
    big.padding = "x".repeat(4096);
    assert.equal((await post(base, big)).status, 413);
    assert.equal((await post(base, n8nPayload([]))).status, 202);
  } finally {
    await relay.close();
  }
});

test("answers wrong methods and paths with the right status", async () => {
  const { relay, base } = await startRelay();
  try {
    assert.equal((await fetch(`${base}/detections`)).status, 426);
    assert.equal((await fetch(`${base}/detections`, { method: "PUT" })).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
  } finally {
    await relay.close();
  }
});

test("sends heartbeats and drops a HUD that never answers pings", async () => {
  const { relay, ws } = await startRelay({ RELAY_HEARTBEAT_MS: "1000" });
  try {
    const live = await connect(ws);
    assert.equal((await live.next()).type, "connected");
    assert.equal((await live.next()).type, "heartbeat");
    live.close();

    const dead = await connect(ws, { autoPong: false });
    const closed = new Promise((resolve) => dead.once("close", resolve));
    const outcome = await Promise.race([
      closed.then(() => "dropped"),
      new Promise((resolve) => setTimeout(() => resolve("still connected"), 3500))
    ]);
    assert.equal(outcome, "dropped");
  } finally {
    await relay.close();
  }
});

test("only allowed browser origins may subscribe when an allowlist is set", async () => {
  // Written the way an operator copies it from the address bar.
  const { relay, ws } = await startRelay({ RELAY_ALLOWED_ORIGINS: "http://HUD.test:8080/, http://other.test:80" });
  try {
    await assert.rejects(connect(ws, { origin: "http://evil.test" }));
    const ok = await connect(ws, { origin: "http://hud.test:8080" });
    ok.close();
    const defaultPort = await connect(ws, { origin: "http://other.test" });
    defaultPort.close();
  } finally {
    await relay.close();
  }
});

test("an unparseable allowed origin is refused at startup", () => {
  assert.throws(() => readConfig({ RELAY_ALLOWED_ORIGINS: "not a url" }), /invalid origin/);
});
