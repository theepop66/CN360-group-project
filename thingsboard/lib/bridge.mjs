import { createServer } from "node:http";
import { inspectionEvent } from "./events.mjs";

export function createBridge({ store, origin, deviceToken, probes = {}, fetchImpl = fetch,
  publishIntervalMs = 1000, healthIntervalMs = 10000, requestTimeoutMs = 2000, clock = Date.now }) {
  let draining; let polling; let timer; let healthTimer; let lastDeliveryAt = null; let deliveryError = null;
  let health = {}; let stopped = false; let lastHealthDeliveryAt = null;
  const endpoint = new URL(`/api/v1/${encodeURIComponent(deviceToken)}/telemetry`, origin).href;
  async function publish(payload) {
    const response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!response.ok) throw new Error(`ThingsBoard HTTP ${response.status}`);
    lastDeliveryAt = clock(); deliveryError = null;
  }
  function drain() {
    if (draining) return draining;
    draining = (async () => {
      for (const row of store.pending()) {
        if (stopped) break;
        try { await publish(JSON.parse(row.payload)); store.delivered(row.id); }
        catch { deliveryError = "ThingsBoard unavailable; monitoring records retained locally"; break; }
      }
    })().finally(() => { draining = null; });
    return draining;
  }
  function pollHealth() {
    if (polling) return polling;
    polling = (async () => {
      const results = await Promise.all(Object.entries(probes).map(async ([name, url]) => {
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
          const body = await response.json();
          return [name, response.ok && (body.ok === true || ["ok", "ready", "healthy", "success"].includes(body.status))];
        } catch { return [name, false]; }
      }));
      health = Object.fromEntries(results);
      const values = { bridge_heartbeat: clock(), pending_events: store.status().pending,
        ...Object.fromEntries(results.map(([name, ok]) => [`${name}_healthy`, ok])),
        system_healthy: results.length > 0 && results.every(([, ok]) => ok) };
      try { await publish({ ts: clock(), values }); lastHealthDeliveryAt = clock(); }
      catch { deliveryError = "ThingsBoard unavailable; monitoring records retained locally"; }
    })().finally(() => { polling = null; });
    return polling;
  }
  const server = createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/health") {
      reply(200, { status: "ok", ...store.status(), lastDeliveryAt, lastHealthDeliveryAt, deliveryError, devices: health, healthIntervalMs }); return;
    }
    if (req.method === "GET" && req.url === "/reviews") { reply(200, { pending: store.reviews(), reviewed: store.reviews("reviewed") }); return; }
    if (req.method !== "POST" || !["/events", "/reviews"].includes(req.url)) { reply(404, { error: "not_found" }); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) { reply(413, { error: "event_too_large" }); return; }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (req.url === "/reviews") {
        try { reply(200, store.completeReview(input.eventId, input)); }
        catch (error) { reply(400, { error: error.message }); }
        return;
      }
      const event = inspectionEvent(input);
      const saved = store.enqueue(event);
      reply(202, { status: "stored", eventId: event.id, ...saved });
      void drain();
    } catch (error) {
      const badInput = error instanceof SyntaxError || /Invalid|Missing/.test(error.message);
      reply(badInput ? 400 : 503, { error: badInput ? error.message : "monitoring_storage_unavailable" });
    }
  });
  return {
    server, drain, pollHealth,
    async listen(port = 8106, host = "0.0.0.0") {
      await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, host, accept); });
      timer = setInterval(() => { void drain(); }, publishIntervalMs);
      healthTimer = setInterval(() => { void pollHealth(); }, healthIntervalMs);
      void drain(); void pollHealth();
      return server.address();
    },
    async close() {
      stopped = true; clearInterval(timer); clearInterval(healthTimer);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await Promise.all([draining, polling]);
    }
  };
}
