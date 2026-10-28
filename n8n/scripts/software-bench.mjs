import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { command } from "../lib/inspection-test-runtime.mjs";
import { configureWorkflows } from "../configure.mjs";
import { WORKFLOW_FILES } from "../lib/workflow-definitions.mjs";
import { startControllerAdapter } from "../lib/controller-test-adapter.mjs";
import { startSoftwareBench } from "../lib/software-bench.mjs";
import { createRelay } from "../../detection-relay/lib/relay.mjs";
import { startInspectionFixture } from "../lib/static-inspection.mjs";
import { parseInspectionTarget } from "../lib/inspection-records.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { config: { type: "string", default: join(root, "n8n/software-bench.local.json") } } });
const settings = JSON.parse(readFileSync(values.config, "utf8"));
const modelProfile = settings.modelProfile ?? "controlled";
if (!["controlled", "native"].includes(modelProfile)) throw new Error("modelProfile must be controlled or native");
const healthInterval = settings.healthIntervalSeconds ?? 15;
if (!Number.isInteger(healthInterval) || healthInterval < 5 || healthInterval > 3600) throw new Error("healthIntervalSeconds must be 5..3600");
const output = join(root, "n8n/.runtime/software-bench"); mkdirSync(output, { recursive: true });
const privateDirectory = join(homedir(), "AppData/Local/CN360/software-runtime"); mkdirSync(privateDirectory, { recursive: true });
const credentialFile = join(privateDirectory, "credentials.json");
const container = "cn360-software-n8n";
const volume = "cn360_software_n8n_data";
const ids = { [WORKFLOW_FILES.inspectionLoop]: "rBfAR3HgczhHFlui", [WORKFLOW_FILES.promptCapture]: "lUa1bJRHZuC1BWBe", [WORKFLOW_FILES.healthWatchdog]: "i01sMLn8WgW6EtZq" };
const key = [...new Set(readFileSync(settings.keyFile, "utf8").match(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [])];
if (key.length !== 1) throw new Error("The key file must contain one backend credential");
const running = await command("docker", ["ps", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]);
if (running.trim()) throw new Error("The software n8n profile is already running; stop that profile before restarting it");
await command(settings.python, [join(root, "n8n/scripts/prepare-inspection-images.py"), "--assets", join(root, "test-assets/product-defects"), "--output", output]);
const pictures = JSON.parse(readFileSync(join(output, "cases.json"), "utf8"));
const photo = pictures.find(p => p.id === "bottle__good__000-1");
const runtime = JSON.parse(readFileSync(join(root, "n8n/runtime.local.json"), "utf8"));
const schemaResponse = await fetch(runtime.supabaseBaseUrl + "/rest/v1/", { headers: { apikey: key[0] }, signal: AbortSignal.timeout(15000) });
if (!schemaResponse.ok || !(await schemaResponse.json()).paths?.["/rpc/cn360_record_inspection"]) {
  throw new Error("Apply n8n/sql/002-idempotent-inspections.sql in Supabase before starting this updated profile");
}
Object.assign(runtime, { modelBaseUrl: `http://host.docker.internal:${modelProfile === "controlled" ? 8105 : 8000}`, piBaseUrl: "http://host.docker.internal:8104",
  esp32BaseUrl: "http://host.docker.internal:8104", relayBaseUrl: "http://host.docker.internal:8081" });
const flows = configureWorkflows(runtime);
for (const [file, flow] of Object.entries(flows)) {
  flow.id = ids[file];
  // Ambient sorting is opt-in for this software profile; the webhook and health
  // workflows stay active without generating endless test rows or GPU requests.
  if (file === WORKFLOW_FILES.inspectionLoop) flow.nodes.find(n => n.name === "trigger-schedule").disabled = !settings.ambient;
  if (file === WORKFLOW_FILES.healthWatchdog) flow.nodes.find(n => n.name === "trigger-health-schedule").parameters.rule.interval = [{ field: "seconds", secondsInterval: healthInterval }];
}
writeFileSync(join(output, "workflows.json"), JSON.stringify(Object.values(flows), null, 2) + "\n");
const credentials = [{ id: runtime.supabaseCredentialId, name: runtime.supabaseCredentialName, type: "supabaseApi",
  data: { host: runtime.supabaseBaseUrl, serviceRole: key[0] } }];
writeFileSync(credentialFile, JSON.stringify(credentials));
let relay; let bench; let model; let controlledModel; let containerStarted = false; let stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  credentials[0].data.serviceRole = "[redacted]";
  writeFileSync(credentialFile, JSON.stringify(credentials));
  if (containerStarted) await command("docker", ["stop", "--time", "3", container]).catch(() => {});
  await bench?.close(); await relay?.close();
  await controlledModel?.close();
  if (model?.pid && model.exitCode === null) {
    if (process.platform === "win32") await command("taskkill", ["/PID", String(model.pid), "/T", "/F"]).catch(() => {});
    else model.kill("SIGTERM");
  }
}
process.once("SIGINT", () => { void stop().then(() => process.exit()); });
process.once("SIGTERM", () => { void stop().then(() => process.exit()); });
try {
  relay = createRelay({ heartbeatMs: 1000 }); await relay.listen(8081, "0.0.0.0");
  bench = await startSoftwareBench({ controller: startControllerAdapter(join(root, "n8n/.runtime/controller-adapter/controller_adapter.exe")),
    picture: { bytes: readFileSync(photo.file), width: photo.width, height: photo.height }, hudDirectory: join(root, "pico-webapp"), modelProfile,
    configureModel: scenario => controlledModel.select({ id: "software-bench", target: parseInspectionTarget(controlledModel.modelPrompt) ?? "visible surface defect",
      coverage: 0, boxes: scenario === "reject" ? [[180, 180, 450, 450]] : undefined,
      modelError: scenario === "error", modelDelayMs: scenario === "timeout" ? 1500 : 0, modelOffline: scenario === "offline",
      frame: { bytes: readFileSync(photo.file), width: photo.width, height: photo.height, mimeType: "image/jpeg" } }) });
  if (modelProfile === "controlled") {
    controlledModel = await startInspectionFixture({ port: 8105 });
    controlledModel.select({ id: "software-bench", target: "visible surface defect", boxes: [[180, 180, 450, 450]],
      frame: { bytes: readFileSync(photo.file), width: photo.width, height: photo.height, mimeType: "image/jpeg" } });
  } else {
  const modelLog = openSync(join(output, "model.log"), "a");
  model = spawn(settings.python, ["-m", "cn360_model"], { cwd: join(root, "model-service"), windowsHide: true,
    env: { ...process.env, PYTHONPATH: join(root, "model-service"), CN360_MODEL_LIBRARY: settings.modelLibrary,
      CN360_MODEL_PATH: settings.modelPath, CN360_MODEL_WARMUP_IMAGE: photo.file, CN360_MODEL_WARMUP_TIMEOUT: "120",
      CN360_MODEL_REQUEST_TIMEOUT: "1.1", CN360_MODEL_PORT: "8000", CN360_MODEL_THREADS: "6",
      CN360_MODEL_MODE: "hybrid", LA_DEVICE: settings.modelDevice ?? "cpu", CUDA_PATH: settings.cudaPath }, stdio: ["ignore", modelLog, modelLog] });
  model.on("error", error => console.error("Model process:", error.message));
  closeSync(modelLog);
  }
  await command("docker", ["volume", "create", volume]);
  // The dedicated volume can contain an old copied workflow. Never activate
  // unrelated automations when restarting this explicitly scoped profile.
  const program = "n8n unpublish:workflow --all && n8n import:credentials --input=/credentials/credentials.json && n8n import:workflow --input=/fixtures/workflows.json && n8n publish:workflow --id=rBfAR3HgczhHFlui && n8n publish:workflow --id=lUa1bJRHZuC1BWBe && n8n publish:workflow --id=i01sMLn8WgW6EtZq";
  await command("docker", ["run", "--rm", "--network", "none", "--volume", volume + ":/home/node/.n8n", "--volume", output + ":/fixtures:ro", "--volume", privateDirectory + ":/credentials:ro",
    "--env", "N8N_DIAGNOSTICS_ENABLED=false", "--entrypoint", "sh", "n8n-backup:latest", "-c", program]);
  credentials[0].data.serviceRole = "[redacted after import]";
  writeFileSync(credentialFile, JSON.stringify(credentials));
  const existingMounts = await command("docker", ["inspect", container, "--format", "{{json .Mounts}}"]
    ).then(value => JSON.parse(value)).catch(() => null);
  if (existingMounts) {
    if (!existingMounts.some(mount => mount.Name === volume)) throw new Error("Stopped container does not belong to this software profile");
    await command("docker", ["rm", container]); // persistent volume is retained
  }
  await command("docker", ["run", "-d", "--name", container, "--publish", "127.0.0.1:5680:5678", "--volume", volume + ":/home/node/.n8n",
    "--env", "N8N_DIAGNOSTICS_ENABLED=false", "--env", "N8N_LICENSE_AUTO_RENEW_ENABLED=false", "--env", "WEBHOOK_URL=http://localhost:5680/",
    "--env", "N8N_EDITOR_BASE_URL=http://localhost:5680", "n8n-backup:latest"]);
  containerStarted = true;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch("http://127.0.0.1:5680/healthz/readiness", { signal: AbortSignal.timeout(500) });
      const log = response.ok ? await command("docker", ["logs", container]) : "";
      if (Object.values(flows).every(flow => log.includes(`Activated workflow "${flow.name}"`))) { ready = true; break; }
    } catch {}
    await delay(500);
  }
  if (!ready) throw new Error("Software n8n did not become ready");
  writeFileSync(join(root, "n8n/runtime.local.json"), JSON.stringify(runtime, null, 2) + "\n");
  writeFileSync(join(output, "running.json"), JSON.stringify({ pid: process.pid, modelPid: model?.pid, modelProfile, container,
    profile: "test-pictures-pc-controller", hardware: false, n8n: "http://localhost:5680", bench: bench.origin,
    hud: bench.origin + "/hud/", controllerSession: bench.controllerSession, startedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log("Software test ready: " + bench.origin + "/ — n8n http://localhost:5680. Model profile: " + modelProfile + ". No physical hardware.");
} catch (error) { await stop(); throw error; }
