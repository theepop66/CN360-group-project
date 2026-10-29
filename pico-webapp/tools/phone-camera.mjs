import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_BYTES = 512 * 1024;
const MAX_PIXELS = 1920 * 1080;
const STALE_MS = 2000;
const LEASE_MS = 10000;
const MAX_VIEWERS = 8;

function matches(actual, expected) {
  const a = Buffer.from(actual ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Read dimensions from the encoded JPEG, rather than trusting client headers.
export function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    if (offset + 3 > bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 && width * height <= MAX_PIXELS ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function reply(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readImage(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("image_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createPhoneCamera({ pairingCode = randomBytes(12).toString("hex"), now = Date.now } = {}) {
  let publisher = null;
  let frame = null;
  let uploads = 0;
  const viewers = new Set();
  const fresh = () => frame && now() - frame.capturedMs <= STALE_MS;
  const clear = () => {
    frame = null;
    for (const res of viewers) res.end();
    viewers.clear();
  };
  const frameHeaders = (image) => ({
    "X-Camera-Session": image.sessionId,
    "X-Frame-Sequence": String(image.sequence),
    "X-Captured-At": new Date(image.capturedMs).toISOString(),
    "X-Frame-Width": String(image.width),
    "X-Frame-Height": String(image.height)
  });
  const writeFrame = (res, image) => {
    if (res.writableNeedDrain || res.destroyed) return;
    const headers = { "Content-Type": "image/jpeg", "Content-Length": image.bytes.length, ...frameHeaders(image) };
    res.write(Buffer.concat([
      Buffer.from("--frame\r\n" + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n"),
      image.bytes, Buffer.from("\r\n")
    ]));
  };
  const timer = setInterval(() => { if (frame && !fresh()) clear(); }, 250);
  timer.unref();

  async function handle(req, res, pathname) {
    const bearer = req.headers.authorization;
    if (pathname === "/phone-camera/session" && req.method === "POST") {
      req.resume();
      if (!matches(bearer, `Bearer ${pairingCode}`)) return reply(res, 401, { error: "invalid_pairing_code" });
      if (publisher && now() - publisher.lastSeen < LEASE_MS) return reply(res, 409, { error: "camera_in_use_stop_other_sender_or_wait_10s" });
      clear();
      publisher = { sessionId: randomUUID(), token: randomBytes(24).toString("hex"), lastSeen: now(), sequence: 0 };
      return reply(res, 201, { sessionId: publisher.sessionId, token: publisher.token, serverTime: now() });
    }
    if (pathname === "/phone-camera/frame" || pathname === "/phone-camera/session") {
      if (!publisher || !matches(bearer, `Bearer ${publisher.token}`)) { req.resume(); return reply(res, 401, { error: "sender_session_expired" }); }
      const owner = publisher;
      if (pathname.endsWith("session") && req.method === "DELETE") {
        req.resume(); clear(); publisher = null; return reply(res, 200, { stopped: true });
      }
      if (req.method !== "POST" || !pathname.endsWith("frame")) { req.resume(); return reply(res, 405, { error: "method_not_allowed" }); }
      if (req.headers["content-type"] !== "image/jpeg") { req.resume(); return reply(res, 415, { error: "jpeg_required" }); }
      if (Number(req.headers["content-length"]) > MAX_BYTES) { req.resume(); return reply(res, 413, { error: "image_too_large" }); }
      if (uploads >= 2) { req.resume(); return reply(res, 429, { error: "too_many_uploads" }); }
      let bytes;
      uploads++;
      const timeout = setTimeout(() => req.destroy(), 4000);
      try { bytes = await readImage(req); }
      catch (error) { if (!res.destroyed) reply(res, error.message === "image_too_large" ? 413 : 400, { error: "image_upload_failed" }); return; }
      finally { uploads--; clearTimeout(timeout); }
      // Ownership and ordering must be rechecked after the asynchronous body read.
      const sequence = Number(req.headers["x-frame-sequence"]);
      const capturedMs = Number(req.headers["x-captured-at-ms"]);
      if (publisher !== owner || now() - owner.lastSeen >= LEASE_MS) return reply(res, 409, { error: "sender_session_expired" });
      if (!Number.isSafeInteger(sequence) || sequence <= owner.sequence) return reply(res, 409, { error: "out_of_order_frame" });
      if (!Number.isSafeInteger(capturedMs) || capturedMs > now() + 250 || now() - capturedMs > STALE_MS || (frame && capturedMs < frame.capturedMs)) return reply(res, 409, { error: "stale_frame" });
      const dimensions = jpegDimensions(bytes);
      if (!dimensions) return reply(res, 422, { error: "invalid_jpeg_or_dimensions" });
      frame = { bytes, ...dimensions, sessionId: owner.sessionId, sequence, capturedMs };
      owner.sequence = sequence; owner.lastSeen = now();
      for (const viewer of viewers) writeFrame(viewer, frame);
      return reply(res, 200, { accepted: true, sequence });
    }
    if (req.method !== "GET") { req.resume(); return reply(res, 405, { error: "method_not_allowed" }); }
    if (pathname === "/phone-camera/health" || pathname === "/health") return reply(res, fresh() ? 200 : 503, {
      status: fresh() ? "ok" : "unavailable", camera: { source: "iphone", sessionId: publisher?.sessionId ?? null, sequence: frame?.sequence ?? null }
    });
    if (!fresh()) return reply(res, 503, { error: "no_fresh_phone_frame" });
    if (pathname === "/capture") {
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": frame.bytes.length, "Cache-Control": "no-store", ...frameHeaders(frame) });
      return res.end(frame.bytes);
    }
    if (pathname === "/phone-camera/stream.mjpg") {
      if (viewers.size >= MAX_VIEWERS) return reply(res, 503, { error: "too_many_viewers" });
      res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=frame", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      viewers.add(res); res.once("close", () => viewers.delete(res));
      writeFrame(res, frame);
      return;
    }
    return reply(res, 404, { error: "not_found" });
  }
  const routes = new Set(["/phone-camera/session", "/phone-camera/frame", "/phone-camera/health", "/phone-camera/stream.mjpg", "/capture", "/health"]);
  return {
    pairingCode,
    handle(req, res, pathname) {
      if (!routes.has(pathname)) return false;
      void handle(req, res, pathname).catch(() => { if (!res.headersSent) reply(res, 500, { error: "camera_error" }); else res.destroy(); });
      return true;
    },
    close() { clearInterval(timer); clear(); publisher = null; }
  };
}
