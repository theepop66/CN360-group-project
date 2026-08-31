import test from "node:test";
import assert from "node:assert/strict";

import {
  createDetectionOrderTracker,
  shouldAcceptDetection
} from "../js/detection-order.js";

test("rejects a result captured before the latest accepted result", () => {
  const latest = { timestamp: "2026-08-23T12:00:02Z", sequence: 12 };
  const lateArrival = { timestamp: "2026-08-23T12:00:01Z", sequence: 11 };

  assert.equal(shouldAcceptDetection(lateArrival, latest), false);
});

test("uses sequence when timestamps are identical", () => {
  const latest = { timestamp: "2026-08-23T12:00:00Z", sequence: 12 };

  assert.equal(
    shouldAcceptDetection({ timestamp: latest.timestamp, sequence: 11 }, latest),
    false
  );
  assert.equal(
    shouldAcceptDetection({ timestamp: latest.timestamp, sequence: 13 }, latest),
    true
  );
});

test("uses sequence when the producer omits timestamps", () => {
  const latest = { timestamp: null, sequence: 12 };

  assert.equal(
    shouldAcceptDetection({ timestamp: null, sequence: 11 }, latest),
    false
  );
  assert.equal(
    shouldAcceptDetection({ timestamp: null, sequence: 13 }, latest),
    true
  );
});

test("uses monotonic sequence ahead of a corrected wall clock", () => {
  const latest = {
    sessionId: "boot-a",
    timestamp: "2026-08-23T12:00:02Z",
    sequence: 100
  };
  const afterClockCorrection = {
    sessionId: "boot-a",
    timestamp: "2026-08-23T11:59:58Z",
    sequence: 101
  };

  assert.equal(shouldAcceptDetection(afterClockCorrection, latest), true);
});

test("accepts a reset sequence from a new camera session", () => {
  const previous = { sessionId: "boot-a", timestamp: null, sequence: 100 };
  const restarted = { sessionId: "boot-b", timestamp: null, sequence: 1 };

  assert.equal(shouldAcceptDetection(restarted, previous), true);
  assert.equal(
    shouldAcceptDetection({ ...restarted, sessionId: "boot-a" }, previous),
    false
  );
});

test("accepts a new producer session even when its wall clock moved backward", () => {
  const previous = {
    sessionId: "boot-a",
    timestamp: "2026-08-23T12:00:02Z",
    sequence: 100
  };
  const restarted = {
    sessionId: "boot-b",
    timestamp: "2026-08-23T11:59:58Z",
    sequence: 1
  };

  assert.equal(shouldAcceptDetection(restarted, previous), true);
});

test("rejects a delayed result from a retired camera session", () => {
  const tracker = createDetectionOrderTracker();

  assert.equal(
    tracker.accept({ sessionId: "boot-a", timestamp: null, sequence: 100 }),
    true
  );
  assert.equal(
    tracker.accept({ sessionId: "boot-b", timestamp: null, sequence: 1 }),
    true
  );
  assert.equal(
    tracker.accept({ sessionId: "boot-a", timestamp: null, sequence: 101 }),
    false
  );
});

test("keeps ordering state across a transport reconnect", () => {
  const tracker = createDetectionOrderTracker();

  assert.equal(
    tracker.accept({ sessionId: "boot-a", timestamp: null, sequence: 100 }),
    true
  );
  // Opening another WebSocket does not reset this producer ordering state.
  assert.equal(
    tracker.accept({ sessionId: "boot-a", timestamp: null, sequence: 99 }),
    false
  );
});

test("keeps arrival order when the producer supplies no ordering metadata", () => {
  assert.equal(shouldAcceptDetection({}, {}), true);
});
