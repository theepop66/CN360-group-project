import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { command } from "../../n8n/lib/inspection-test-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const folder = join(root, "thingsboard");
const envPath = join(folder, ".env");
if (!existsSync(envPath)) writeFileSync(envPath, "CN360_TB_DB_PASSWORD=" + randomBytes(24).toString("hex") + "\n");
const args = ["compose", "-f", join(folder, "compose.yaml"), "--env-file", envPath];
await command("docker", ["info", "--format", "{{.ServerVersion}}"]);
console.log("Starting the local monitoring database...");
await command("docker", [...args, "up", "-d", "--wait", "postgres"]);
const installed = (await command("docker", [...args, "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "thingsboard", "-Atc",
  "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='tb_user')"])).trim();
if (installed !== "t") {
  console.log("Initializing ThingsBoard; the first run can take a few minutes...");
  await command("docker", [...args, "run", "--rm", "-e", "INSTALL_TB=true", "thingsboard"]);
}
await command("docker", [...args, "up", "-d", "thingsboard"]);
console.log("Waiting for ThingsBoard...");
let ready = false;
for (let attempt = 0; attempt < 180; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:9090/api/noauth/activate?activateToken=readiness-probe", { signal: AbortSignal.timeout(1000) });
    if ([400, 409].includes(response.status)) { ready = true; break; }
  } catch {}
  await delay(1000);
}
if (!ready) throw new Error("ThingsBoard startup timed out; inspect its compose logs");
console.log(await command(process.execPath, [join(folder, "scripts/provision.mjs")], { cwd: root }));
