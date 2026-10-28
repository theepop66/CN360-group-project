import { WebSocket } from "ws";

import { createRelay } from "../lib/relay.mjs";

// Starts a relay on a free port. The heartbeat is long by default so it does
// not interfere with tests that are not about it.
export async function startRelay(options = {}) {
  const relay = createRelay({ heartbeatMs: 60_000, ...options });
  const { port } = await relay.listen(0, "127.0.0.1");
  const base = `127.0.0.1:${port}`;
  return {
    relay,
    httpUrl: (path = "/detections") => `http://${base}${path}`,
    wsUrl: (path = "/detections") => `ws://${base}${path}`
  };
}

// A WebSocket client that records every message, so a test can wait for the
// next one without racing the event that delivers it.
export function connectClient(url, options = {}) {
  const ws = new WebSocket(url, options);
  const messages = [];
  const waiters = [];

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8"));
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });

  const opened = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const closed = new Promise((resolve) => ws.once("close", resolve));

  return {
    ws,
    opened,
    closed,
    next(timeoutMs = 1000) {
      if (messages.length) return Promise.resolve(messages.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no message arrived")), timeoutMs);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    pending() {
      return messages.length;
    }
  };
}

// Connects and consumes the {"type":"connected"} greeting.
export async function readyClient(url, options) {
  const client = connectClient(url, options);
  await client.opened;
  const greeting = await client.next();
  if (greeting.type !== "connected") throw new Error(`unexpected greeting ${JSON.stringify(greeting)}`);
  return client;
}

export function post(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

export function samplePayload(overrides = {}) {
  return {
    type: "detections",
    coordinateSpace: "pixels",
    status: "complete",
    reason: null,
    timestamp: "2026-08-23T12:00:00.000Z",
    frame: { id: "session-a:7", sessionId: "session-a", sequence: 7, width: 1920, height: 1080 },
    snapshotUrl: null,
    detections: [{ label: "mold", box: [100, 200, 300, 400], status: "reject" }],
    ...overrides
  };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
