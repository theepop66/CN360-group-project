#!/usr/bin/env node
// Entry point: `npm start`. Configuration comes from environment variables;
// see README.md and deploy/relay.env.example.

import { readConfig } from "./lib/config.mjs";
import { createRelay } from "./lib/relay.mjs";

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(`detection-relay: ${error.message}`);
  process.exit(1);
}

const logger = {
  info: (message) => console.log(`detection-relay: ${message}`),
  warn: (message) => console.warn(`detection-relay: ${message}`)
};

const relay = createRelay({
  path: config.path,
  ingestToken: config.ingestToken,
  heartbeatMs: config.heartbeatMs,
  logger
});

try {
  await relay.listen(config.port, config.host);
} catch (error) {
  logger.warn(`could not listen on ${config.host}:${config.port}: ${error.message}`);
  process.exit(1);
}

// 0.0.0.0 is only where the relay listens. HUDs and n8n need a real address.
logger.info(`listening on ${config.host}:${config.port}`);
logger.info(`  n8n POSTs to   http://<this machine>:${config.port}${config.path}`);
logger.info(`  HUDs connect   ws://<this machine>:${config.port}${config.path}`);
logger.info(`  ingest token   ${config.ingestToken ? "required" : "off"}`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info(`${signal} received, closing`);
  await relay.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
