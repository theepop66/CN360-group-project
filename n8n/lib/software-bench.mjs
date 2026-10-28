import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, sep, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

// Test-picture transport and a PC host for the actual firmware core. No model
// responses or controller decisions are invented by this service.
export async function startSoftwareBench({ controller, picture, hudDirectory,
  port = 8104, n8nOrigin = "http://127.0.0.1:5680", publicOrigin,
  relayWebSocket = "ws://127.0.0.1:8081/detections", modelProfile = "controlled", configureModel, fetchImpl = fetch }) {
  if (!["controlled", "native"].includes(modelProfile)) throw new Error("Unknown software model profile");
  const modelLabel = modelProfile === "controlled" ? "controlled model responses" : "native model";
  if (!Buffer.isBuffer(picture.bytes) || !picture.bytes.length ||
      !Number.isInteger(picture.width) || picture.width <= 0 || !Number.isInteger(picture.height) || picture.height <= 0) {
    throw new Error("A prepared JPEG with positive dimensions is required");
  }
  let visibleOrigin = publicOrigin ?? `http://127.0.0.1:${port}`;
  const cameraSession = randomUUID();
  const controllerSession = "pc-" + randomUUID();
  const started = performance.now();
  const clock = () => Math.floor(performance.now() - started);
  let sequence = 0;
  let present = false;
  let busy = false;
  let state = await controller.reset(controllerSession, clock(), true);
  let tick;
  let controllerError;
  const timer = setInterval(() => {
    if (tick || controllerError) return;
    tick = controller.step(clock(), present).then(value => { state = value; })
      .catch(error => { controllerError = error.message; }).finally(() => { tick = null; });
  }, 10);
  const root = resolve(hudDirectory);
  const server = createServer(async (req, res) => {
    const reply = (status, body, type = "application/json") => {
      if (res.destroyed) return;
      res.writeHead(status, { "content-type": type, "cache-control": "no-store",
        "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS" });
      res.end(type === "application/json" && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
    };
    try {
      const url = new URL(req.url, visibleOrigin);
      if (req.method === "OPTIONS") { reply(204, "", "text/plain"); return; }
      if (req.method === "GET" && ["/capture", "/frame.jpg"].includes(url.pathname)) {
        if (url.pathname === "/capture") sequence++;
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store",
          "access-control-allow-origin": "*", "X-Camera-Session": cameraSession,
          "X-Frame-Sequence": String(sequence), "X-Captured-At": new Date().toISOString(),
          "X-Frame-Width": String(picture.width), "X-Frame-Height": String(picture.height) });
        res.end(picture.bytes); return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        reply(controllerError ? 503 : 200, { status: controllerError ? "error" : "ok",
          profile: "test-pictures-pc-controller", modelProfile, hardware: false, camera_session: cameraSession,
          width: picture.width, height: picture.height }); return;
      }
      if (req.method === "GET" && url.pathname === "/status") {
        reply(controllerError ? 503 : 200, { ...state, status: controllerError ? "error" : "ok",
          error: controllerError ?? null, hardware: false, mode: "auto", profile: "pc-controller" }); return;
      }
      if (req.method === "GET" && url.pathname === "/hud/config.js") {
        reply(200, "window.HUD_CONFIG = Object.freeze(" + JSON.stringify({ cameraSource: "remote",
          raspberryPiStreamUrl: visibleOrigin + "/frame.jpg", raspberryPiHealthUrl: visibleOrigin + "/health",
          n8nDetectionWebSocketUrl: relayWebSocket, n8nPromptWebhookUrl: visibleOrigin + "/prompt",
          controlUnitServoUrl: visibleOrigin + "/servo", controlUnitModeUrl: visibleOrigin + "/mode",
          reconnectDelayMs: 500, healthPollIntervalMs: 2000, healthRequestTimeoutMs: 1500,
          detectionTtlMs: 3000, promptTimeoutMs: 8000, servoRequestTimeoutMs: 5000 }) + ");\n",
        "text/javascript"); return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/hud/")) {
        const path = resolve(root, decodeURIComponent(url.pathname.slice(5)) || "index.html");
        if (!path.startsWith(root + sep)) { reply(403, { error: "invalid_path" }); return; }
        let data = await readFile(path);
        if (path === resolve(root, "index.html")) data = Buffer.from(data.toString().replace("<body>",
          `<body><p style="padding:8px;background:#fff2cc;color:#222">Software test: ${modelLabel}, saved picture and PC controller. No physical hardware.</p>`));
        const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
        reply(200, data, types[extname(path)] ?? "application/octet-stream"); return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        reply(200, `<!doctype html><meta charset="utf-8"><title>CN360 software test</title>
<h1>CN360 software test</h1><p>Saved picture · ${modelLabel} · controller running on this PC · no physical hardware</p>
${modelProfile === "controlled" ? '<label>Test response <select id="scenario"><option value="reject">Reject example</option><option value="pass">Pass example</option><option value="error">Model error</option><option value="timeout">Model timeout</option></select></label>' : ''}
<p><a href="/hud/" target="_blank">Open inspection display</a></p><button id="inspect">Inspect a test item</button>
<pre id="result">Ready</pre><script>document.querySelector('#inspect').onclick=async()=>{const b=document.querySelector('#inspect');b.disabled=true;try{const scenario=document.querySelector('#scenario');if(scenario)await fetch('/bench/model',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:scenario.value})});const r=await fetch('/bench/item',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});document.querySelector('#result').textContent=JSON.stringify(await r.json(),null,2);}catch(e){document.querySelector('#result').textContent=e.message;}finally{b.disabled=false;}};</script>`, "text/html"); return;
      }
      if (req.method !== "POST" || !["/verdict", "/bench/item", "/bench/admit", "/bench/model", "/prompt"].includes(url.pathname)) {
        reply(404, { error: "not_available_in_software_profile" }); return;
      }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 65536) { reply(413, { error: "body_too_large" }); return; } chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
      catch { reply(400, { error: "invalid_json" }); return; }
      if (!body || typeof body !== "object" || Array.isArray(body)) { reply(400, { error: "object_body_required" }); return; }
      if (url.pathname === "/bench/model") {
        if (modelProfile !== "controlled" || !configureModel) { reply(409, { error: "controlled_model_required" }); return; }
        if (!["pass", "reject", "error", "timeout", "offline"].includes(body.scenario)) { reply(400, { error: "invalid_scenario" }); return; }
        configureModel(body.scenario); reply(200, { modelProfile, scenario: body.scenario, synthetic: true }); return;
      }
      if (url.pathname === "/verdict") {
        const receipt = await controller.verdict(body, clock());
        state = await controller.step(clock(), present);
        reply(receipt.httpStatus, receipt.body); return;
      }
      if (url.pathname === "/prompt") {
        const response = await fetchImpl(n8nOrigin + "/webhook/detection-prompt", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000) });
        reply(response.status, await response.json()); return;
      }
      if (busy || controllerError || !state.admission_ready) {
        reply(409, { error: "controller_not_ready", state }); return;
      }
      busy = true;
      try {
        present = false; await controller.step(clock(), false);
        present = true; await controller.step(clock(), true);
        await delay(40);
        state = await controller.step(clock(), true);
        if (state.state !== "awaiting_verdict") { reply(409, { error: "item_not_admitted", state }); return; }
        const item = state.active_item;
        if (url.pathname === "/bench/admit") { reply(201, { item, hardware: false }); return; }
        const response = await fetchImpl(n8nOrigin + "/webhook/item-detected", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...item, ...(typeof body.inspectionTarget === "string" ? { inspectionTarget: body.inspectionTarget } : {}) }),
          signal: AbortSignal.timeout(15000) });
        reply(response.status, { inspection: await response.json(), item, hardware: false });
      } finally { present = false; busy = false; }
    } catch (error) { reply(error.code === "ENOENT" ? 404 : 502, { error: error.message }); }
  });
  try { await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "0.0.0.0", accept); }); }
  catch (error) { clearInterval(timer); await tick; await controller.close(); throw error; }
  if (!publicOrigin) visibleOrigin = `http://127.0.0.1:${server.address().port}`;
  return { origin: `http://127.0.0.1:${server.address().port}`, controllerSession,
    async close() { clearInterval(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tick; await controller.close(); } };
}
