import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { startControllerAdapter } from "../lib/controller-test-adapter.mjs";
import { startInspectionFixture } from "../lib/static-inspection.mjs";
import { command, startTestN8n } from "../lib/inspection-test-runtime.mjs";
import { buildModelInstruction } from "../lib/inspection-records.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: options } = parseArgs({ options: {
  output: { type: "string", default: join(root, "n8n/.runtime/item-deadline") },
  adapter: { type: "string", default: join(root, "n8n/.runtime/controller-adapter/controller_adapter.exe") },
  python: { type: "string", default: process.env.CN360_TEST_PYTHON ?? "python" },
  docker: { type: "string", default: "docker" },
  "real-model-url": { type: "string" },
  "fixture-port": { type: "string", default: "8103" },
  "n8n-port": { type: "string", default: "5683" }
} });
const output = resolve(options.output);
mkdirSync(output, { recursive: true });
await command(options.python, [join(root, "n8n/scripts/prepare-inspection-images.py"), "--assets", join(root, "test-assets/product-defects"), "--output", output]);
const pictures = JSON.parse(readFileSync(join(output, "cases.json"), "utf8"));
const photo = pictures.find(p => p.id.startsWith("bottle__good"));
const frame = { bytes: readFileSync(photo.file), width: photo.width, height: photo.height, mimeType: "image/jpeg" };
const controller = startControllerAdapter(options.adapter);
const report = { startedAt: new Date().toISOString(),
  scope: "Actual n8n webhooks and firmware controller core via host HTTP adapter; licensed test pictures. Capture, storage, DB and relay are fixtures. Virtual controller time does not measure physical latency.",
  settings: { verdictWindowMs: 3000, n8nModelTimeoutMs: 1200, image: photo.id, width: photo.width, height: photo.height },
  sourceHashes: {}, cases: [], blocked: ["Physical sensor/servo and reject/retention acceptance", "Real DB schema/storage, relay/Pico delivery", "Camera deployment deferred"] };
report.controllerExecutableSha256 = createHash("sha256").update(readFileSync(options.adapter)).digest("hex");
for (const path of ["360ControlUnit/lib/ControlUnitState/ControlUnitState.cpp", "360ControlUnit/src/main.cpp", "n8n/lib/workflow-definitions.mjs", "n8n/lib/item-control.mjs", "model-service/cn360_model/app.py"]) {
  report.sourceHashes[path] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}
const fixture = await startInspectionFixture({ port: Number(options["fixture-port"]), upstream: options["real-model-url"],
  verdictHandler: (body, context) => {
    if (context.legacyAck) return { httpStatus: 200, body: { accepted: true, status: "passed" } };
    if (context.mismatchedAck) return { httpStatus: 200, body: { ...body, accepted: true, item_id: "other-item" } };
    return controller.verdict(body, context.realModel ? 31 + Math.floor(performance.now() - context.wallStarted) : context.receiptAt);
  } });
let runtime;
const persist = () => writeFileSync(join(output, "item-deadline.json"), JSON.stringify(report, null, 2) + "\n");

