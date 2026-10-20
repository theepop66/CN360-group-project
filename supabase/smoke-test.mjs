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
// creates is removed at the end. Keys are read from the environment and never
// printed, so the output can be pasted into an issue as evidence.

import {
  buildControlActionRow,
  buildInspectionRow,
  buildPromptHistoryRow,
  buildSystemLogRow
} from "../n8n/lib/inspection-records.mjs";
import { VERDICT } from "../n8n/lib/inspection-logic.mjs";

const BUCKET = "inspection-snapshots";
const baseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

if (!baseUrl || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

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
    body: body === undefined ? undefined : JSON.stringify(body)
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
function check(name, ok, evidence) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (evidence !== undefined) console.log(`      ${redact(evidence)}`);
}

const runId = `smoke-${Date.now()}`;
const now = new Date().toISOString();
const created = { inspection_results: [], control_actions: [], prompt_history: [], system_logs: [] };
const objectName = `${runId}-1.jpg`;
let uploaded = false;

async function insert(table, row) {
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

  // Snapshot: upload the way upload-snapshot does, then read it as the HUD does.
  const upload = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectName}`, {
    method: "POST",
    headers: { ...authHeaders(serviceKey), "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: JPEG
  });
  uploaded = upload.ok;
  check("snapshot upload to inspection-snapshots", upload.ok, { status: upload.status });

  const frameUrl = `${baseUrl}/storage/v1/object/public/${BUCKET}/${objectName}`;
  const publicRead = await fetch(frameUrl);
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
      frameUrl
    }
  );
  const inspection = await insert("inspection_results", inspectionRow);
  const inspectionId = inspection.inserted?.id;
  check("inspection_results insert returns the id", inspection.status === 201 && Number.isInteger(inspectionId), {
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
    const anonRead = await rest("GET", "inspection_results?select=id&limit=1", { key: anonKey });
    check(
      "anon cannot read inspection_results",
      anonRead.status >= 400 || (Array.isArray(anonRead.json) && anonRead.json.length === 0),
      { status: anonRead.status, code: anonRead.json?.code }
    );
    const anonWrite = await rest("POST", "system_logs", {
      key: anonKey,
      body: buildSystemLogRow({ severity: "info", component: "smoke-test", message: "anon write" })
    });
    check("anon cannot insert into system_logs", anonWrite.status >= 400, {
      status: anonWrite.status,
      code: anonWrite.json?.code
    });
  } else {
    console.log("SKIP  anon checks (SUPABASE_ANON_KEY not set)");
  }
}

// control_actions first: the FK is ON DELETE RESTRICT.
async function cleanUp() {
  for (const table of ["control_actions", "inspection_results", "prompt_history", "system_logs"]) {
    for (const id of created[table]) await rest("DELETE", `${table}?id=eq.${id}`);
  }
  if (uploaded) {
    await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectName}`, {
      method: "DELETE",
      headers: authHeaders(serviceKey)
    });
  }
}

try {
  await main();
} catch (error) {
  check("smoke test ran to completion", false, String(error?.message ?? error));
} finally {
  await cleanUp();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Test rows and snapshot removed.`);
process.exitCode = failed === 0 ? 0 : 1;
