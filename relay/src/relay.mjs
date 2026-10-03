// Detection relay: stock n8n cannot hold a WebSocket open, so it POSTs each
// HUD message to this service's HTTP ingest, and every connected Pico 4 HUD
// receives it over a WebSocket on the same path.
//
// Messages are validated with the HUD's own parsers (imported from
// pico-webapp, not copied) so the relay and the HUD can never disagree about
// what a valid message is.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

import { normalizeOrigin } from "./config.mjs";

import { hasDetectionFields, parseDetectionPayload } from "../../pico-webapp/js/overlay.js";
import { parseCameraMessage } from "../../pico-webapp/js/camera-message.js";

const RESERVED_TYPES = new Set(["heartbeat", "ping", "connected"]);
// HUDs never send anything meaningful upstream; keep inbound frames tiny.
const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

export class RelayRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Returns the message kind, or throws RelayRequestError(400) for anything the
// HUD would drop or misread. Plain objects with no detection fields are
// rejected on purpose: the HUD parser treats them as "zero detections" and
// would wipe a live overlay.
export function classifyMessage(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RelayRequestError(400, "Message must be a JSON object.");
  }
  if (RESERVED_TYPES.has(payload.type)) {
    throw new RelayRequestError(400, `Message type "${payload.type}" is reserved for the relay.`);
  }

  let camera;
  let detections;
  try {
    camera = parseCameraMessage(payload);
    if (camera?.kind === "source") return "camera.source";

    if (hasDetectionFields(payload)) detections = parseDetectionPayload(payload);
  } catch (error) {
    throw new RelayRequestError(400, error.message);
  }

  if (detections) return "detections";
  if (camera?.kind === "frame") return "camera.frame";
  throw new RelayRequestError(
    400,
    'Unrecognized message: expected type "detections", "camera.source", or "camera.frame".'
  );
}

