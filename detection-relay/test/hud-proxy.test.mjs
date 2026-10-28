import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { attachDetectionRelay } from "../../pico-webapp/tools/hud-server.mjs";
import { startRelay, connectClient, post } from "./helpers.mjs";
test("same-origin HUD socket receives actual relay frames and heartbeat without replay", async t => {
  const { relay, httpUrl } = await startRelay({ heartbeatMs: 50 });
  const server = createServer((_req, res) => res.end("HUD"));
  const detach = attachDetectionRelay(server, { relayOrigin: httpUrl("") });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const clients = [];
  t.after(async () => { for (const c of clients) c.ws.terminate(); detach(); await new Promise(r => server.close(r)); await relay.close(); });
  const url = `ws://127.0.0.1:${server.address().port}/detections`;
  const first = connectClient(url); clients.push(first); await first.opened;
  assert.equal((await first.next()).type, "connected");
  const payload = { type: "detections", frame: { sessionId: "session", sequence: 1, width: 640, height: 480 }, detections: [{ label: "scratch", box: [10, 20, 30, 40] }] };
  assert.equal((await post(httpUrl(), payload)).status, 202);
  let received;
  do { received = await first.next(); } while (received.type === "heartbeat");
  assert.deepEqual(received, payload);
  const second = connectClient(url); clients.push(second); await second.opened;
  assert.equal((await second.next()).type, "connected");
  assert.equal((await second.next()).type, "heartbeat", "reconnect must not receive an old frame");
});

test("relay proxy rejects unrelated upgrade routes", async t => {
  const server = createServer(); const detach = attachDetectionRelay(server);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(async () => { detach(); await new Promise(r => server.close(r)); });
  const client = connectClient(`ws://127.0.0.1:${server.address().port}/other`);
  await assert.rejects(client.opened, /404/);
});

test("browser reset during a stalled relay handshake leaves the HUD server available", async t => {
  const upstream = createServer(); const upstreamSockets = new Set();
  upstream.on("connection", socket => { upstreamSockets.add(socket); socket.on("error", () => {}); socket.on("close", () => upstreamSockets.delete(socket)); });
  const pending = new Promise(resolve => upstream.once("upgrade", resolve));
  await new Promise(r => upstream.listen(0, "127.0.0.1", r));
  const server = createServer((_req, res) => res.end("HUD still available"));
  const detach = attachDetectionRelay(server, { relayOrigin: `http://127.0.0.1:${upstream.address().port}` });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(async () => { detach(); for (const s of upstreamSockets) s.destroy(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => upstream.close(r))]); });
  const client = connect(server.address().port, "127.0.0.1");
  client.on("error", () => {});
  await new Promise(r => client.once("connect", r));
  client.write("GET /detections HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
  await pending; client.resetAndDestroy(); await delay(50);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await response.text(), "HUD still available");
});

test("unreachable relay fails the channel without taking down HTTP", async t => {
  const upstream = createServer(); await new Promise(r => upstream.listen(0, "127.0.0.1", r));
  const port = upstream.address().port; await new Promise(r => upstream.close(r));
  const server = createServer((_req, res) => res.end("HUD"));
  const detach = attachDetectionRelay(server, { relayOrigin: `http://127.0.0.1:${port}` });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(async () => { detach(); await new Promise(r => server.close(r)); });
  const client = connectClient(`ws://127.0.0.1:${server.address().port}/detections`);
  await assert.rejects(client.opened, /502/);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/`)).status, 200);
});
