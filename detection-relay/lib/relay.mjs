// The detection relay. n8n cannot hold WebSocket connections, so its
// broadcast-hud node POSTs each HUD payload here and the relay fans the same
// message out to every connected HUD.
//
// The relay is deliberately dumb: it checks the message is shaped like a
// detection payload, removes any confidence field, and forwards it. It never
// stores a frame, so a HUD that connects late sees nothing until the next
// inspection (no stale-frame replay).

import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

export const TOKEN_HEADER = "x-cn360-relay-token";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
// A HUD that stops reading would otherwise make the relay queue every frame
// for it in memory. Past this much unsent data the client is skipped.
const MAX_CLIENT_BUFFERED_BYTES = 1024 * 1024;
// HUDs only ever receive. Anything they send is ignored, so keep it tiny.
const MAX_CLIENT_MESSAGE_BYTES = 1024;

const SILENT_LOGGER = Object.freeze({ info() {}, warn() {} });

export function createRelay({
  path = "/detections",
  ingestToken = "",
  heartbeatMs = 15000,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  logger = SILENT_LOGGER
} = {}) {
  const tokenDigest = ingestToken ? digest(ingestToken) : null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.warn(`request failed: ${error.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
    });
  });
  let lastIngestAt = null;

  server.on("upgrade", (req, socket, head) => {
    if (pathnameOf(req) !== path) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("error", (error) => logger.warn(`client error: ${error.message}`));
    ws.on("close", () => logger.info(`HUD disconnected (${wss.clients.size} connected)`));
    // Lets the HUD tell "connected, waiting for a frame" apart from a dead
    // socket. The HUD parser ignores this type.
    ws.send(JSON.stringify({ type: "connected" }));
    logger.info(`HUD connected from ${req.socket.remoteAddress} (${wss.clients.size} connected)`);
  });

  const heartbeat = setInterval(() => {
    const message = JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() });
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        logger.info("dropping a HUD that missed a heartbeat");
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }, heartbeatMs);
  heartbeat.unref();

  async function handleRequest(req, res) {
    const pathname = pathnameOf(req);

    if (pathname === "/health") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
      return sendJson(res, 200, { ok: true, clients: wss.clients.size, lastIngestAt });
    }

    if (pathname !== path) return sendJson(res, 404, { error: "not_found" });
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });

    if (tokenDigest && !tokenMatches(req.headers[TOKEN_HEADER], tokenDigest)) {
      req.resume();
      return sendJson(res, 401, { error: "invalid_token" });
    }

    const body = await readBody(req, maxBodyBytes);
    if (body === null) return sendJson(res, 413, { error: "payload_too_large" }, { Connection: "close" });

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }

    const problem = validatePayload(payload);
    if (problem) return sendJson(res, 400, { error: "invalid_payload", detail: problem });

    lastIngestAt = new Date().toISOString();
    const delivered = broadcast(JSON.stringify(stripConfidence(payload)));
    return sendJson(res, 202, { delivered });
  }

  function broadcast(message) {
    let delivered = 0;
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > MAX_CLIENT_BUFFERED_BYTES) {
        logger.warn("skipping a HUD that is not keeping up");
        continue;
      }
      ws.send(message);
      delivered += 1;
    }
    return delivered;
  }

  return {
    server,
    get clientCount() {
      return wss.clients.size;
    },
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

// Returns a reason string when the payload is not something the HUD should
// receive, or null when it is fine to forward.
export function validatePayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return "body must be a JSON object";
  if (payload.type !== "detections") return 'type must be "detections"';
  // An empty array is valid: it is how a failed or clean inspection clears
  // the overlay, so it must still reach the HUD.
  if (!Array.isArray(payload.detections)) return "detections must be an array";
  if (!payload.detections.every(isPlainObject)) return "every detection must be an object";
  return null;
}

// Confidence is never shown on the HUD. n8n already omits it; this makes sure
// a future change upstream cannot leak it through.
export function stripConfidence(payload) {
  const { confidence: _ignored, ...rest } = payload;
  return {
    ...rest,
    detections: payload.detections.map(({ confidence: _dropped, ...detection }) => detection)
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathnameOf(req) {
  try {
    return new URL(req.url, "http://relay").pathname;
  } catch {
    return "";
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(header, expectedDigest) {
  if (typeof header !== "string" || header === "") return false;
  // Comparing fixed-length digests keeps the check constant-time regardless
  // of how long the supplied token is.
  return timingSafeEqual(digest(header), expectedDigest);
}

// Resolves to the body text, or null when it is larger than the limit.
function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(text);
}
