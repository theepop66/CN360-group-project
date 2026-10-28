// Test-only HTTP boundaries. No device, database or relay connection is made here.
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { buildModelInstruction } from "./inspection-records.mjs";
import { buildSnapshotObjectName } from "./inspection-logic.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function multipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!boundary) return {};
  const delimiter = Buffer.from("--" + (boundary[1] ?? boundary[2]));
  const fields = {};
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const start = cursor + delimiter.length + 2;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const split = body.indexOf("\r\n\r\n", start);
    if (split >= 0 && split < next) {
      const header = body.subarray(start, split).toString();
      const name = /\bname="([^"]+)"/.exec(header)?.[1];
      if (name) fields[name] = body.subarray(split + 4, next - 2);
    }
    cursor = next;
  }
  return fields;
}

export async function startInspectionFixture({ port = 0, upstream = null, verdictHandler = null, requireSupabaseAuth = false } = {}) {
  let session = randomUUID();
  let sequence = 0;
  let active = null;
  const contexts = new Map();
  const inspectionIds = new Map();
  const inspectionSequences = new Map();
  const completionKeys = new WeakMap();
  let currentPrompt = buildModelInstruction("scratch");
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let context = req.headers["x-cn360-test-case"] ? contexts.get(req.headers["x-cn360-test-case"]) : active;
    if (!context) { res.writeHead(503).end(); return; }
    const start = performance.now();
    let isPrediction = false;
    const event = (stage, detail = {}) => context.events.push({ stage, atMs: performance.now(), caseId: context.id, executionId: req.headers["x-cn360-test-execution"] ?? null, ...detail });
    const reply = (status, value, mime = "application/json") => {
      if (!res.destroyed) res.writeHead(status, { "content-type": mime }).end(mime === "application/json" ? JSON.stringify(value) : value);
    };
    try {
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = Buffer.concat(parts);
      const url = new URL(req.url, "http://fixture");
      if (requireSupabaseAuth && req.method !== "GET" && (url.pathname.startsWith("/storage/") || url.pathname.startsWith("/rest/v1/"))) {
        const valid = req.headers.apikey === "isolated-fixture-key" && req.headers.authorization === "Bearer isolated-fixture-key";
        event("credential-check", { valid, resource: url.pathname });
        if (!valid) { reply(401, { error: "fixture_auth_failed" }); return; }
      }
      if (url.pathname === "/completed") {
        const completion = JSON.parse(body.toString());
        if (completion.testCaseId) {
          const owner = contexts.get(completion.testCaseId);
          if (!owner) { reply(409, { error: "unknown test case" }); return; }
          context = owner;
        }
        const keys = completionKeys.get(context) ?? new Set();
        completionKeys.set(context, keys);
        const kind = completion.healthProbe ? "health:" + completion.healthProbe : completion.promptComplete ? "prompt" : "inspection";
        const key = completion.executionId == null ? null : JSON.stringify([completion.executionId, kind]);
        if (key === null || !keys.has(key)) {
          if (key !== null) keys.add(key);
          context.completions.push(completion);
          event("completed", { executionId: completion.executionId });
        }
        reply(200, {}); return;
      }
      if (url.pathname === "/health") {
        reply(context.modelOffline ? 503 : 200, { status: context.modelOffline ? "error" : "ok" }); return;
      }
      if (url.pathname === "/capture") {
        event("capture-start");
        if (context.captureDelayMs) await delay(context.captureDelayMs);
        if (context.captureOffline) { reply(503, { error: "capture offline" }); return; }
        if (!context.repeatFrame) sequence++;
        const bytes = context.corruptImage ? Buffer.from("invalid picture") : context.frame.bytes;
        const headers = {
          "content-type": context.frame.mimeType,
          "x-camera-session": session, "x-frame-sequence": String(sequence),
          "x-captured-at": new Date().toISOString(),
          "x-frame-width": String(context.frame.width), "x-frame-height": String(context.frame.height)
        };
        if (context.invalidHeaders) delete headers["x-frame-width"];
        const captured = { snapshotObjectName: buildSnapshotObjectName({ sessionId: session, sequence }), sha256: hash(bytes) };
        context.framesByExecution ??= new Map();
        context.framesByExecution.set(req.headers["x-cn360-test-execution"] ?? "direct", captured);
        event("capture-end", { session, sequence, ...captured, durationMs: performance.now() - start });
        if (!res.destroyed) res.writeHead(200, headers).end(bytes);
        return;
      }
      if (url.pathname === "/get_prompt" || url.pathname === "/set_prompt") {
        const setting = url.pathname === "/set_prompt";
        if (setting && context.promptError) { reply(503, { status: "error" }); return; }
        if (setting) currentPrompt = url.searchParams.get("prompt");
        if (upstream && context.realModel) {
          const response = await fetch(upstream + url.pathname + url.search, { signal: AbortSignal.timeout(1000) });
          const result = await response.json();
          if (result.current_prompt) currentPrompt = result.current_prompt;
          event(setting ? "prompt-set" : "prompt-get", { durationMs: performance.now() - start });
          reply(response.status, result); return;
        }
        event(setting ? "prompt-set" : "prompt-get", { instruction: currentPrompt });
        reply(200, { status: setting ? "updated" : "ok", current_prompt: currentPrompt }); return;
      }
      if (url.pathname === "/predict") {
        isPrediction = true;
        const fields = multipart(body, req.headers["content-type"]);
        const instruction = fields.prompt?.toString();
        const validFile = fields.file?.equals(context.frame.bytes) === true;
        const validPrompt = typeof instruction === "string" && instruction === context.instruction;
        event("model-start", { validFile, validPrompt, sha256: fields.file ? hash(fields.file) : null, instruction });
        if (!validFile || !validPrompt) {
          const result = { status: "error", reason: "fixture_contract_failed" };
          event("model-end", { httpStatus: 422, body: result, durationMs: performance.now() - start });
          reply(422, result); return;
        }
        if (context.modelOffline) {
          const result = { status: "error", reason: "model_unreachable" };
          event("model-end", { httpStatus: 503, body: result, durationMs: performance.now() - start });
          reply(503, result); return;
        }
        if (context.modelDelayMs) await delay(context.modelDelayMs);
        if (upstream && context.realModel) {
          // Diagnostic runs drain late results. Production tests propagate the
          // disconnect so they exercise real timeout/worker-recovery behavior.
          const disconnect = new AbortController();
          const onClose = () => { if (context.productionModel && !res.writableEnded) disconnect.abort(); };
          res.once("close", onClose);
          let response; let result;
          try {
            response = await fetch(upstream + "/predict", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body,
              signal: AbortSignal.any([AbortSignal.timeout(125000), disconnect.signal]) });
            result = await response.json();
          } finally { res.off("close", onClose); }
          event("model-end", { httpStatus: response.status, body: result, durationMs: performance.now() - start, clientExpired: res.destroyed });
          reply(response.status, result); return;
        }
        const area = context.frame.width * context.frame.height;
        let result = { status: "success", prompt_used: context.echoMismatch ? "different instruction" : instruction, detections: context.coverage ? [{ label: "defect", box: [0, 0, context.frame.width, context.coverage * area / context.frame.width] }] : [] };
        if (context.boxes) result.detections = context.boxes.map(box => ({ label: "defect", box }));
        if (context.missingStatus) delete result.status;
        if (context.modelError) result = { status: "error", reason: "inference_failed" };
        if (context.invalidBox) result.detections = [{ label: "defect", box: [10, 10, 5, 5] }];
        event("model-end", { httpStatus: context.httpError ? 500 : 200, body: result, durationMs: performance.now() - start, clientExpired: res.destroyed });
        if (context.malformed) reply(200, "{broken-json", "application/json-broken");
        else reply(context.httpError ? 500 : 200, result);
        return;
      }
      if (url.pathname === "/verdict") {
        let command;
        try { command = JSON.parse(body.toString()); }
        catch { reply(400, { accepted: false, status: "ignored", reason: "invalid_request" }); return; }
        event("verdict-received", { command });
        if (context.verdictDelayMs) await delay(context.verdictDelayMs);
        if (verdictHandler && !context.verdictOffline) {
          const receipt = await verdictHandler(command, context);
          event("controller-receipt", receipt);
          reply(receipt.httpStatus, receipt.body); return;
        }
        reply(context.verdictOffline ? 503 : 200, { ...command, accepted: !context.verdictIgnored && !context.verdictOffline, status: context.verdictIgnored ? "ignored" : "accepted", reason: context.verdictIgnored ? "already_resolved" : "accepted" }); return;
      }
      if (url.pathname.startsWith("/storage/")) {
        if (req.method === "GET") { reply(200, context.frame.bytes, context.frame.mimeType); return; }
        const captured = context.framesByExecution?.get(req.headers["x-cn360-test-execution"] ?? "direct");
        const objectName = decodeURIComponent(url.pathname.split("/").at(-1));
        event("snapshot-upload", { sha256: hash(body), matchesCapture: captured ? hash(body) === captured.sha256 : body.equals(context.frame.bytes),
          objectName, storagePath: url.pathname, matchesObjectName: objectName === captured?.snapshotObjectName, contentType: req.headers["content-type"] });
        if (context.snapshotDelayMs) await delay(context.snapshotDelayMs);
        reply(context.snapshotError ? 503 : 200, { Key: "test/snapshot.jpg" }); return;
      }
      if (url.pathname === "/rest/v1/rpc/cn360_record_inspection") {
        const { inspection: row } = JSON.parse(body.toString());
        event("inspection-record-request", { row });
        if (context.databaseUnresponsive) return;
        if (context.databaseError) { reply(503, { error: "database_unavailable" }); return; }
        const key = row.controller_session && row.item_id ? JSON.stringify([row.controller_session, row.item_id]) : null;
        const existing = key ? inspectionIds.get(key) : null;
        let id = existing;
        if (!id) {
          const number = (inspectionSequences.get(context.id) ?? 0) + 1; inspectionSequences.set(context.id, number);
          id = `${context.id}-inspection_results${number === 1 ? "" : "-" + number}`;
          if (key) inspectionIds.set(key, id);
          event("database-write", { table: "inspection_results", row });
        }
        event("inspection-record-result", { id, was_inserted: !existing });
        reply(200, [{ id, was_inserted: !existing }]); return;
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.split("/").at(-1);
        const row = JSON.parse(body.toString());
        event("database-write", { table, row });
        if (context.databaseUnresponsive) return;
        reply(context.databaseError ? 503 : 200, [{ ...row, id: `${context.id}-${table}` }]); return;
      }
      if (url.pathname === "/detections") {
        event("hud-delivery", { payload: JSON.parse(body.toString()) });
        reply(context.relayError ? 503 : 200, {}); return;
      }
      reply(404, {});
    } catch (error) {
      if (isPrediction) event("model-end", { httpStatus: 503, body: { status: "error", reason: "upstream_request_failed" }, durationMs: performance.now() - start, clientExpired: res.destroyed });
      event("fixture-error", { message: error.message });
      reply(503, { status: "error", reason: "fixture_error" });
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "0.0.0.0", resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    get current() { return active; },
    get modelPrompt() { return currentPrompt; },
    select(options) {
      active = { instruction: buildModelInstruction(options.target ?? "scratch"), events: [], completions: [], ...options };
      contexts.set(active.id, active);
      currentPrompt = active.instruction;
      return active;
    },
    restartSession() { session = randomUUID(); sequence = 0; },
    async waitFor(context, stage, count = 1, timeoutMs = 10000) {
      const deadline = performance.now() + timeoutMs;
      while (context.events.filter(e => e.stage === stage).length < count) {
        if (performance.now() >= deadline) throw new Error(`Missing ${stage} for ${context.id}`);
        await delay(20);
      }
    },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  };
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return { count: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null };
}

