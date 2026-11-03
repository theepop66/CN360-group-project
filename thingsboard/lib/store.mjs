import { DatabaseSync } from "node:sqlite";

// The journal is the local delivery ledger, not the Supabase audit database.
// Stable timestamps and absolute counters make an uncertain HTTP retry safe:
// replay overwrites the same time-series point rather than adding another item.
export class EventStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, ts INTEGER UNIQUE NOT NULL, payload TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);`);
  }
  counter(name) { return this.db.prepare("SELECT value FROM counters WHERE name=?").get(name)?.value ?? 0; }
  increment(name) {
    this.db.prepare("INSERT INTO counters VALUES (?,1) ON CONFLICT(name) DO UPDATE SET value=value+1").run(name);
  }
  enqueue(event) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare("SELECT ts FROM events WHERE id=?").get(event.id);
      if (old) { this.db.exec("COMMIT"); return { duplicate: true, ts: old.ts }; }
      this.increment("inspection_count");
      this.increment(event.values.verdict === "pass" ? "pass_count" : "reject_count");
      if (event.values.inspection_failed) this.increment("failure_count");
      if (event.values.item_bound) this.increment("item_inspection_count");
      else this.increment("observation_count");
      const counters = Object.fromEntries(this.db.prepare("SELECT * FROM counters").all().map(row => [row.name, row.value]));
      const last = this.db.prepare("SELECT MAX(ts) AS ts FROM events").get().ts ?? 0;
      const ts = Math.max(event.ts, last + 1);
      const values = { ...event.values, ...counters, reject_rate_percent: 100 * (counters.reject_count ?? 0) / counters.inspection_count };
      this.db.prepare("INSERT INTO events(id,ts,payload) VALUES (?,?,?)").run(event.id, ts, JSON.stringify({ ts, values }));
      this.db.exec("COMMIT");
      return { duplicate: false, ts };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  pending(limit = 100) { return this.db.prepare("SELECT id,payload FROM events WHERE delivered=0 ORDER BY ts LIMIT ?").all(limit); }
  delivered(id) { this.db.prepare("UPDATE events SET delivered=1 WHERE id=?").run(id); }
  status() {
    const row = this.db.prepare("SELECT COUNT(*) AS stored, SUM(CASE WHEN delivered=0 THEN 1 ELSE 0 END) AS pending FROM events").get();
    return { stored: row.stored, pending: row.pending ?? 0, inspectionCount: this.counter("inspection_count"),
      passCount: this.counter("pass_count"), rejectCount: this.counter("reject_count"), failureCount: this.counter("failure_count") };
  }
  close() { this.db.close(); }
}