function tokensMatch(header, token) {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendJson(response, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(text);
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new RelayRequestError(413, `Body exceeds ${limit} bytes.`));
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(new RelayRequestError(413, `Body exceeds ${limit} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function pathnameOf(request) {
  try {
    return new URL(request.url ?? "/", "http://relay.invalid").pathname;
  } catch {
    return null;
  }
}

function rejectUpgrade(socket, status, reason) {
  if (socket.writable) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  socket.destroy();
}

const silentLogger = { info() {}, warn() {}, error() {} };

export function createRelay(config, { logger = silentLogger, now = () => new Date() } = {}) {
  const stats = {
    startedAt: now().toISOString(),
    received: 0,
    relayed: 0,
    rejected: 0,
    droppedSlowClients: 0,
    lastMessageAt: null
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });

  function broadcast(text) {
    let delivered = 0;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > config.maxClientBufferBytes) {
        stats.droppedSlowClients += 1;
        logger.warn("Dropping a HUD that is not draining its socket.");
        client.terminate();
        continue;
      }
      client.send(text);
      delivered += 1;
    }
    return delivered;
  }

  async function handleIngest(request, response) {
    if (config.ingestToken && !tokensMatch(request.headers.authorization, config.ingestToken)) {
      throw new RelayRequestError(401, "Missing or invalid bearer token.");
    }
    const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      throw new RelayRequestError(415, "Content-Type must be application/json.");
    }

    const body = await readBody(request, config.maxBodyBytes);
    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new RelayRequestError(400, "Body is not valid JSON.");
    }

    const kind = classifyMessage(payload);
    const text = JSON.stringify(payload);
    const delivered = broadcast(text);
    stats.received += 1;
    stats.relayed += delivered;
    stats.lastMessageAt = now().toISOString();
    sendJson(response, 202, { accepted: true, kind, delivered });
  }

  // Only real WebSocket handshakes go to the upgrade handler. Without this a
  // POST offering "Upgrade: h2c" (curl --http2 does) was answered 405 by ws
  // and dropped. Node versions without this option ignore it.
  const serverOptions = {
    shouldUpgradeCallback: (request) => String(request.headers.upgrade ?? "").toLowerCase() === "websocket"
  };

  const server = http.createServer(serverOptions, async (request, response) => {
    const pathname = pathnameOf(request);

    try {
      if (pathname === "/health") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          throw new RelayRequestError(405, "Use GET.");
        }
        sendJson(response, 200, {
          status: "ok",
          clients: wss.clients.size,
          ...stats
        }, { "Access-Control-Allow-Origin": "*" });
        return;
      }

      if (pathname !== config.path) {
        throw new RelayRequestError(404, "Not found.");
      }
      if (request.method === "POST") {
        await handleIngest(request, response);
        return;
      }
      if (request.method === "GET") {
        throw new RelayRequestError(426, "Connect with a WebSocket to receive detections; POST to send one.");
      }
      throw new RelayRequestError(405, "Use POST to send or a WebSocket GET to receive.");
    } catch (error) {
      const status = error instanceof RelayRequestError ? error.status : 500;
      if (status === 500) logger.error(`Ingest failed: ${error.message}`);
      if (pathname === config.path && request.method === "POST") stats.rejected += 1;

      const headers = {};
      if (status === 405) headers.Allow = pathname === "/health" ? "GET, HEAD" : "GET, POST";
      if (status === 413) headers.Connection = "close";
      if (!response.headersSent) {
        sendJson(response, status, { accepted: false, error: error.message }, headers);
      }
      // A rejected oversized body is not drained; close instead of reading it.
      if (status === 413) response.on("finish", () => request.destroy());
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = pathnameOf(request);
    if (pathname !== config.path) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = request.headers.origin;
    if (config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(normalizeOrigin(origin ?? ""))) {
      logger.warn(`Refused a WebSocket from origin ${origin ?? "(none)"}.`);
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
  });

  wss.on("connection", (client, request) => {
    client.isAlive = true;
    client.on("pong", () => { client.isAlive = true; });
    // A HUD vanishing mid-write must not take the relay down.
    client.on("error", (error) => logger.warn(`HUD socket error: ${error.message}`));
    logger.info(`HUD connected from ${request.socket.remoteAddress} (${wss.clients.size} connected).`);
    client.on("close", () => logger.info(`HUD disconnected (${wss.clients.size} connected).`));

    // Nothing is replayed on connect. A replayed camera.source looked
    // helpful, but the HUD treats every camera.source as a camera switch, so
    // each transport reconnect wiped the verdict, reset frame ordering and
    // overrode the camera the operator had just saved.
    client.send(JSON.stringify({
      type: "connected",
      heartbeatIntervalMs: config.heartbeatIntervalMs
    }));
  });

  const heartbeat = setInterval(() => {
    const text = JSON.stringify({ type: "heartbeat", at: now().toISOString() });
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        logger.warn("Dropping a HUD that missed its heartbeat.");
        client.terminate();
        continue;
      }
      client.isAlive = false;
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
        client.send(text);
      }
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref();

  function listen() {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      const onListening = () => {
        server.off("error", reject);
        resolve(server.address());
      };
      if (config.host) {
        server.listen(config.port, config.host, onListening);
      } else {
        server.listen(config.port, onListening);
      }
    });
  }

  function close() {
    clearInterval(heartbeat);
    for (const client of wss.clients) client.close(1001, "Relay shutting down");
    return new Promise((resolve) => {
      // ws waits for every client to finish the close handshake; a HUD that
      // never answers must not hold the shutdown open.
      const force = setTimeout(() => {
        for (const client of wss.clients) client.terminate();
      }, 1000);
      force.unref();
      wss.close(() => {
        clearTimeout(force);
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    });
  }

  return {
    server,
    listen,
    close,
    broadcast,
    stats: () => ({ ...stats, clients: wss.clients.size })
  };
}
