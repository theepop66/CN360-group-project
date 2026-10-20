import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllWorkflows, PLACEHOLDERS } from "./lib/workflow-definitions.mjs";
import { resolveVerdictBudget, resolveCoverageThreshold } from "./lib/inspection-logic.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function configureWorkflows(config, supabaseKey) {
  const mappings = new Map();
  for (const [key, original] of [
    ["modelBaseUrl", `http://${PLACEHOLDERS.modelHost}`],
    ["piBaseUrl", `http://${PLACEHOLDERS.piHost}`],
    ["esp32BaseUrl", `http://${PLACEHOLDERS.esp32Host}`],
    ["relayBaseUrl", `http://${PLACEHOLDERS.relayHost}`],
    ["supabaseBaseUrl", `https://${PLACEHOLDERS.supabaseHost}`]
  ]) {
    const url = new URL(config[key]);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname === "0.0.0.0" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || config[key].includes("REPLACE_")) {
      throw new Error(`Set a usable origin for ${key}`);
    }
    mappings.set(original, url.origin);
  }
  if (!supabaseKey || supabaseKey.includes("REPLACE_") || !/^[A-Za-z0-9_-]+$/.test(config.snapshotBucket ?? "")) {
    throw new Error("Set CN360_SUPABASE_SERVICE_ROLE_KEY and snapshotBucket locally");
  }
  const threshold = resolveCoverageThreshold(config.coverageThreshold);
  const budget = resolveVerdictBudget(config.modelTimeoutMs);
  if (!threshold.readable || threshold.defaulted || !budget.readable || !budget.fits) {
    throw new Error("Explicit coverageThreshold and modelTimeoutMs must satisfy the Verdict Window");
  }
  mappings.set(PLACEHOLDERS.supabaseKey, supabaseKey);
  mappings.set(PLACEHOLDERS.snapshotBucket, config.snapshotBucket);
  mappings.set(PLACEHOLDERS.coverageThreshold, String(threshold.value));
  mappings.set(PLACEHOLDERS.modelTimeoutMs, String(budget.modelTimeoutMs));
  return Object.fromEntries(Object.entries(buildAllWorkflows()).map(([name, workflow]) => {
    // Replace leaf strings, not serialized JSON: quotes in local credentials
    // must never become expression syntax or change the graph structure.
    const replace = value => {
      if (typeof value === "string") {
        for (const [from, to] of mappings) value = value.replaceAll(from, to);
        if (/\bREPLACE_[A-Z][A-Z0-9_]*\b/.test(value)) throw new Error(`Unresolved configuration in ${name}`);
        return value;
      }
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
      return value;
    };
    return [name, replace(workflow)];
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = JSON.parse(readFileSync(join(here, "runtime.local.json"), "utf8"));
  const workflows = configureWorkflows(config, process.env.CN360_SUPABASE_SERVICE_ROLE_KEY);
  const output = join(here, "workflows-local");
  mkdirSync(output, { recursive: true });
  for (const [name, workflow] of Object.entries(workflows)) writeFileSync(join(output, name), JSON.stringify(workflow, null, 2) + "\n");
  console.log("Configured inactive workflows in workflows-local/. Contains local credentials; do not share or commit these files.");
}
