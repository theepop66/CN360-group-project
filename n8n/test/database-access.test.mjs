import test from "node:test";
import assert from "node:assert/strict";
import { databasePermissionDenied, storagePermissionDenied, hiddenRows } from "../../supabase/lib/access-check.mjs";

test("database permission evidence excludes invalid data, missing tables, invalid keys and outages", () => {
  assert.equal(databasePermissionDenied({ status: 401, json: { code: "42501" } }), true);
  assert.equal(hiddenRows({ status: 200, json: [] }), true);
  for (const response of [{ status: 400, json: { code: "23502" } }, { status: 404 }, { status: 503 }, { status: 401, json: { message: "Invalid API key" } }, { status: 200, json: [{ id: 1 }] }]) {
    assert.equal(hiddenRows(response), false);
  }
});

test("storage denial evidence requires a real permission error or an empty visible list", () => {
  assert.equal(storagePermissionDenied({ status: 400, json: { statusCode: "403", error: "Unauthorized" } }), true);
  assert.equal(hiddenRows({ status: 200, json: [] }, storagePermissionDenied), true);
  for (const response of [{ status: 500 }, { status: 400, json: { error: "Invalid MIME type" } }, { status: 413 }, { status: 401, json: { error: "Invalid JWT" } }]) {
    assert.equal(storagePermissionDenied(response), false);
  }
});
