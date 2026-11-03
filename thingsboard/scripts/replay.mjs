import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventStore } from "../lib/store.mjs";

const folder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(folder, "runtime.local.json"), "utf8"));
const store = new EventStore(resolve(folder, config.database ?? ".runtime/events.sqlite"));
try {
  const count = store.db.prepare("UPDATE events SET delivered=0").run().changes;
  console.log(`Queued ${count} journal records for replay. Existing timestamps and absolute counters are retained.`);
} finally { store.close(); }
