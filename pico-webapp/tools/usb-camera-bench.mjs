// Windows-only, camera-only bench. It reuses the current paired-JPEG camera
// and HUD without connecting to the ESP32 or changing any OS network settings.
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer, get as httpsGet } from "node:https";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { isIPv4 } from "node:net";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./hud-server.mjs";
import { createPhoneCamera } from "./phone-camera.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(tools, "..");
const powerShellCache = path.resolve(root, "..", ".scratch", "iphone-usb-camera", "powershell-path.txt");
const ipv4 = address => (address ?? "").replace(/^::ffff:/, "");

export function selectUsbAdapter(adapters, requestedIp) {
  const candidates = adapters.flatMap(adapter => {
    if (adapter.status !== "Up" || !/Apple.*(Ethernet|USB.*(Network|Adapter))/i.test(adapter.description)) return [];
    return (adapter.addresses ?? []).filter(address => isIPv4(address) &&
      !/^(127\.|169\.254\.|0\.)/.test(address)).map(address => ({ ...adapter, address }));
  }).filter(adapter => !requestedIp || adapter.address === requestedIp);
  if (!candidates.length) throw new Error("No active Apple USB network with an assigned IPv4 address. Install/open Apple Devices, connect and unlock iPhone, tap Trust, enable Personal Hotspot, then reconnect the data cable. Wi-Fi/VPN will not be used as fallback.");
  if (candidates.length > 1) throw new Error("Multiple Apple USB addresses found. Choose one with --ip <PC-USB-IP>.");
  return candidates[0];
}

