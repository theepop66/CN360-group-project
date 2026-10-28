import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLACEHOLDERS,
  buildAllWorkflows
} from "../lib/workflow-definitions.mjs";
import { VERDICT } from "../lib/inspection-logic.mjs";
import { configureWorkflows } from "../configure.mjs";
import { buildMigrationBundle } from "../../supabase/build-migration-bundle.mjs";
import {
  buildControlActionRow,
  buildInspectionRow,
  buildPromptHistoryRow,
  buildSystemLogRow
} from "../lib/inspection-records.mjs";

// PostgREST rejects a body key with no matching column, and the inserts run
// with onError=continue, so a drifted name loses rows silently instead of
// failing a workflow. This reads the real migrations and holds them to the
// rows the workflows send.
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "supabase", "migrations");

const migrationSql = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
  .join("\n");

function tableBodies(sql) {
  const tables = {};
  const pattern = /create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g;
  for (const [, name, body] of sql.matchAll(pattern)) tables[name] = body;
  return tables;
}

// A column line is a name followed by a type; constraint bodies never are.
const COLUMN_LINE = /^(\w+)\s+(?:bigint|integer|smallint|double precision|text|boolean|timestamptz|jsonb)\b/;

function columnsOf(body) {
  return body
    .split("\n")
    .map((line) => line.trim().match(COLUMN_LINE)?.[1])
    .filter(Boolean);
}

const tables = Object.fromEntries(
  Object.entries(tableBodies(migrationSql)).map(([name, body]) => [name, columnsOf(body)])
);

test("the operator SQL bundle and standalone inspection RPC match the versioned migrations", () => {
  const lf = text => text.replaceAll("\r\n", "\n");
  assert.equal(lf(readFileSync(join(MIGRATIONS_DIR, "..", "apply-runtime.sql"), "utf8")), buildMigrationBundle());
  assert.equal(lf(readFileSync(join(MIGRATIONS_DIR, "20261028000200_idempotent_inspections.sql"), "utf8")),
    lf(readFileSync(join(HERE, "../sql/002-idempotent-inspections.sql"), "utf8")));
});

const workflows = buildAllWorkflows();
const allNodes = Object.values(workflows).flatMap((workflow) => workflow.nodes);

const builtRows = {
  inspection_results: buildInspectionRow({ verdict: VERDICT.REJECT }),
  control_actions: buildControlActionRow(),
  prompt_history: buildPromptHistoryRow(),
  system_logs: buildSystemLogRow()
};

test("the migrations create all four tables the workflows write", () => {
  assert.deepEqual(Object.keys(tables).sort(), Object.keys(builtRows).sort());
});

test("every key a row builder sends is a column of its table", () => {
  for (const [table, row] of Object.entries(builtRows)) {
    for (const key of Object.keys(row)) {
      assert.ok(tables[table].includes(key), `${table} has no column ${key}`);
    }
  }
});

test("every table a workflow posts to exists in the migrations", () => {
  const posted = allNodes
    .map((node) => String(node.parameters?.url ?? ""))
    .filter((url) => url.includes("/rest/v1/"))
    .map((url) => url.split("/rest/v1/")[1])
    .filter((path) => !path.startsWith("rpc/"));

  assert.ok(posted.length > 0);
  for (const table of posted) assert.ok(tables[table], `no migration creates ${table}`);
});

test("the inspection id the control action reads is the table's generated key", () => {
  // build-control-action takes row.id from the PostgREST representation.
  assert.match(
    migrationSql,
    /create table if not exists public\.inspection_results \(\s*id\s+bigint generated always as identity primary key/
  );
  assert.match(migrationSql, /inspection_id\s+bigint references public\.inspection_results \(id\)/);
});

test("the schema stores Defect Coverage and never confidence", () => {
  assert.ok(tables.inspection_results.includes("defect_coverage"));
  assert.ok(tables.inspection_results.includes("coverage_threshold"));
  for (const columns of Object.values(tables)) {
    assert.equal(columns.some((column) => column.includes("confidence")), false);
  }
});

test("the verdict check allows exactly the verdicts the logic produces", () => {
  const allowed = [...migrationSql.matchAll(/check \(verdict in \(([^)]*)\)\)/g)].map(([, list]) =>
    list.split(",").map((value) => value.trim().replace(/'/g, "")).sort()
  );
  assert.equal(allowed.length, 1);
  assert.deepEqual(allowed[0], Object.values(VERDICT).sort());
});

test("the snapshot bucket is public, because the HUD loads the URL without a key", () => {
  assert.match(
    migrationSql,
    /insert into storage\.buckets[\s\S]*values \('inspection-snapshots', 'inspection-snapshots', true,/
  );
  const urlBuilder = allNodes.find((node) =>
    String(node.parameters?.jsCode ?? "").includes("/storage/v1/object/public/")
  );
  assert.ok(urlBuilder, "the stored frame_url must be the public object URL");
});

test("configured Supabase nodes use the stored credential without exporting keys", () => {
  const configured = configureWorkflows({ modelBaseUrl: "http://localhost:8000", piBaseUrl: "http://localhost:8104", esp32BaseUrl: "http://localhost:8104",
    relayBaseUrl: "http://localhost:8081", supabaseBaseUrl: "https://example.supabase.co", snapshotBucket: "inspection-snapshots", supabaseCredentialId: "stored-id", coverageThreshold: 0.005, modelTimeoutMs: 1200 });
  const supabaseNodes = Object.values(configured).flatMap(f => f.nodes).filter(n => String(n.parameters?.url).includes("example.supabase.co"));
  assert.ok(supabaseNodes.length >= 5);

  for (const node of supabaseNodes) {
    assert.equal(node.parameters.authentication, "predefinedCredentialType", node.name);
    assert.equal(node.credentials?.supabaseApi?.id, "stored-id", node.name);

    const headers = (node.parameters.headerParameters?.parameters ?? []).map((header) =>
      header.name.toLowerCase()
    );
    assert.equal(headers.includes("apikey"), false, `${node.name} must not send a key header`);
    assert.equal(headers.includes("authorization"), false, `${node.name} must not send a key header`);
  }
});
