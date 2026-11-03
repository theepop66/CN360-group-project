import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { settingsFromCheckout } from "../../n8n/lib/native-profile.mjs";

const folder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { source: { type: "string" }, offline: { type: "boolean", default: false }, experiment: { type: "string" } } });
if (!values.source) throw new Error("Provide --source pointing to the local LocateAnything checkout");
const benchPath = resolve(folder, "../n8n/software-bench.local.json");
const bench = existsSync(benchPath) ? JSON.parse(readFileSync(benchPath, "utf8")) : {};
if (!values.offline && !bench.keyFile) throw new Error("Configure the online software profile's backend key file, or select --offline");
const settings = settingsFromCheckout(values.source, { keyFile: bench.keyFile, offline: values.offline,
  ...(values.experiment ? { experimentRun: resolve(values.experiment) } : {}) });
writeFileSync(resolve(folder, "software-native.local.json"), JSON.stringify(settings, null, 2) + "\n");
const path = resolve(folder, "runtime.local.json");
const monitoring = JSON.parse(readFileSync(path, "utf8"));
monitoring.probes.model = "http://127.0.0.1:8104/model/health";
writeFileSync(path, JSON.stringify(monitoring, null, 2) + "\n");
console.log("Native profile configured; model deadline remains 1100 ms and n8n budget remains unchanged.");
