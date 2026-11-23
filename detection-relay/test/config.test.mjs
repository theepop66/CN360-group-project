import test from "node:test";
import assert from "node:assert/strict";

import { readConfig } from "../lib/config.mjs";

test("defaults suit a relay on the n8n machine with the token off", () => {
  assert.deepEqual(readConfig({}), {
    host: "0.0.0.0",
    port: 8081,
    path: "/detections",
    ingestToken: "",
    heartbeatMs: 15000
  });
});

test("environment values override the defaults", () => {
  const config = readConfig({
    RELAY_BIND: "127.0.0.1",
    RELAY_PORT: "9000",
    RELAY_PATH: "/hud",
    RELAY_INGEST_TOKEN: "abc123",
    RELAY_HEARTBEAT_MS: "5000"
  });
  assert.deepEqual(config, {
    host: "127.0.0.1",
    port: 9000,
    path: "/hud",
    ingestToken: "abc123",
    heartbeatMs: 5000
  });
});

test("an empty token leaves the token check off", () => {
  assert.equal(readConfig({ RELAY_INGEST_TOKEN: "" }).ingestToken, "");
});

test("invalid values fail at startup instead of later", () => {
  for (const port of ["0", "65536", "80.5", "eighty"]) {
    assert.throws(() => readConfig({ RELAY_PORT: port }), /RELAY_PORT/, port);
  }
  assert.throws(() => readConfig({ RELAY_PATH: "detections" }), /RELAY_PATH/);
  assert.throws(() => readConfig({ RELAY_PATH: "/a?b" }), /RELAY_PATH/);
  assert.throws(() => readConfig({ RELAY_INGEST_TOKEN: "has space" }), /RELAY_INGEST_TOKEN/);
  assert.throws(() => readConfig({ RELAY_HEARTBEAT_MS: "10" }), /RELAY_HEARTBEAT_MS/);
});