const page = String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iPhone USB camera test</title><style>
body{margin:0;padding:16px;background:#07110f;color:#eafff5;font:16px system-ui}h1{font-size:22px}a{color:#68efb3}
#status{padding:12px;background:#12271e;border-radius:8px;white-space:pre-line}iframe{width:100%;height:75vh;border:1px solid #315846;margin-top:16px}
</style><h1>iPhone → USB → Windows HUD</h1>
<p id="status" role="status">Waiting for a fresh iPhone frame…</p>
<p><a href="/?camera=phone" target="_blank" rel="noopener">Open HUD</a> · <a href="/?camera=phone&amp;fit=contain" target="_blank" rel="noopener">Show full frame</a> · <a href="/capture" target="_blank" rel="noopener">Latest capture</a></p>
<p>Unplug Lightning: the feed must stop. Reconnect and start the phone sender again. This verifies the cable dependency.</p>
<iframe title="Live camera HUD" src="/?camera=phone"></iframe><script type="module">
const status=document.querySelector('#status');
async function refresh(){
try{
 const [diagnostics,health]=await Promise.all([fetch('/usb-bench/status',{cache:'no-store'}).then(r=>r.json()),fetch('/phone-camera/health',{cache:'no-store'})]);
 const camera=await health.json(); const frame=diagnostics.lastFrame;
 if(!health.ok||!frame?.fresh||camera.camera.sessionId!==frame.sessionId||camera.camera.sequence<frame.sequence){status.textContent='Waiting for a fresh iPhone frame. Open the phone sender and tap Start.';return;}
 const fps = frame.fps == null ? 'measuring FPS' : frame.fps.toFixed(1)+' FPS received';
 const age = 'Approx. '+frame.arrivalAgeMs+' ms from capture to PC';
 status.textContent=(frame.atUsbAddress?'Receiving at the Apple USB address':'Frame arrived through another address')+'\n'+frame.width+' × '+frame.height+' · Frame '+frame.sequence+' · '+frame.bytes+' bytes\n'+fps+' · '+age+'\nPhone '+frame.remoteAddress+' → PC '+frame.localAddress;
}catch{status.textContent='Camera test server is unreachable.';}finally{setTimeout(refresh,1000);}}
refresh();</script></html>`;

export function createUsbBenchHandler({ handler, usbAddress, now = Date.now }) {
  let lastFrame = null;
  let sessionId = null;
  let arrivals = [];
  return (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/usb-bench/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ usbAddress, lastFrame: lastFrame && { ...lastFrame, fresh: now() - lastFrame.capturedAtMs <= 2000 } }));
      return;
    }
    if (req.method === "GET" && pathname === "/usb-bench") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(page);
      return;
    }
    const publisherRequest = pathname === "/phone-camera/frame" || pathname === "/phone-camera/camera-state" ||
      (pathname === "/phone-camera/session" && ["POST", "DELETE"].includes(req.method));
    if (publisherRequest && ipv4(req.socket.localAddress) !== usbAddress) {
      req.resume?.();
      res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Open the phone sender at the PC Apple USB IP printed by the launcher." }));
      return;
    }
    if (publisherRequest) {
      // Use the dimensions and size already validated by the camera service.
      const originalEnd = res.end;
      res.end = function(body, ...args) {
        try {
          const result = JSON.parse(String(body));
          if (res.statusCode === 200 && result.accepted === true && result.frame && pathname.endsWith("/frame")) {
            const receivedAtMs = now();
            arrivals = arrivals.filter(time => time <= receivedAtMs && receivedAtMs - time <= 2000).slice(-59);
            arrivals.push(receivedAtMs);
            const elapsed = receivedAtMs - arrivals[0];
            lastFrame = { sessionId, sequence: result.sequence, ...result.frame, receivedAtMs,
              fps: elapsed >= 500 ? (arrivals.length - 1) * 1000 / elapsed : null,
              arrivalAgeMs: Math.max(0, receivedAtMs - result.frame.capturedAtMs),
              localAddress: ipv4(req.socket.localAddress), remoteAddress: ipv4(req.socket.remoteAddress),
              atUsbAddress: ipv4(req.socket.localAddress) === usbAddress };
          } else if (pathname.endsWith("/session") && [200, 201].includes(res.statusCode)) {
            lastFrame = null;
            sessionId = result.sessionId ?? null;
            arrivals = [];
          }
        } catch { /* Diagnostic observation must never break camera replies. */ }
        return originalEnd.call(this, body, ...args);
      };
    }
    handler(req, res);
  };
}

function windows(action, args = []) {
  const parameters = ["-NoProfile", "-NonInteractive", "-File", path.join(tools, "usb-camera-windows.ps1"), "-Action", action, ...args];
  const options = { encoding: "utf8", timeout: 20000, windowsHide: true };
  try {
    return execFileSync(process.env.CN360_PWSH ?? "pwsh", parameters, options);
  } catch (error) {
    if (error.code !== "ENOENT" || process.env.CN360_PWSH) throw error;
    // The app's official PowerShell runtime may be available to the agent but
    // absent from a normal terminal's PATH. Reuse a previously resolved path.
    let cached;
    try { cached = readFileSync(powerShellCache, "utf8").replace(/^\uFEFF/, "").trim(); } catch { /* First run. */ }
    if (!cached || cached.length > 4096 || !path.isAbsolute(cached) || path.basename(cached).toLowerCase() !== "pwsh.exe") {
      throw new Error("PowerShell 7.2+ was not found. Install PowerShell 7 or set CN360_PWSH to its full pwsh.exe path, then run the launcher again.");
    }
    return execFileSync(cached, parameters, options);
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => { server.removeListener("error", reject); resolve(); });
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    check: { type: "boolean" }, ip: { type: "string" }, "http-port": { type: "string", default: "8082" },
    "https-port": { type: "string", default: "8445" }, "state-dir": { type: "string" }
  } });
  if (process.platform !== "win32") throw new Error("This first bench targets Windows + iPhone + Lightning.");
  const snapshot = JSON.parse(windows("Inspect").replace(/^\uFEFF/, ""));
  const adapter = selectUsbAdapter(snapshot.adapters, values.ip);
  console.log(`[USB] ${adapter.name}: ${adapter.description} — PC ${adapter.address}`);
  if (values.check) return;
  if (path.isAbsolute(snapshot.powerShellPath) && path.basename(snapshot.powerShellPath).toLowerCase() === "pwsh.exe") {
    mkdirSync(path.dirname(powerShellCache), { recursive: true });
    writeFileSync(powerShellCache, snapshot.powerShellPath, "utf8");
  }
  const httpPort = Number(values["http-port"]), httpsPort = Number(values["https-port"]);
  if (![httpPort, httpsPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || httpPort === httpsPort) {
    throw new Error("Choose two different ports between 1024 and 65535.");
  }
  const directory = path.resolve(values["state-dir"] ?? path.join(root, "..", ".scratch", "iphone-usb-camera", "runtime", adapter.address));
  mkdirSync(directory, { recursive: true });
  windows("Certificate", ["-IpAddress", adapter.address, "-Directory", directory]);
  const caBytes = readFileSync(path.join(directory, "phone-camera-ca.cer"));
  const certBytes = readFileSync(path.join(directory, "server.pem"));
  const keyBytes = readFileSync(path.join(directory, "server-key.pem"));
  const ca = new X509Certificate(caBytes), cert = new X509Certificate(certBytes);
  if (!ca.ca || !cert.verify(ca.publicKey) || !cert.checkIP(adapter.address) ||
      [ca, cert].some(item => Date.parse(item.validFrom) > Date.now() || Date.parse(item.validTo) <= Date.now())) {
    throw new Error("Certificate set is invalid/expired for this USB address. Preserve it and choose another --state-dir.");
  }
  createSecureContext({ cert: certBytes, key: keyBytes });
  const camera = createPhoneCamera({ maxFrameBytes: 2 * 1024 * 1024 });
  const handler = createUsbBenchHandler({ usbAddress: adapter.address, handler: createHandler({ root,
    phoneCamera: camera, phoneCaBytes: caBytes, controlUnit: "http://127.0.0.1:1", relayOrigin: "http://127.0.0.1:1" }) });
  const servers = [httpServer(handler), httpsServer({ cert: certBytes, key: keyBytes }, handler)];
  const close = () => { camera.close(); for (const server of servers) { server.closeAllConnections(); server.close(); } };
  try {
    await listen(servers[0], httpPort);
    await listen(servers[1], httpsPort);
    await new Promise((resolve, reject) => {
      const req = httpsGet(`https://127.0.0.1:${httpsPort}/usb-phone.html`, { ca: ca.toString(), agent: false }, res => {
        res.resume(); res.on("end", () => res.statusCode === 200 ? resolve() : reject(new Error(`HTTPS returned ${res.statusCode}`)));
      });
      req.setTimeout(3000, () => req.destroy(new Error("HTTPS check timed out")));
      req.on("error", reject);
    });
  } catch (error) { close(); throw error; }
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  console.log(`[READY] PC test: http://localhost:${httpPort}/usb-bench`);
  console.log(`[PHONE] Safari: https://${adapter.address}:${httpsPort}/usb-phone.html`);
  console.log(`[CA] Download on iPhone: http://${adapter.address}:${httpPort}/phone-camera-ca.cer`);
  console.log(`[CA] SHA256: ${ca.fingerprint256}`);
  console.log(`[PAIRING] ${camera.pairingCode}`);
  console.log("Review/install this local CA profile on iPhone, then enable its full trust in Settings > General > About > Certificate Trust Settings.");
  console.log("Open the PHONE URL in Safari, enter the pairing code, tap Start streaming and allow Camera. Keep the page visible.");
  console.log("Publisher requests arriving at another PC address are refused. Confirm with the unplug/reconnect test; an adapter alone is not evidence of live USB video.");
  console.log("This camera-only bench does not connect to the ESP32 or AI services. Ctrl+C stops it. Existing servers are not stopped.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[USB TEST] ${error.message}`); process.exitCode = 1; });
}
