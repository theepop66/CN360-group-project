// Minimal WebRTC signaling relay over raw WebSocket (Node built-ins only).
// One sender at a time, any number of receivers.  All on the same LAN so
// STUN is enough; no TURN.  Attach to the same HTTP/HTTPS server that
// serves the HUD — the upgrade path is /rtc.
import { createHash } from "node:crypto";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB4A11B7CE5";
const OP_TEXT = 0x01;
const OP_CLOSE = 0x08;
const OP_PING = 0x09;
const OP_PONG = 0x0a;

function wsAcceptKey(key) {
  return createHash("sha1").update(key + WS_MAGIC).digest("base64");
}

function wsEncode(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | OP_TEXT;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | OP_TEXT;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | OP_TEXT;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsPong(pingPayload) {
  const len = pingPayload.length;
  const header = Buffer.allocUnsafe(2);
  header[0] = 0x80 | OP_PONG;
  header[1] = len;
  return Buffer.concat([header, pingPayload]);
}

function wsClose(code = 1000) {
  const buf = Buffer.allocUnsafe(4);
  buf[0] = 0x80 | OP_CLOSE;
  buf[1] = 2;
  buf.writeUInt16BE(code, 2);
  return buf;
}

class WsClient {
  constructor(socket, role) {
    this.socket = socket;
    this.role = role;
    this.buffer = Buffer.alloc(0);
    this.alive = true;
  }
  send(text) {
    if (this.alive) this.socket.write(wsEncode(text));
  }
  close(code = 1000) {
    if (this.alive) { this.alive = false; this.socket.write(wsClose(code)); this.socket.end(); }
  }
  feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const messages = [];
    while (this.buffer.length >= 2) {
      const frame = this._readFrame();
      if (frame === null) break;
      if (frame.opcode === OP_TEXT) messages.push(frame.payload.toString());
      else if (frame.opcode === OP_PING) this.socket.write(wsPong(frame.payload));
      else if (frame.opcode === OP_CLOSE) { this.close(); break; }
    }
    return messages;
  }
  _readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
    let offset = 2;
    if (payloadLen === 126) {
      if (buf.length < 4) return null;
      payloadLen = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buf.length < 10) return null;
      payloadLen = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    const totalLen = offset + maskLen + payloadLen;
    if (buf.length < totalLen) return null;
    const opcode = buf[0] & 0x0f;
    let payload = buf.subarray(offset + maskLen, totalLen);
    if (masked) {
      const mask = buf.subarray(offset, offset + maskLen);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    this.buffer = buf.subarray(totalLen);
    return { opcode, payload };
  }
}

export function attachWebRtcSignaling(server) {
  let sender = null;
  const receivers = new Set();
  const sockets = new Set();

  function remove(client) {
    sockets.delete(client);
    if (client === sender) {
      sender = null;
      for (const r of receivers) r.send(JSON.stringify({ type: "sender-left" }));
    }
    receivers.delete(client);
  }

  function handleMessage(client, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      if (msg.role === "sender") {
        if (sender && sender !== client) sender.close(4000);
        sender = client;
        for (const r of receivers) r.send(JSON.stringify({ type: "sender-ready" }));
        console.log("[rtc] sender joined");
      } else {
        receivers.add(client);
        if (sender) client.send(JSON.stringify({ type: "sender-ready" }));
        console.log(`[rtc] receiver joined (${receivers.size} total)`);
      }
      return;
    }

    if (client === sender) {
      const data = JSON.stringify(msg);
      for (const r of receivers) r.send(data);
    } else if (receivers.has(client) && sender) {
      sender.send(JSON.stringify(msg));
    }
  }

  function onUpgrade(req, socket, head) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/rtc") return;

    socket.on("error", () => socket.destroy());
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return; }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n\r\n`
    );

    const client = new WsClient(socket, null);
    sockets.add(client);
    if (head.length) {
      for (const text of client.feed(head)) handleMessage(client, text);
    }
    socket.on("data", (chunk) => {
      for (const text of client.feed(chunk)) handleMessage(client, text);
    });
    socket.on("close", () => remove(client));
    socket.on("error", () => remove(client));
  }

  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    for (const c of sockets) c.close();
    sockets.clear();
  };
}