async function inspect(id, scenario = {}, setup = null) {
  const row = { id, failures: [] };
  report.cases.push(row);
  try {
    let station;
    if (setup) station = await setup();
    else {
      await controller.reset("boot-" + id);
      station = await controller.admit(0);
    }
    const item = scenario.itemOverride ?? station.active_item;
    const picture = scenario.picture ?? photo;
    const servedFrame = scenario.picture ? { bytes: readFileSync(picture.file), width: picture.width, height: picture.height, mimeType: "image/jpeg" } : frame;
    const context = fixture.select({ id, frame: servedFrame, target: picture.target, receiptAt: scenario.receiptAt ?? 131, ...scenario });
    row.events = context.events;
    row.completions = context.completions;
    row.item = item;
    row.pictureId = picture.id;
    const body = { testCaseId: id, inspectionTarget: picture.target, ...(scenario.observational ? {} : item) };
    const started = performance.now();
    context.wallStarted = started;
    const responses = await Promise.all(Array.from({ length: scenario.count ?? 1 }, () => fetch(runtime.origin + "/webhook/" + (scenario.path ?? "item-detected"), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
    })));
    const response = responses[0];
    row.elapsedMs = performance.now() - started;
    row.httpStatus = response.status;
    row.responses = await Promise.all(responses.map(r => r.json()));
    row.response = row.responses[0];
    await fixture.waitFor(context, "completed", scenario.count ?? 1, 30000);
    row.executions = await runtime.waitExecutions(context.completions.map(c => c.executionId));
    assert.ok(row.executions.every(e => e.status === "success"));
    if (scenario.invalid) {
      assert.equal(response.status, 400);
      assert.equal(row.response.reason, "invalid_item_context");
      assert.ok(!context.events.some(e => ["capture-start", "model-start", "verdict-received"].includes(e.stage)));
    } else {
      assert.equal(response.status, 200);
      if (scenario.expected) assert.equal(row.response.result, scenario.expected);
      const completed = context.completions[0];
      if (scenario.observational) {
        assert.equal(row.response.control.controlOutcome, "not_requested");
        assert.ok(!context.events.some(e => e.stage === "verdict-received"));
      } else {
        assert.equal(row.response.item.controller_session, item.controller_session);
        assert.equal(row.response.item.item_id, item.item_id);
        if (scenario.count) {
          for (const result of row.responses) {
            assert.ok(["accepted", "ignored", "delivery_unknown"].includes(result.control.controlOutcome));
            if (result.control.controlOutcome === "delivery_unknown") assert.equal(result.control.esp32Accepted, null);
          }
        } else assert.equal(row.response.control.controlOutcome, scenario.expectedControl ?? "accepted");
        if (!scenario.verdictOffline) await fixture.waitFor(context, "controller-receipt");
      }
      for (const event of context.events.filter(e => e.stage === "model-start")) assert.ok(event.validFile && event.validPrompt);
      for (const event of context.events.filter(e => e.stage === "snapshot-upload")) {
        assert.ok(event.matchesCapture);
        assert.ok(event.matchesObjectName, `Snapshot object path differs from capture: ${event.storagePath}`);
      }
      for (const completion of context.completions) {
        const events = context.events.filter(e => String(e.executionId) === String(completion.executionId));
        const upload = events.findIndex(e => e.stage === "snapshot-upload");
        const verdict = events.findIndex(e => e.stage === "verdict-received");
        if (!scenario.observational && upload >= 0) {
          if (verdict >= 0) assert.ok(upload > verdict, "snapshot precedes Verdict for this execution");
          else assert.equal(completion.control.controlOutcome, "delivery_unknown");
        }
      }
      const inspectionRow = context.events.find(e => e.stage === "database-write" && e.table === "inspection_results")?.row;
      if (scenario.duplicate) {
        assert.equal(completed.duplicate, true);
        assert.equal(inspectionRow, undefined);
      } else if (!scenario.count) {
        assert.equal(completed.duplicate, false);
        assert.ok(inspectionRow);
        assert.equal(inspectionRow.item_id, scenario.observational ? null : item.item_id);
      }
      if (scenario.expectedReason) assert.equal(row.response.control.controlReason, scenario.expectedReason);
      if (scenario.mismatchedAck) {
        assert.equal(row.response.control.acknowledgedItemId, "other-item");
        const controlRow = context.events.find(e => e.stage === "database-write" && e.table === "control_actions").row;
        assert.equal(controlRow.item_id, item.item_id);
        assert.equal(controlRow.ack_item_id, "other-item");
        const log = context.events.find(e => e.stage === "database-write" && e.table === "system_logs").row;
        assert.equal(log.details.acknowledgedItemId, "other-item");
      }
    }
    row.controller = await controller.step(scenario.realModel ? 31 + Math.floor(performance.now() - started) : scenario.finalAt ?? scenario.receiptAt ?? 131, true);
    const receipts = context.events.filter(e => e.stage === "controller-receipt");
    const accepted = receipts.filter(e => e.body.accepted && e.body.controller_session === item.controller_session && e.body.item_id === item.item_id);
    if (accepted.length === 1 && station.pass_count !== undefined) {
      const command = context.events.find(e => e.stage === "verdict-received").command;
      assert.equal(row.controller.pass_count, station.pass_count + (command.action === "pass" ? 1 : 0));
      assert.equal(row.controller.reject_count, station.reject_count + (command.action === "reject" ? 1 : 0));
      if (command.action === "pass") assert.ok(!accepted[0].body.actions.some(a => a.kind === 2));
      else assert.ok(accepted[0].body.actions.some(a => a.kind === 2 && a.angle === 90));
    }
    if (scenario.fallback) {
      row.fallback = await controller.step(3031, true);
      assert.equal(row.fallback.pass_count, 0);
      assert.equal(row.fallback.reject_count, 1);
      assert.equal(row.fallback.resolution_reason, "verdict_timeout");
    }
    if (scenario.expired) {
      assert.equal(row.controller.pass_count, 0);
      assert.equal(row.controller.reject_count, 1);
      assert.ok(receipts[0].body.actions.some(a => a.kind === 2 && a.angle === 90));
      assert.ok(!receipts[0].body.actions.some(a => a.kind === 5));
    }
    if (scenario.expectedActive) assert.equal(row.controller.state, "awaiting_verdict");
    if (scenario.count) assert.equal(row.controller.pass_count + row.controller.reject_count, 1);
    if (scenario.count) assert.equal(accepted.length, 1, "exactly one received command may resolve the item");
    if (scenario.modelDelayMs || scenario.realModel) await fixture.waitFor(context, "model-end");
  } catch (error) {
    row.failures.push(error.stack ?? error.message);
    const ids = [...new Set((row.events ?? []).map(e => e.executionId).filter(Boolean))];
    row.executionDiagnostics = await runtime.executionDetails(ids).catch(e => [{ diagnosticError: e.message }]);
  }
  row.status = row.failures.length ? "failed" : "passed";
  persist();
  console.log(`${row.status}: ${id}`);
  return row;
}