export function summarizeTiming(rows) {
  const successful = rows.filter(row => ["pass", "reject"].includes(row.result));
  return {
    count: rows.length, successes: successful.length, failures: rows.length - successful.length,
    timeouts: rows.filter(row => /timeout/.test(row.reason ?? "")).length,
    verdictWindowMisses: rows.filter(row => row.verdictReceiptMs != null && row.verdictReceiptMs >= 3000).length,
    missingVerdictReceipts: rows.filter(row => row.verdictReceiptMs == null).length,
    allAttempts: distribution(rows.map(row => row.elapsedMs).filter(Number.isFinite)),
    successfulOnly: distribution(successful.map(row => row.elapsedMs).filter(Number.isFinite)),
    note: "All-attempt times include failed/censored observations; successful-only values exclude errors. Stub receipt is not physical acceptance."
  };
}

export function summarizeTimingByCase(rows) {
  const groups = Map.groupBy(rows.filter(row => row.caseId), row => row.caseId);
  return Object.fromEntries([...groups].map(([id, group]) => [id, summarizeTiming(group)]));
}

export function assessInspection(completion) {
  const { decision, frame, response, control } = completion;
  if (!decision || !response) return { policyCorrect: false, reason: "missing completion evidence" };
  if (response.result === "error") return { policyCorrect: decision.verdict === "reject", controllerAccepted: control?.esp32Accepted ?? null };
  const boxes = decision.detections ?? [];
  const coverage = Math.min(1, boxes.reduce((sum, { box }) => sum + Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]), 0) / (frame.width * frame.height));
  const expected = coverage >= decision.coverageThreshold ? "reject" : "pass";
  return { calculatedCoverage: coverage, expected, policyCorrect: Number.isFinite(coverage) && Math.abs(coverage - decision.coverage) < 1e-10 && decision.verdict === expected && response.result === expected, controllerAccepted: control?.esp32Accepted ?? null };
}
