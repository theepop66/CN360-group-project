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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CONTROL_UNIT = "http://172.20.10.5";
const PROXY_TIMEOUT_MS = 8000;

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
    root: DEFAULT_ROOT
  };
  const names = new Map([
    ["--http-port", "httpPort"],
    ["--https-port", "httpsPort"],
    ["--cert", "cert"],
    ["--key", "key"],
    ["--control-unit", "controlUnit"],
    ["--root", "root"]
  ]);

  for (let index = 0; index < argv.length; index += 1) {
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

export function createHandler({ root, controlUnit }) {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
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
  const handler = createHandler(options);
  const addresses = lanAddresses();
  const started = [];

  if (options.httpPort > 0) {
    const server = createHttpServer(handler);
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
    await listen(server, options.httpsPort, "HTTPS");
    started.push(`HTTPS https://localhost:${options.httpsPort}/`);
    for (const address of addresses) started.push(`      https://${address}:${options.httpsPort}/`);
  }

  if (started.length === 0) throw new Error("Nothing to serve: pass --http-port and/or --https-port.");

  console.log("[hud] serving", options.root);
  console.log(`[hud] /esp/* -> ${options.controlUnit}`);
  for (const line of started) console.log(`[hud] ${line}`);
  console.log("[hud] open the PICO at the HTTPS address, e.g. https://<pc-ip>:8443/?xrdebug=1");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[hud] ${error.message}`);
    process.exit(1);
  });
}
