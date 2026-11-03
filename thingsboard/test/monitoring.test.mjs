import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { inspectionEvent } from "../lib/events.mjs";
import { EventStore } from "../lib/store.mjs";
import { createBridge } from "../lib/bridge.mjs";
import { configureWorkflows } from "../../n8n/configure.mjs";
import { WORKFLOW_FILES } from "../../n8n/lib/workflow-definitions.mjs";

const sample = overrides => ({ requestedAt: "2026-11-03T00:00:00.000Z", decidedAt: "2026-11-03T00:00:00.100Z",
  controlCompletedAt: "2026-11-03T00:00:00.125Z", executionId: "42", source: "manual",
  decision: { verdict: "pass", reason: "no_defect_detected", coverage: 0, coverageThreshold: 0.005, boxCount: 0 },
  esp32: { controlOutcome: "not_requested" }, ...overrides });

test("model failure stays a reject with missing coverage, and controls cannot imply physical success", () => {
  const event = inspectionEvent(sample({ decision: { verdict: "reject", reason: "model_timeout", coverage: null } }));
  assert.equal(event.values.inspection_failed, true);
  assert.equal(event.values.failure_reason, "model_timeout");
  assert.equal(event.values.coverage_available, false);
  assert.equal(event.values.defect_coverage_display, "Unavailable");
  assert.equal("defect_coverage" in event.values, false);
  const paired = inspectionEvent(sample({ itemContext: { controller_session: "boot1", item_id: "7" }, esp32: { controlOutcome: "accepted" } }));
  assert.equal(paired.values.physical_sorting_confirmed, false);
  assert.equal(paired.values.processing_ms, 125);
  assert.equal(paired.values.item_bound, true);
});

test("journal deduplicates physical identity across restarts and retains session distinctions", () => {
  const directory = mkdtempSync(join(tmpdir(), "cn360-telemetry-"));
  const path = join(directory, "events.sqlite");
  let store = new EventStore(path);
  try {
    const event = inspectionEvent(sample({ itemContext: { controller_session: "boot1", item_id: "7" } }));
    assert.equal(store.enqueue(event).duplicate, false);
    const payload = store.pending()[0].payload;
    store.close(); store = new EventStore(path);
    assert.equal(store.enqueue({ ...event, ts: event.ts + 10000 }).duplicate, true);
    assert.equal(store.pending()[0].payload, payload);
    const second = inspectionEvent(sample({ itemContext: { controller_session: "boot2", item_id: "7" } }));
    store.enqueue(second);
    const observation = inspectionEvent(sample()); store.enqueue(observation);
    assert.equal(store.status().inspectionCount, 3);
    const last = JSON.parse(store.pending().at(-1).payload);
    assert.equal(last.values.item_inspection_count, 2);
    assert.equal(last.values.observation_count, 1);
    assert.equal(new Set(store.pending().map(row => JSON.parse(row.payload).ts)).size, 3);
  } finally {
    store.close();
    const target = realpathSync(directory);
    assert.ok(target.startsWith(realpathSync(tmpdir()) + sep + "cn360-telemetry-"));
    rmSync(target, { recursive: true, force: true });
  }
});

test("recreated n8n instances can reuse execution IDs without suppressing new observations", () => {
  const first = inspectionEvent(sample());
  const second = inspectionEvent(sample({ requestedAt: "2026-11-03T00:00:00.010Z" }));
  assert.notEqual(first.id, second.id);
  assert.equal(first.id, inspectionEvent(sample()).id);
});

test("lost acknowledgements replay identical points, HTTP outages retain events, and duplicate delivery does not inflate counters", async () => {
  const store = new EventStore(":memory:");
  let outage = true; let loseAck = false; const received = [];
  const bridge = createBridge({ store, origin: "http://thingsboard.invalid", deviceToken: "private",
    fetchImpl: async (_url, options) => {
      if (outage) return new Response("", { status: 503 });
      const payload = JSON.parse(options.body);
      if (payload.values.event_id) received.push(payload);
      if (loseAck) { loseAck = false; throw new Error("lost response after commit"); }
      return new Response("", { status: 200 });
    }, publishIntervalMs: 100000, healthIntervalMs: 100000 });
  try {
    const address = await bridge.listen(0, "127.0.0.1");
    const post = () => fetch(`http://127.0.0.1:${address.port}/events`, { method: "POST", body: JSON.stringify(sample()) });
    assert.equal((await post()).status, 202);
    await bridge.drain();
    assert.equal(store.status().pending, 1);
    outage = false; loseAck = true;
    await bridge.drain();
    assert.equal(store.status().pending, 1);
    await bridge.drain();
    assert.equal(store.status().pending, 0);
    assert.deepEqual(received[0], received[1]);
    assert.equal((await (await post()).json()).duplicate, true);
    assert.equal(store.status().inspectionCount, 1);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/events`, { method: "POST", body: "{" })).status, 400);
  } finally { await bridge.close(); store.close(); }
});

test("10-second polling publishes component failures without losing inspection records", async () => {
  const store = new EventStore(":memory:"); const points = [];
  const bridge = createBridge({ store, origin: "http://thingsboard.invalid", deviceToken: "private", probes: { model: "http://model/health", n8n: "http://n8n/health" },
    fetchImpl: async (url, options) => {
      if (options.method === "POST") { points.push(JSON.parse(options.body)); return new Response("", { status: 200 }); }
      return new Response(JSON.stringify(url.includes("n8n") ? { ok: true } : { status: "ok" }), { status: url.includes("model") ? 503 : 200 });
    } });
  await bridge.pollHealth();
  assert.equal(points[0].values.model_healthy, false);
  assert.equal(points[0].values.n8n_healthy, true);
  assert.equal(points[0].values.system_healthy, false);
  store.close();
});

test("optional monitoring follows the HTTP response and preserves the carried inspection on delivery failure", () => {
  const config = { modelBaseUrl: "http://model", piBaseUrl: "http://camera", esp32BaseUrl: "http://controller", relayBaseUrl: "http://relay",
    supabaseBaseUrl: "http://database", snapshotBucket: "snapshots", coverageThreshold: 0.005, modelTimeoutMs: 1200 };
  const flow = configureWorkflows(config, "fixture")[WORKFLOW_FILES.inspectionLoop];
  const enabled = configureWorkflows({ ...config, telemetryBaseUrl: "http://bridge:8106", monitoringProfile: "software-controlled" }, "fixture")[WORKFLOW_FILES.inspectionLoop];
  assert.equal(flow.nodes.find(node => node.name === "publish-monitoring").disabled, true);
  const node = enabled.nodes.find(node => node.name === "publish-monitoring");
  assert.equal(node.disabled, false);
  assert.equal(node.parameters.url, "http://bridge:8106/events");
  assert.equal(node.onError, "continueRegularOutput");
  assert.equal(enabled.connections["respond-inspection"].main[0][0].node, "publish-monitoring");
  const restore = enabled.nodes.find(node => node.name === "restore-after-monitoring");
  const carried = sample();
  const result = new Function("$", restore.parameters.jsCode)(() => ({ first: () => ({ json: carried }) }));
  assert.deepEqual(result[0].json, carried);
  assert.throws(() => configureWorkflows({ ...config, telemetryBaseUrl: "http://user:password@bridge" }, "fixture"));
});
