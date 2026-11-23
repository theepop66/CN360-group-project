// Run from the PC's terminal (or START-PICO-VR.cmd), not an isolated agent shell.
// No trust-store, firewall or controller changes are made by this launcher.
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { get } from "node:https";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const tools = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(tools, "..");
const certPath = path.join(tools, "dev-cert.pem");
const keyPath = path.join(tools, "dev-key.pem");
const port = 8443;

function request(url, ca) {
  return new Promise((resolve, reject) => {
    const req = get(url, { ca, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", reject);
    });
    req.setTimeout(4000, () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
  });
}

async function main() {
  if (process.argv.length > 3) throw new Error("Usage: START-PICO-VR.cmd [http://ESP32-IP]");
  const control = new URL(process.argv[2] ?? "http://172.20.10.5");
  if (!["http:", "https:"].includes(control.protocol) || control.username || control.password ||
      control.pathname !== "/" || control.search || control.hash) {
    throw new Error("Use a controller origin such as http://172.20.10.5");
  }

  const ca = readFileSync(certPath);
  const cert = new X509Certificate(ca);
  createSecureContext({ cert: ca, key: readFileSync(keyPath) });
  if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) {
    throw new Error("The local HTTPS certificate is not currently valid. Renew it before starting VR.");
  }
  const ips = Object.values(networkInterfaces()).flat().filter((entry) =>
    entry?.family === "IPv4" && !entry.internal && cert.checkIP(entry.address)
  ).map((entry) => entry.address);
  if (!ips.length) throw new Error("No active LAN IP matches tools/dev-cert.pem. Check PC Wi-Fi and the certificate IP.");

  const origin = `https://${ips[0]}:${port}`;
  console.log(`\nPICO URL: ${origin}/?xrdebug=1`);
  console.log(`Controller: ${control.origin}`);
  console.log(`Certificate SHA256: ${cert.fingerprint256}`);
  console.log("Keep this window open. Ctrl+C stops this server.");
  console.log("A self-signed certificate still needs to be trusted by the PICO browser.");

  let existing;
  try { existing = await request(`${origin}/`, ca); }
  catch (error) {
    if (error.code !== "ECONNREFUSED") throw new Error(`Cannot verify HTTPS on this PC: ${error.code ?? error.message}`);
  }

  let child;
  if (existing) {
    if (existing.status !== 200 || !existing.body.includes('id="vr-composite-canvas"')) {
      throw new Error("Port 8443 is serving a different app. It has not been stopped.");
    }
    console.log("An existing VisionQC HTTPS server is responding; checking its controller route.");
  } else {
    child = spawn(process.execPath, [path.join(tools, "hud-server.mjs"),
      "--https-port", String(port), "--cert", certPath, "--key", keyPath,
      "--control-unit", control.origin], { cwd: root, stdio: "inherit" });
    child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
    child.on("exit", (code, signal) => {
      if (code !== 0 && signal !== "SIGINT") process.exitCode = code || 1;
    });
    process.once("SIGINT", () => child.kill("SIGINT"));
    let ready = false;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const page = await request(`${origin}/`, ca);
        if (page.status === 200 && page.body.includes('id="vr-composite-canvas"')) { ready = true; break; }
      } catch (error) {
        if (error.code !== "ECONNREFUSED") { child.kill(); throw error; }
      }
    }
    if (!ready) { child.kill(); throw new Error("HTTPS did not become ready. See the server error above."); }
  }

  console.log(`\n[OK] HTTPS page returned HTTP 200 with certificate validation: ${origin}/`);
  try {
    const response = await request(`${origin}/esp/status`, ca);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const status = JSON.parse(response.body);
    const compatible = typeof status.controller_session === "string" &&
      Number.isInteger(status.conveyor_sequence);
    console.log(compatible ? "[OK] ESP32 status has the conveyor session/sequence fields." :
      "[CHECK] ESP32 responded, but conveyor session/sequence fields are missing. Check the installed firmware.");
    console.log(`Controller mode: ${status.mode ?? "unknown"}; state: ${status.state ?? "unknown"}`);
  } catch (error) {
    console.warn(`[CHECK] ESP32 /status is unavailable: ${error.message}`);
    console.warn(`Check ESP32 power/IP/Wi-Fi (${control.origin}). The HUD remains available.`);
  }
  console.log("\nOn PICO: open the PICO URL, enter VR cinema, then press X for Manual.");
  console.log("Left stick: up = forward, down = reverse, release = stop.");
  console.log("This launcher only reads controller status; it does not move the belt.");
}

main().catch((error) => { console.error(`[START FAILED] ${error.message}`); process.exitCode = 1; });
