#!/usr/bin/env node
// Dev-only server for the PICO HUD. It serves pico-webapp/ and proxies the
// 360ControlUnit (ESP32) endpoints under /esp on the *same origin*, so the
// HUD can run over HTTPS (required for WebXR) without tripping mixed-content
// blocking on the plain-HTTP actuator.
//
//   node tools/hud-server.mjs --http-port 8080 --https-port 8443 \
//     --cert tools/dev-cert.pem --key tools/dev-key.pem
//
// Node built-ins only; nothing to install. The HTTP listener keeps the flat
// 2D HUD usable, the HTTPS listener is what the PICO needs for VR cinema.
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPhoneCamera } from "./phone-camera.mjs";
import { attachWebRtcSignaling } from "./webrtc-signal.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CONTROL_UNIT = "http://172.20.10.5";
const PROXY_TIMEOUT_MS = 8000;
const DEFAULT_N8N_ORIGIN = "http://127.0.0.1:5678";
// The one n8n webhook the HUD may trigger. Taking a photo is an unpaired inspect-now: n8n
// evaluates a fresh frame and never sends a physical command.
const INSPECT_PATH = "/n8n/inspect-now";
const INSPECT_UPSTREAM_PATH = "/webhook/inspect-now";
// n8n answers once the model has decided (about a 2.5 s budget); the HUD client waits 15 s.
const INSPECT_TIMEOUT_MS = 12000;
const INSPECT_BODY_LIMIT = 4096;

const MIME_TYPES = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
}));

// Files that must never be exposed over the LAN, especially the TLS key.
const DENIED_DIRECTORIES = new Set(["tools", "tests", "node_modules", ".git"]);
const DENIED_PATHS = new Set(["/package.json", "/package-lock.json"]);

function parseArgs(argv) {
  const options = {
    httpPort: 0,
    httpsPort: 0,
    cert: "",
    key: "",
    controlUnit: DEFAULT_CONTROL_UNIT,
    relayOrigin: "http://127.0.0.1:8081",
    n8nOrigin: DEFAULT_N8N_ORIGIN,
    root: DEFAULT_ROOT
  };
  const names = new Map([
    ["--http-port", "httpPort"],
    ["--https-port", "httpsPort"],
    ["--cert", "cert"],
    ["--key", "key"],
    ["--control-unit", "controlUnit"],
    ["--relay-origin", "relayOrigin"],
    ["--n8n-origin", "n8nOrigin"],
    ["--phone-ca", "phoneCa"],
    ["--root", "root"]
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--phone-camera") { options.phoneCamera = true; continue; }
    const [flag, inlineValue] = argv[index].split("=", 2);
    const name = names.get(flag);
    if (!name) throw new Error(`Unknown argument: ${argv[index]}`);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (inlineValue === undefined) index += 1;
    options[name] = name.endsWith("Port") ? Number(value) : value;
  }

  return options;
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function resolveStaticPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (relative.includes(":")) return null;
  if (relative.split("/").some((segment) => segment.startsWith("."))) return null;
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function serveStatic(req, res, root, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Method not allowed");
  }
  let filePath = resolveStaticPath(root, pathname);
  if (!filePath) return sendText(res, 403, "Forbidden");

  // Check the decoded filesystem path, including Windows case/trailing-dot
  // aliases, so an encoded /tools URL cannot expose the TLS private key.
  const relativeParts = path.relative(root, filePath).split(path.sep)
    .map((part) => part.replace(/[. ]+$/g, "").toLowerCase());
  if (DENIED_DIRECTORIES.has(relativeParts[0]) ||
      DENIED_PATHS.has(`/${relativeParts.join("/")}`)) {
    return sendText(res, 404, "Not found");
  }

  let info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    info = await stat(filePath).catch(() => null);
  }
  if (!info?.isFile()) return sendText(res, 404, "Not found");

  const type = MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": info.size,
    "Cache-Control": "no-store"
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
}

