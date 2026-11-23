import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventStore } from "./lib/store.mjs";
import { createBridge } from "./lib/bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(process.argv[2] ?? resolve(here, "runtime.local.json"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!config.deviceToken || !/^https?:$/.test(new URL(config.origin).protocol)) throw new Error("Run ThingsBoard provisioning first");
const database = resolve(dirname(configPath), config.database ?? ".runtime/events.sqlite");
mkdirSync(dirname(database), { recursive: true });
const store = new EventStore(database);
const bridge = createBridge({ store, ...config });
await bridge.listen(config.port ?? 8106, config.host ?? "0.0.0.0");
console.log("CN360 monitoring bridge ready on port " + (config.port ?? 8106));
async function stop() { await bridge.close(); store.close(); process.exit(); }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
