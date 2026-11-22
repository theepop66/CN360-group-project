import test from "node:test";
import assert from "node:assert/strict";
import { controlFeedback } from "../js/control-feedback.js";

test("legacy, malformed and unverified receipts never display success", () => {
  for (const result of [null, {}, { accepted: null }, { accepted: "true" }, { accepted: 1 }]) {
    assert.equal(controlFeedback(result, () => { throw new Error("Must not claim success"); }).state, "error");
  }
});

test("an accepted command displays its receipt while refused sweep explains how to recover", () => {
  assert.deepEqual(controlFeedback({ accepted: true }, () => "Sweep command accepted."),
    { state: "ok", text: "Sweep command accepted." });
  const refused = controlFeedback({ accepted: false, reason: "manual_mode_required" }, () => "success");
  assert.equal(refused.state, "idle");
  assert.match(refused.text, /Press X.*confirmation.*Grip/);
});