function proxyToControlUnit(req, res, target, pathname, search) {
  let base;
  try {
    base = new URL(target);
  } catch {
    return sendText(res, 502, `Bad --control-unit URL: ${target}`);
  }

  const suffix = pathname.replace(/^\/esp/, "") || "/";
  const headers = {};
  for (const name of ["content-type", "content-length", "accept"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  const requestImpl = base.protocol === "https:" ? httpsRequest : httpRequest;
  const startedAt = Date.now();
  const proxyReq = requestImpl({
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port || (base.protocol === "https:" ? 443 : 80),
    method: req.method,
    path: `${suffix}${search}`,
    headers
  }, (proxyRes) => {
    const status = proxyRes.statusCode ?? 502;
    console.log(`[hud] ${req.method} ${pathname}${search} -> ${status} (${Date.now() - startedAt} ms)`);
    res.writeHead(status, {
      "Content-Type": proxyRes.headers["content-type"] ?? "application/json",
      "Cache-Control": "no-store"
    });
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => {
    proxyReq.destroy(new Error(`control unit timed out after ${PROXY_TIMEOUT_MS} ms`));
  });
  proxyReq.on("error", (error) => {
    console.error(`[hud] ${req.method} ${pathname} -> proxy error: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(504, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "control unit unreachable", detail: error.message }));
    } else {
      res.destroy();
    }
  });

  req.pipe(proxyReq);
}

// POST /n8n/inspect-now -> {n8nOrigin}/webhook/inspect-now. The HUD page may be HTTPS (WebXR),
// which cannot call n8n over plain HTTP directly, so the HUD server relays this one request.
//   - POST only, and only with a JSON content type: a cross-site form post or fetch from another
//     page then needs a CORS preflight, which this server never answers.
//   - The upstream body is always `{}`. The caller's body is read and dropped, so nobody can attach
//     a controller_session or item_id and turn the request into a paired one.
//   - One inspection at a time. A second one is refused (429) instead of queueing model runs.
function createInspectProxy(n8nOrigin) {
  let target = null;
  try {
    target = new URL(n8nOrigin);
  } catch {
    target = null;
  }
  if (!target || !["http:", "https:"].includes(target.protocol) || target.username || target.password ||
      target.pathname !== "/" || target.search || target.hash) {
    throw new Error("--n8n-origin must be an HTTP(S) origin without credentials or a path");
  }

  let inFlight = false;

  const reply = (res, status, body, headers = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };

  const forward = (res) => {
    const body = "{}";
    const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest;
    const startedAt = Date.now();
    let timedOut = false;

    const upstream = requestImpl({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: "POST",
      path: INSPECT_UPSTREAM_PATH,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        accept: "application/json"
      }
    }, (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      console.log(`[hud] POST ${INSPECT_PATH} -> ${status} (${Date.now() - startedAt} ms)`);
      res.writeHead(status, {
        "Content-Type": upstreamRes.headers["content-type"] ?? "application/json",
        "Cache-Control": "no-store"
      });
      upstreamRes.pipe(res);
    });

    // Take the slot only once the request exists, and keep it until the upstream request is
    // really over, even if the browser gave up.
    inFlight = true;
    upstream.once("close", () => { inFlight = false; });
    upstream.setTimeout(INSPECT_TIMEOUT_MS, () => {
      timedOut = true;
      upstream.destroy(new Error(`n8n timed out after ${INSPECT_TIMEOUT_MS} ms`));
    });
    upstream.on("error", (error) => {
      console.error(`[hud] POST ${INSPECT_PATH} -> proxy error: ${error.message}`);
      if (!res.headersSent) {
        reply(res, 504, { error: timedOut ? "n8n timed out" : "n8n unreachable", detail: error.message });
      } else {
        res.destroy();
      }
    });
    upstream.end(body);
  };

  return (req, res) => {
    if (req.method !== "POST") {
      req.resume();
      return reply(res, 405, { error: "method not allowed" }, { Allow: "POST" });
    }
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      req.resume();
      return reply(res, 415, { error: "content-type must be application/json" });
    }

    let received = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > INSPECT_BODY_LIMIT && !tooLarge) {
        tooLarge = true;
        reply(res, 413, { error: "request body too large" });
      }
    });
    req.on("error", () => {});
    req.on("end", () => {
      if (tooLarge) return;
      if (inFlight) {
        return reply(res, 429, { error: "an inspection is already running" }, { "Retry-After": "2" });
      }
      forward(res);
    });
  };
}

export function createHandler({ root, controlUnit, n8nOrigin = DEFAULT_N8N_ORIGIN, phoneCamera, phoneCaBytes }) {
  const inspectProxy = createInspectProxy(n8nOrigin);
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/phone-camera-ca.cer" && phoneCaBytes && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": "attachment; filename=cn360-phone-camera-ca.cer", "Cache-Control": "no-store" });
      return res.end(phoneCaBytes);
    }
    if (phoneCamera?.handle(req, res, url.pathname)) return;
    if (url.pathname === INSPECT_PATH) return inspectProxy(req, res);
    if (url.pathname === "/esp" || url.pathname.startsWith("/esp/")) {
      return proxyToControlUnit(req, res, controlUnit, url.pathname, url.search);
    }
    serveStatic(req, res, root, url.pathname).catch((error) => {
      console.error(`[hud] static error: ${error.message}`);
      if (!res.headersSent) sendText(res, 500, "Internal error");
      else res.destroy();
    });
  };
}

// Tunnel the fixed read-only channel through the HUD's HTTP/TLS listener.
// No browser cookies or credentials are forwarded to the relay.
export function attachDetectionRelay(server, { relayOrigin = "http://127.0.0.1:8081" } = {}) {
  const target = new URL(relayOrigin);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("--relay-origin must be an HTTP(S) origin without credentials or a path");
  }
  const sockets = new Set();
  const upgrade = (req, socket, head) => {
    // An upgraded browser can reset before the relay finishes its handshake.
    // Own its errors immediately, including rejected upgrade paths.
    socket.on("error", () => socket.destroy());
    if (req.method !== "GET" || req.url !== "/detections") return;
    const headers = { connection: "Upgrade", upgrade: "websocket" };
    for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest;
    const proxy = requestImpl(new URL("/detections", target), { headers, agent: false });
    sockets.add(socket); socket.once("close", () => { sockets.delete(socket); proxy.destroy(); });
    const fail = () => { if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); };
    proxy.setTimeout(3000, () => proxy.destroy(new Error("relay upgrade timeout")));
    proxy.once("error", fail);
    proxy.once("response", res => { res.resume(); fail(); });
    proxy.once("upgrade", (res, upstream, upstreamHead) => {
      proxy.setTimeout(0); sockets.add(upstream);
      upstream.once("close", () => { sockets.delete(upstream); socket.destroy(); });
      upstream.once("error", () => socket.destroy()); socket.once("error", () => upstream.destroy());
      socket.once("close", () => upstream.destroy());
      const responseHeaders = [];
      for (const name of ["upgrade", "connection", "sec-websocket-accept", "sec-websocket-protocol"]) {
        if (res.headers[name]) responseHeaders.push(`${name}: ${res.headers[name]}`);
      }
      socket.write("HTTP/1.1 101 Switching Protocols\r\n" + responseHeaders.join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(upstream).pipe(socket);
    });
    proxy.end();
  };
  server.on("upgrade", upgrade);
  const detach = () => { server.off("upgrade", upgrade); for (const socket of sockets) socket.destroy(); sockets.clear(); };
  server.once("close", detach);
  return detach;
}

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`${label} port ${port} is already in use. Stop the other server first.`));
      } else {
        reject(error);
      }
    });
    server.listen(port, "0.0.0.0", () => resolve());
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.phoneCamera) options.phoneCamera = createPhoneCamera();
  if (options.phoneCa) options.phoneCaBytes = readFileSync(options.phoneCa);
  const handler = createHandler(options);
  const addresses = lanAddresses();
  const started = [];

  if (options.httpPort > 0) {
    const server = createHttpServer(handler);
    attachDetectionRelay(server, options);
    attachWebRtcSignaling(server);
    await listen(server, options.httpPort, "HTTP");
    started.push(`HTTP  http://localhost:${options.httpPort}/`);
    for (const address of addresses) started.push(`      http://${address}:${options.httpPort}/`);
  }

  if (options.httpsPort > 0) {
    if (!options.cert || !options.key) {
      throw new Error("--https-port requires --cert and --key.");
    }
    const server = createHttpsServer({
      cert: readFileSync(options.cert),
      key: readFileSync(options.key)
    }, handler);
    attachDetectionRelay(server, options);
    attachWebRtcSignaling(server);
    await listen(server, options.httpsPort, "HTTPS");
    started.push(`HTTPS https://localhost:${options.httpsPort}/`);
    for (const address of addresses) started.push(`      https://${address}:${options.httpsPort}/`);
  }

  if (started.length === 0) throw new Error("Nothing to serve: pass --http-port and/or --https-port.");

  console.log("[hud] serving", options.root);
  console.log(`[hud] /esp/* -> ${options.controlUnit}`);
  console.log(`[hud] POST ${INSPECT_PATH} -> ${options.n8nOrigin}${INSPECT_UPSTREAM_PATH} (unpaired capture + inspection)`);
  console.log(`[hud] WebSocket /detections -> ${options.relayOrigin}/detections`);
  console.log("[hud] WebSocket /rtc -> WebRTC signaling (phone-to-VR peer-to-peer video)");
  for (const line of started) console.log(`[hud] ${line}`);
  console.log("[hud] open the PICO at the HTTPS address, e.g. https://<pc-ip>:8443/?xrdebug=1");
  if (options.phoneCamera) {
    console.log("[hud] iPhone: open HTTPS /phone-camera.html; PC/Pico HUD: /?camera=phone");
    console.log(`[hud] Phone pairing code (enter only on the iPhone): ${options.phoneCamera.pairingCode}`);
    console.log("[hud] n8n pull capture: HTTP /capture (same five frame-identity headers as Pi)");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[hud] ${error.message}`);
    process.exit(1);
  });
}
