import test from "node:test";
import assert from "node:assert/strict";

import { setMode, setServoAngle, runSweep, sendVerdict, deriveVerdictUrl } from "../js/servo.js";

const SERVO_URL = "http://192.168.1.50/servo";
const MODE_URL = "http://192.168.1.50/mode";

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test("posts the documented mode JSON", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({ accepted: true, mode: "manual" });
  };

  const result = await setMode({ fetchImpl, url: MODE_URL, mode: "manual", timeoutMs: 100 });

  assert.equal(request.url, MODE_URL);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, '{"mode":"manual"}');
  assert.deepEqual(result, { accepted: true, mode: "manual" });
});

test("rejects an invalid mode before making a request", async () => {
  await assert.rejects(
    setMode({ fetchImpl: async () => jsonResponse({}), url: MODE_URL, mode: "sleep" }),
    /mode must be/
  );
});

test("posts an integer angle to the servo endpoint", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({ accepted: true });
  };

  await setServoAngle({ fetchImpl, url: SERVO_URL, angle: "45", timeoutMs: 100 });

  assert.equal(request.options.body, '{"angle":45}');
});

test("rejects an out-of-range angle before making a request", async () => {
  await assert.rejects(
    setServoAngle({ fetchImpl: async () => jsonResponse({}), url: SERVO_URL, angle: 200 }),
    /angle must be/
  );
});

test("posts a sweep request to the servo endpoint", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({ accepted: true });
  };

  await runSweep({ fetchImpl, url: SERVO_URL, timeoutMs: 100 });

  assert.equal(request.url, SERVO_URL);
  assert.equal(request.options.body, '{"sweep":true}');
});

test("surfaces accepted:false instead of throwing (firmware no-op, not an error)", async () => {
  const result = await setServoAngle({
    fetchImpl: async () => jsonResponse({ accepted: false }),
    url: SERVO_URL,
    angle: 90,
    timeoutMs: 100
  });

  assert.equal(result.accepted, false);
});

test("derives /verdict from a /servo URL on the same host", () => {
  assert.equal(deriveVerdictUrl("http://192.168.1.50/servo"), "http://192.168.1.50/verdict");
  assert.equal(deriveVerdictUrl("http://192.168.1.50:8080/api/servo"), "http://192.168.1.50:8080/api/verdict");
});

test("sends a verdict action to the derived endpoint", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({ accepted: true, status: "rejected" });
  };

  await sendVerdict({ fetchImpl, servoUrl: SERVO_URL, action: "reject", timeoutMs: 100 });

  assert.equal(request.url, "http://192.168.1.50/verdict");
  assert.equal(request.options.body, '{"action":"reject"}');
});

test("rejects an invalid verdict action before making a request", async () => {
  await assert.rejects(
    sendVerdict({ fetchImpl: async () => jsonResponse({}), servoUrl: SERVO_URL, action: "scrap" }),
    /action must be/
  );
});

test("aborts a servo request after the configured timeout", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  await assert.rejects(
    setServoAngle({ fetchImpl, url: SERVO_URL, angle: 90, timeoutMs: 5 }),
    { name: "AbortError" }
  );
});

test("reports non-success control unit responses", async () => {
  await assert.rejects(
    runSweep({ fetchImpl: async () => jsonResponse({}, false, 500), url: SERVO_URL, timeoutMs: 100 }),
    /Control unit returned HTTP 500/
  );
});
