import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../lib/store.mjs";
import { inspectionEvent } from "../lib/events.mjs";

test("review queue survives restart, deduplicates and records a human decision without changing the verdict", () => {
  const dir = mkdtempSync(join(tmpdir(), "cn360-review-")); const path = join(dir, "review.sqlite");
  const input = { requestedAt: "2026-11-03T12:00:00Z", decidedAt: "2026-11-03T12:00:01Z", executionId: "review-test",
    frameContext: { sessionId: "camera1", sequence: 1, width: 448, height: 448 }, reviewFrameBaseUrl: "http://127.0.0.1:8104/review-frames/",
    decision: { verdict: "reject", reason: "manual_review_required", reviewRequired: true, reviewReason: "condition_not_qualified",
      modelVerdict: "pass", detections: [{ label: "hole", box: [1, 2, 3, 4] }], coverage: 0, coverageThreshold: 0.005 } };
  let store = new EventStore(path);
  try {
    const event = inspectionEvent(input); store.enqueue(event); store.enqueue(event); store.close();
    store = new EventStore(path);
    const [pending] = store.reviews(); assert.equal(pending.eventId, event.id); assert.equal(pending.values.model_suggestion, "pass");
    assert.equal(pending.values.review_snapshot_url, "http://127.0.0.1:8104/review-frames/camera1/1.jpg");
    assert.equal(store.status().reviewCount, 1); assert.equal(store.status().reviewPending, 1);
    assert.equal(store.completeReview(event.id, { reviewer: "Test operator", disposition: "acceptable", note: "Synthetic queue test" }).status, "reviewed");
    assert.equal(store.reviews().length, 0); assert.equal(store.status().reviewPending, 0);
    assert.equal(JSON.parse(store.pending()[0].payload).values.verdict, "reject");
    assert.throws(() => store.completeReview(event.id, { reviewer: "Other", disposition: "defective" }), /already/);
    assert.throws(() => store.completeReview("missing", { reviewer: "", disposition: "acceptable" }), /Invalid/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
