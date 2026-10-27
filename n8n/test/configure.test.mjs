import test from "node:test";
import assert from "node:assert/strict";
import { configureWorkflows } from "../configure.mjs";

const config = {
  modelBaseUrl: "http://host.docker.internal:8000", piBaseUrl: "http://192.168.1.10:8000",
  esp32BaseUrl: "http://192.168.1.11", relayBaseUrl: "http://localhost:8081",
  supabaseBaseUrl: "https://example.supabase.co", snapshotBucket: "snapshots", coverageThreshold: 0.005, modelTimeoutMs: 1200
};

test("runtime configuration resolves all URLs without a duplicate scheme", () => {
  const workflows = configureWorkflows(config, "fixture-key");
  const text = JSON.stringify(workflows);
  assert.doesNotMatch(text, /REPLACE_[A-Z]|https:\/\/https:\/\//);
  assert.match(text, /http:\/\/host.docker.internal:8000\/predict/);
  assert.ok(Object.values(workflows).every(workflow => workflow.active === false));
});

test("runtime configuration refuses invalid targets, missing credentials and unsafe budgets", () => {
  for (const overrides of [{ modelBaseUrl: "http://0.0.0.0:8000" }, { modelBaseUrl: "http://user:password@localhost" }, { modelTimeoutMs: 5000 }, { coverageThreshold: "bad" }]) {
    assert.throws(() => configureWorkflows({ ...config, ...overrides }, "fixture-key"));
  }
  assert.throws(() => configureWorkflows(config, ""));
});

test("stored Supabase credentials configure every persistence request without exporting a key", () => {
  const flows = configureWorkflows({ ...config, supabaseCredentialId: "stored-supabase-id", supabaseCredentialName: "CN360 Supabase" });
  const persistence = Object.values(flows).flatMap(flow => flow.nodes).filter(node => node.parameters?.url?.includes(config.supabaseBaseUrl));
  assert.deepEqual(persistence.map(node => node.name).sort(), ["upload-snapshot", "log-duplicate", "insert-inspection", "insert-control-action", "log-outcome", "insert-prompt-history", "insert-health-log"].sort());
  for (const node of persistence) {
    assert.equal(node.parameters.authentication, "predefinedCredentialType");
    assert.equal(node.parameters.nodeCredentialType, "supabaseApi");
    assert.deepEqual(node.credentials.supabaseApi, { id: "stored-supabase-id", name: "CN360 Supabase" });
    assert.ok(!node.parameters.headerParameters.parameters.some(header => ["apikey", "authorization"].includes(header.name.toLowerCase())));
  }
  assert.equal(/REPLACE_[A-Z]|SERVICE_ROLE_KEY|__CN360_CREDENTIAL__/.test(JSON.stringify(flows)), false);
});

test("stored credential references take precedence over a supplied legacy key", () => {
  const flows = configureWorkflows({ ...config, supabaseCredentialId: "stored-supabase-id" }, "must-never-enter-this-export");
  assert.ok(!JSON.stringify(flows).includes("must-never-enter-this-export"));
});

test("invalid stored credential references are rejected instead of reverting to embedded secrets", () => {
  for (const id of ["", " ", "REPLACE_CREDENTIAL_ID", 123]) {
    assert.throws(() => configureWorkflows({ ...config, supabaseCredentialId: id }, "fixture-key"), /credential/i);
  }
});