try {
  runtime = await startTestN8n({ output, fixturePort: Number(options["fixture-port"]), port: Number(options["n8n-port"]), docker: options.docker });
  await inspect("timely-pass", { expected: "pass", receiptAt: 2930 });
  await inspect("timely-reject", { expected: "reject", coverage: 0.01 });
  await inspect("exact-expiry", { expected: "pass", receiptAt: 3031, expectedControl: "ignored", expectedReason: "expired", expired: true });
  await inspect("after-expiry", { expected: "pass", receiptAt: 3032, expectedControl: "ignored", expectedReason: "expired", expired: true });
  await inspect("model-timeout", { modelDelayMs: 1500, expected: "error" });
  await inspect("model-error", { modelError: true, expected: "error" });
  await inspect("invalid-geometry", { invalidBox: true, expected: "error" });
  await inspect("capture-failure", { captureOffline: true, expected: "error" });
  await inspect("storage-offline", { snapshotError: true, expected: "pass" });
  await inspect("storage-slow", { snapshotDelayMs: 700, expected: "pass" });
  await inspect("manual-observation", { path: "inspect-now", observational: true, expected: "pass", fallback: true });
  await inspect("paired-manual", { path: "inspect-now", expected: "pass" });
  await inspect("missing-item", { observational: true, invalid: true, fallback: true });
  await inspect("legacy-ack", { legacyAck: true, expected: "pass", expectedControl: "delivery_unknown", fallback: true });
  await inspect("mismatched-ack", { mismatchedAck: true, expected: "pass", expectedControl: "delivery_unknown", fallback: true });
  await inspect("verdict-offline", { verdictOffline: true, expected: "pass", expectedControl: "delivery_unknown", fallback: true });
  await inspect("lost-ack", { verdictDelayMs: 400, expected: "pass", expectedControl: "delivery_unknown" });
  const first = await inspect("first-duplicate", { expected: "pass" });
  await inspect("duplicate-item", { itemOverride: first.item, expected: "pass", expectedControl: "ignored", duplicate: true, receiptAt: 133 }, () => controller.step(132, true));
  await inspect("same-frame-next-item", { repeatFrame: true, expected: "pass", receiptAt: 1131 }, async () => {
    await controller.step(400, false);
    return controller.admit(1000);
  });
  for (const action of ["pass", "reject"]) {
    let stale;
    await inspect("stale-A-" + action, { coverage: action === "reject" ? 0.01 : 0, expected: action, expectedControl: "ignored", expectedReason: "wrong_item", receiptAt: 4131, expectedActive: true }, async () => {
      await controller.reset("boot-stale-" + action);
      stale = (await controller.admit(0)).active_item;
      for (const at of [3031, 3181, 3581, 3731, 3732]) await controller.step(at, false);
      await controller.admit(4000);
      return { active_item: stale };
    });
    await inspect("current-B-after-" + action, { coverage: action === "pass" ? 0.01 : 0, expected: action === "pass" ? "reject" : "pass", receiptAt: 4132 }, () => controller.step(4131, true));
  }
  await inspect("previous-boot", { itemOverride: { controller_session: "previous-boot", item_id: "1", verdict_window_ms: 3000 }, expected: "pass", expectedControl: "ignored", expectedReason: "wrong_session", expectedActive: true });
  await inspect("concurrent-same-item", { expected: "pass", count: 2 });
  if (options["real-model-url"]) {
    for (const [index, picture] of [photo, pictures.find(p => p.hasDefect), photo].entries()) {
      const until = performance.now() + 370000;
      let ready = false;
      while (performance.now() < until) {
        const response = await fetch(options["real-model-url"] + "/health");
        if (response.ok) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error("Real model did not regain readiness");
      const prompt = await fetch(options["real-model-url"] + "/set_prompt?prompt=" + encodeURIComponent(buildModelInstruction(picture.target)));
      assert.ok(prompt.ok);
      await inspect(`production-model-${index}`, { realModel: true, productionModel: true, picture });
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.cases.filter(c => c.status === "passed").length, failed: report.cases.filter(c => c.status !== "passed").length };
  persist();
  await runtime?.stop();
  await fixture.close();
  await controller.close();
}
if (report.summary.failed) process.exitCode = 1;
