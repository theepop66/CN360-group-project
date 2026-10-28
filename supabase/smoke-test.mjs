// Live check that a Supabase project matches what the n8n workflows send.
//
//   SUPABASE_URL=https://<project-ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   SUPABASE_ANON_KEY=...            # optional, enables the anon checks
//   node supabase/smoke-test.mjs
//
// It writes one row to each table through the same row builders the workflows
// use, reads each back, uploads a snapshot and fetches its public URL with no
// key, and checks the Control Action foreign key. Every row and object it
// creates is retained as run-labelled audit evidence. Keys are read locally and never
// printed, so the output can be pasted into an issue as evidence.

import {
  buildControlActionRow,
  buildInspectionRow,
  buildPromptHistoryRow,
  buildSystemLogRow
} from "../n8n/lib/inspection-records.mjs";
import { VERDICT } from "../n8n/lib/inspection-logic.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { databasePermissionDenied, storagePermissionDenied, hiddenRows } from "./lib/access-check.mjs";

const { values: options } = parseArgs({ options: { url: { type: "string" }, "key-file": { type: "string" }, bucket: { type: "string", default: "inspection-snapshots" }, output: { type: "string", default: "n8n/.runtime/issue26/hosted-report.json" } } });
const BUCKET = options.bucket;
const baseUrl = String(options.url ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceKey = options["key-file"] ? readFileSync(options["key-file"], "utf8").match(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? "" : process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

if (!baseUrl || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const origin = new URL(baseUrl);
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Use a project origin without credentials or a path");
if (!/^[A-Za-z0-9_-]+$/.test(BUCKET)) throw new Error("Invalid bucket");

const secrets = [serviceKey, anonKey].filter(Boolean);
function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) text = text.split(secret).join("<redacted>");
  return text;
}

// The same two headers the n8n Custom Auth credential supplies.
function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rest(method, path, { key = serviceKey, body, prefer } = {}) {
  const headers = { ...authHeaders(key), "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

const results = [];
const evidence = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (detail !== undefined) console.log(`      ${redact(detail)}`);
  evidence.push({ id: name, passed: ok, evidence: detail });
}

const runId = `smoke-${Date.now()}`;
const now = new Date().toISOString();
const created = { inspection_results: [], control_actions: [], prompt_history: [], system_logs: [] };
const objectName = `${runId}-1.jpg`;

async function insert(table, row) {
  if (table === "inspection_results") {
    const rpc = await rest("POST", "rpc/cn360_record_inspection", { body: { inspection: row } });
    const inserted = rpc.json?.[0];
    if (inserted?.id !== undefined) created[table].push(inserted.id);
    return { ...rpc, inserted };
  }
  const response = await rest("POST", table, { body: row, prefer: "return=representation" });
  const inserted = Array.isArray(response.json) ? response.json[0] : null;
  if (inserted?.id !== undefined) created[table].push(inserted.id);
  return { ...response, inserted };
}

async function readBack(table, id) {
  const response = await rest("GET", `${table}?id=eq.${id}&select=*`);
  return Array.isArray(response.json) ? response.json[0] : null;
}

// A minimal valid JPEG (1x1, grey), so the bucket's image/jpeg rule is exercised.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

async function main() {
  console.log(`Supabase smoke test, run ${runId}, against ${new URL(baseUrl).host}\n`);

  const bucketResponse = await fetch(`${baseUrl}/storage/v1/bucket/${BUCKET}`, { headers: authHeaders(serviceKey), signal: AbortSignal.timeout(15000) });
  let bucketConfig = await bucketResponse.json();
  if (!bucketResponse.ok) {
    const create = await fetch(`${baseUrl}/storage/v1/bucket`, { method: "POST", headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5242880, allowed_mime_types: ["image/jpeg"] }), signal: AbortSignal.timeout(15000) });
    check("snapshot bucket created", create.ok, { status: create.status });
    const read = await fetch(`${baseUrl}/storage/v1/bucket/${BUCKET}`, { headers: authHeaders(serviceKey), signal: AbortSignal.timeout(15000) }); bucketConfig = await read.json();
  }
  check("snapshot bucket matches migration", bucketConfig.public === true && Number(bucketConfig.file_size_limit) === 5242880 && bucketConfig.allowed_mime_types?.includes("image/jpeg"));

  // Snapshot: upload the way upload-snapshot does, then read it as the HUD does.
  const upload = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectName}`, {
    method: "POST",
    headers: { ...authHeaders(serviceKey), "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: JPEG,
    signal: AbortSignal.timeout(15000)
  });
  check("snapshot upload to inspection-snapshots", upload.ok, { status: upload.status });

  const frameUrl = `${baseUrl}/storage/v1/object/public/${BUCKET}/${objectName}`;
  const publicRead = await fetch(frameUrl, { signal: AbortSignal.timeout(15000) });
  const publicBytes = Buffer.from(await publicRead.arrayBuffer());
  check(
    "snapshot public URL loads with no key",
    publicRead.ok && publicBytes.equals(JPEG),
    { status: publicRead.status, contentType: publicRead.headers.get("content-type"), bytes: publicBytes.length }
  );

  // inspection_results, through the real builder, returning the id.
  const inspectionRow = buildInspectionRow(
    { verdict: VERDICT.PASS, boxCount: 1, coverage: 0.001, coverageThreshold: 0.005, promptVerified: true },
    {
      frameContext: { sessionId: runId, sequence: 1, width: 1280, height: 720 },
      inspectionTarget: "smoke",
      modelInstruction: "Locate all the instances that matches the following description: smoke.",
      inspectedAt: now,
      frameUrl,
      itemContext: { controller_session: runId, item_id: "18446744073709551615" }
    }
  );
  const inspection = await insert("inspection_results", inspectionRow);
  const inspectionId = inspection.inserted?.id;
  check("inspection RPC returns the generated id", inspection.status === 200 && Number.isInteger(inspectionId) && inspection.inserted.was_inserted === true, {
    status: inspection.status,
    id: inspectionId
  });
  const inspectionRead = inspectionId === undefined ? null : await readBack("inspection_results", inspectionId);
  check(
    "inspection_results read-back matches",
    inspectionRead?.verdict === "pass" && inspectionRead?.frame_url === frameUrl && inspectionRead?.defect_coverage === 0.001,
    inspectionRead
  );

  // control_actions, anchored to the returned id.
  const action = await insert(
    "control_actions",
    buildControlActionRow({
      inspectionId,
      action: VERDICT.PASS,
      esp32Accepted: true,
      esp32Status: "accepted",
      esp32HttpStatus: 200,
      requestedAt: now
    })
  );
  check("control_actions insert", action.status === 201, { status: action.status, id: action.inserted?.id });
  const actionRead = action.inserted ? await readBack("control_actions", action.inserted.id) : null;
  check("control_actions read-back references the inspection", actionRead?.inspection_id === inspectionId, actionRead);

  const retries = await Promise.all(Array.from({ length: 5 }, () => rest("POST", "rpc/cn360_record_inspection", { body: { inspection: inspectionRow } })));
  check("concurrent RPC retries reuse one inspection", retries.every(r => r.status === 200 && r.json?.[0]?.id === inspectionId && r.json[0].was_inserted === false));
  const receipts = [];
  for (let i = 0; i < 4; i++) receipts.push(await insert("control_actions", buildControlActionRow({ inspectionId, action: VERDICT.PASS, requestedAt: now, esp32Accepted: false, controlOutcome: "ignored", controlReason: "already_resolved" })));
  const allReceipts = await rest("GET", `control_actions?inspection_id=eq.${inspectionId}&select=id,inspection_id`);
  check("five control receipts share one inspection", receipts.every(r => r.status === 201) && allReceipts.status === 200 && allReceipts.json?.length === 5);

  for (const [name, overrides] of [["invalid pass", { item_id: "invalid-pass", defect_coverage: 0.6, coverage_threshold: 0.5 }], ["invalid geometry", { item_id: "invalid-geometry", frame_width: -1 }]]) {
    const rejected = await rest("POST", "rpc/cn360_record_inspection", { body: { inspection: { ...inspectionRow, ...overrides } } });
    check(`hosted constraint rejects ${name}`, rejected.status === 400 && rejected.json?.code === "23514", { status: rejected.status, code: rejected.json?.code });
  }
  const observation = await insert("inspection_results", buildInspectionRow({ verdict: VERDICT.REJECT, boxCount: 0 }, { inspectedAt: now, inspectionTarget: runId + " observation" }));
  const observed = await insert("control_actions", buildControlActionRow({ inspectionId: observation.inserted?.id, action: null, requestedAt: now, controlOutcome: "not_requested", controlReason: "unpaired_observation" }));
  const observationRead = observed.inserted ? await readBack("control_actions", observed.inserted.id) : null;
  check("hosted observation retains null action without actuation", observation.status === 200 && observed.status === 201 && observationRead?.action === null && observationRead?.control_outcome === "not_requested", { inspectionId: observation.inserted?.id, controlId: observed.inserted?.id });

  const orphan = await insert(
    "control_actions",
    buildControlActionRow({ inspectionId: 2147483647, action: VERDICT.REJECT, requestedAt: now })
  );
  check(
    "control_actions rejects an unknown inspection_id (FK)",
    orphan.status === 409 && orphan.json?.code === "23503",
    { status: orphan.status, code: orphan.json?.code }
  );

  // prompt_history and system_logs.
  const prompt = await insert(
    "prompt_history",
    buildPromptHistoryRow({
      changedAt: now,
      inspectionTarget: "smoke",
      modelInstruction: "Locate all the instances that matches the following description: smoke.",
      source: "smoke-test",
      modelHttpStatus: 200
    })
  );
  const promptRead = prompt.inserted ? await readBack("prompt_history", prompt.inserted.id) : null;
  check("prompt_history insert and read-back", prompt.status === 201 && promptRead?.source === "smoke-test", {
    status: prompt.status,
    row: promptRead
  });

  const log = await insert(
    "system_logs",
    buildSystemLogRow({
      loggedAt: now,
      severity: "info",
      component: "smoke-test",
      message: "supabase smoke test",
      details: { runId }
    })
  );
  const logRead = log.inserted ? await readBack("system_logs", log.inserted.id) : null;
  check("system_logs insert and read-back (jsonb)", log.status === 201 && logRead?.details?.runId === runId, {
    status: log.status,
    row: logRead
  });

  if (anonKey) {
    for (const table of ["inspection_results", "control_actions", "prompt_history", "system_logs"]) {
    const anonRead = await rest("GET", `${table}?select=id&limit=1`, { key: anonKey });
    check(
      `anon cannot read ${table}`,
      hiddenRows(anonRead),
      { status: anonRead.status, code: anonRead.json?.code }
    );
    }
    const anonWrite = await rest("POST", "system_logs", {
      key: anonKey,
      body: buildSystemLogRow({ loggedAt: now, severity: "info", component: "smoke-test", message: "anon write" })
    });
    check("anon cannot insert into system_logs", databasePermissionDenied(anonWrite), {
      status: anonWrite.status,
      code: anonWrite.json?.code
    });
    const list = await fetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: { ...authHeaders(anonKey), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: runId }), signal: AbortSignal.timeout(15000) });
    const listed = await list.json();
    check("anon cannot list the snapshot", hiddenRows({ status: list.status, json: listed }, storagePermissionDenied), { status: list.status });
    const anonymousUpload = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${runId}-forbidden.jpg`, { method: "POST", headers: { ...authHeaders(anonKey), "Content-Type": "image/jpeg" }, body: JPEG, signal: AbortSignal.timeout(15000) });
    const deniedUpload = await anonymousUpload.json();
    check("anon cannot upload snapshots", storagePermissionDenied({ status: anonymousUpload.status, json: deniedUpload }), { status: anonymousUpload.status, error: deniedUpload.error, code: deniedUpload.statusCode });
  } else {
    console.log("SKIP  anon checks (SUPABASE_ANON_KEY not set)");
  }
}

try {
  await main();
} catch (error) {
  check("smoke test ran to completion", false, String(error?.message ?? error));
} finally {
  const output = resolve(options.output); mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, redact(JSON.stringify({ runId, project: origin.host, bucket: BUCKET, retainedTestData: true, recordIds: created, cases: evidence, finishedAt: new Date().toISOString() }, null, 2)) + "\n");
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Run-labelled test rows and snapshot retained for audit.`);
process.exitCode = failed === 0 ? 0 : 1;
