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

const relayTokenHeader = workflows => {
  const inspection = Object.values(workflows).find(workflow => workflow.nodes.some(node => node.name === "broadcast-hud"));
  return inspection.nodes.find(node => node.name === "broadcast-hud").parameters.headerParameters.parameters
    .find(header => header.name === "X-CN360-Relay-Token").value;
};

test("the relay ingest token is off unless configured", () => {
  assert.equal(relayTokenHeader(configureWorkflows(config, "fixture-key")), "");
  assert.equal(relayTokenHeader(configureWorkflows({ ...config, relayIngestToken: "" }, "fixture-key")), "");
  assert.equal(relayTokenHeader(configureWorkflows({ ...config, relayIngestToken: "abc123-XYZ" }, "fixture-key")), "abc123-XYZ");
});

test("a relay ingest token that n8n could misread is refused", () => {
  for (const relayIngestToken of ["has space", "={{ $env.X }}", "REPLACE_RELAY_INGEST_TOKEN", 42]) {
    assert.throws(() => configureWorkflows({ ...config, relayIngestToken }, "fixture-key"), /relayIngestToken/);
  }
});
