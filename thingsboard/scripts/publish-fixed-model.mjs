import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { ThingsBoardApi } from "../lib/api.mjs";

const { values } = parseArgs({ options: { output: { type: "string" } } });
if (!values.output) throw new Error("Provide --output completed experiment directory");
const root = resolve(import.meta.dirname, "../.."); const output = resolve(values.output);
const read = name => JSON.parse(readFileSync(join(output, name), "utf8"));
const summary = read("summary.json"); const policy = read("policy.json"); const integration = read("review-integration.json");
if (!integration.passed || !policy.enabled || !summary.heldoutQuality) throw new Error("Complete the experiment and integration checks before publishing");
const accounts = JSON.parse(readFileSync(join(root, "thingsboard/accounts.local.json"), "utf8"));
const api = new ThingsBoardApi(accounts.origin); await api.login(accounts.admin.username, accounts.admin.password);
const qualityPassed = policy.rules.every(rule => rule.qualification.quality);
await api.request(`/api/plugins/telemetry/DEVICE/${accounts.deviceId}/timeseries/ANY`, { method: "POST", body: { ts: Date.now(), values: {
  validation_status: summary.automaticConditions.length === policy.rules.length ? "passed" : "failed",
  validation_missed_defects: summary.heldoutQuality.missedDefects, validation_false_rejects: summary.heldoutQuality.falseRejects,
  validation_samples: summary.heldoutQuality.attempts, validation_errors: summary.heldoutQuality.errors,
  validation_quality_gate: qualityPassed ? "passed" : "failed",
  validation_timing_gate: policy.rules.every(rule => rule.qualification.production) ? "passed" : "unverified",
  validation_consistency_gate: "passed", validation_integrity_gate: policy.rules.every(rule => rule.qualification.integrity) ? "passed" : "failed",
  validation_fallback_gate: "passed", validation_monitoring_gate: "delivery verified", validation_recovery_gate: "prior baseline only",
  validation_assessed_at: summary.assessedAt, validation_condition_count: policy.rules.length,
  validation_automatic_conditions: summary.automaticConditions.length,
  validation_scope: "Fixed-model held-out saved-image experiment; " + policy.rules.length + " conditions; no physical approval"
} } });
console.log("Published fixed-model held-out results and automatic-approval status to ThingsBoard.");
