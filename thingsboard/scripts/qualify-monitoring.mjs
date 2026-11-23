import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { jsonRequest, waitUntil } from "../../n8n/lib/software-validation-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { output: { type: "string", default: "docs/evidence/native-model-software-2026-11-03/review-verified" } } });
const output = resolve(root, values.output); mkdirSync(output, { recursive: true });
const first = await waitUntil(async () => {
  const health = (await jsonRequest("http://127.0.0.1:8106/health")).body;
  return Number.isFinite(health.lastHealthDeliveryAt) ? health : null;
}, 20000, "initial health heartbeat");
const second = await waitUntil(async () => {
  const health = (await jsonRequest("http://127.0.0.1:8106/health")).body;
  return health.lastHealthDeliveryAt > first.lastHealthDeliveryAt ? health : null;
}, 20000, "bridge heartbeat advance");
const intervalMs = second.lastHealthDeliveryAt - first.lastHealthDeliveryAt;
const report = { assessedAt: new Date().toISOString(), configuredHealthIntervalMs: second.healthIntervalMs,
  observedHeartbeatIntervalMs: intervalMs, scope: "Actual bridge heartbeat delivery; idle publisher with no inspection submissions during this observation",
  passed: second.healthIntervalMs === 10000 && intervalMs >= 8000 && intervalMs <= 12000 };
writeFileSync(resolve(output, "monitoring.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
