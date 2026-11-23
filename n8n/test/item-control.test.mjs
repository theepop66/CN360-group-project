import test from "node:test";
import assert from "node:assert/strict";
import { parsePhysicalItem, readControlReceipt, inspectionDedupContext } from "../lib/item-control.mjs";

const item = { controller_session: "boot-1", item_id: "9007199254740993", verdict_window_ms: 3000 };

test("automatic events require identity; unpaired manual checks are observational", () => {
  assert.deepEqual(parsePhysicalItem("manual", {}).item, null);
  assert.deepEqual(parsePhysicalItem("schedule", {}).item, null);
  assert.equal(parsePhysicalItem("item_detected", {}).error, "invalid_item_context");
  for (const invalid of [{ ...item, item_id: 1 }, { ...item, item_id: " " }, { ...item, controller_session: "" }, { ...item, verdict_window_ms: -1 }]) {
    assert.equal(parsePhysicalItem("item_detected", invalid).error, "invalid_item_context");
  }
  assert.deepEqual(parsePhysicalItem("item_detected", item).item, item);
  assert.deepEqual(parsePhysicalItem("manual", item).item, item);
});

test("only matching identity acknowledgements establish control acceptance", () => {
  const response = body => ({ body, statusCode: 200 });
  const accepted = readControlReceipt(response({ ...item, accepted: true, status: "passed", reason: "accepted" }), item);
  assert.equal(accepted.controlOutcome, "accepted");
  assert.equal(accepted.esp32Accepted, true);
  for (const body of [{ accepted: true }, { ...item, item_id: "other", accepted: true }, { ...item, accepted: "true" }]) {
    const unknown = readControlReceipt(response(body), item);
    assert.equal(unknown.controlOutcome, "delivery_unknown");
    assert.equal(unknown.esp32Accepted, null);
  }
  const expired = readControlReceipt(response({ ...item, accepted: false, status: "ignored", reason: "expired" }), item);
  assert.equal(expired.controlOutcome, "ignored");
  assert.equal(expired.controlReason, "expired");
  assert.equal(readControlReceipt({ error: "timeout" }, item).controlOutcome, "delivery_unknown");
  assert.equal(readControlReceipt(null, null).controlOutcome, "not_requested");
  const mismatched = readControlReceipt(response({ ...item, item_id: "other-item", accepted: true }), item);
  assert.equal(mismatched.itemId, item.item_id);
  assert.equal(mismatched.acknowledgedItemId, "other-item");
  assert.equal(mismatched.acknowledgedControllerSession, item.controller_session);
});

test("same frame on different physical items keeps separate inspection records", () => {
  const frame = { sessionId: "camera", sequence: 7 };
  assert.notDeepEqual(inspectionDedupContext(frame, item), inspectionDedupContext(frame, { ...item, item_id: "next" }));
  assert.deepEqual(inspectionDedupContext(frame, null), frame);
});
