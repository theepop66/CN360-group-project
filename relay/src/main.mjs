import { readConfig } from "./config.mjs";
import { createRelay } from "./relay.mjs";

const logger = {
  info: (message) => console.log(`[relay] ${message}`),
  warn: (message) => console.warn(`[relay] ${message}`),
  error: (message) => console.error(`[relay] ${message}`)
};

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(`[relay] Invalid configuration: ${error.message}`);
  process.exit(1);
}

const relay = createRelay(config, { logger });
const address = await relay.listen();
logger.info(`Listening on ${address.address}:${address.port} — POST and WebSocket at ${config.path}, health at /health.`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, shutting down.`);
    await relay.close();
    process.exit(0);
  });
}
