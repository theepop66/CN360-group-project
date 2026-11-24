import test from "node:test";
import assert from "node:assert/strict";

import { describeCaptureOutcome, requestCapture } from "../js/capture.js";

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

test("posts only an empty JSON object so the request can never carry an item identity", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse(200, { status: "success", result: "pass" });
  };

  await requestCapture({ fetchImpl, url: "/n8n/inspect-now", timeoutMs: 100 });

  assert.equal(request.url, "/n8n/inspect-now");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, "{}");
  assert.deepEqual(request.options.headers, { "Content-Type": "application/json" });
});

test("reports a model verdict as advice, not as a machine command", async () => {
  for (const result of ["pass", "reject"]) {
    const outcome = await requestCapture({
      fetchImpl: async () => jsonResponse(200, { status: "success", result, item: null }),
      url: "/n8n/inspect-now"
    });
    assert.equal(outcome.kind, "ok");
    assert.match(outcome.message, new RegExp(`AI says ${result}`));
    assert.match(outcome.message, /advice only, no machine command sent/);
  }
});

test("shows the model suggestion when human review is required", () => {
  const outcome = describeCaptureOutcome(200, {
    status: "review_required", result: "review", reason: "condition_not_qualified", modelSuggestion: "reject"
  });
  assert.equal(outcome.kind, "review");
  assert.match(outcome.message, /human review required/);
  assert.match(outcome.message, /AI suggestion: reject/);

  const missing = describeCaptureOutcome(200, { status: "review_required", result: "review" });
  assert.match(missing.message, /AI suggestion: unavailable/);
});

test("reports an inspection error with its reason instead of a result", () => {
  for (const reason of ["model_timeout", "model_unreachable", "frame_capture_failed"]) {
    const outcome = describeCaptureOutcome(200, { status: "error", result: "error", reason });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.message, `Capture failed · ${reason}`);
  }
  assert.equal(
    describeCaptureOutcome(200, { status: "error" }).message,
    "Capture failed · unknown reason"
  );
});

test("never turns an unrecognised or empty answer into a result", () => {
  for (const body of [null, {}, "ok", { status: "success" }, { status: "success", result: "review" }, { status: "ok" }]) {
    const outcome = describeCaptureOutcome(200, body);
    assert.equal(outcome.kind, "error", JSON.stringify(body));
    assert.match(outcome.message, /^Capture failed/);
  }
});

test("explains an inactive n8n workflow and proxy failures", () => {
  assert.match(
    describeCaptureOutcome(404, { code: 404, message: "The requested webhook is not registered." }).message,
    /webhook not found \(is the workflow active\?\)/
  );
  assert.equal(
    describeCaptureOutcome(504, { error: "n8n unreachable", detail: "ECONNREFUSED" }).message,
    "Capture failed · HTTP 504 · n8n unreachable"
  );
  assert.equal(describeCaptureOutcome(502, null).message, "Capture failed · HTTP 502");
  assert.equal(describeCaptureOutcome(429, { error: "an inspection is already running" }).message,
    "Capture failed · HTTP 429 · an inspection is already running");
});

test("treats a non-JSON answer as a failed capture", async () => {
  const outcome = await requestCapture({
    fetchImpl: async () => ({ status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }),
    url: "/n8n/inspect-now"
  });
  assert.equal(outcome.kind, "error");
  assert.match(outcome.message, /unexpected response/);
});

test("rejects a missing capture URL", async () => {
  for (const url of [undefined, "", "   ", null]) {
    await assert.rejects(requestCapture({ fetchImpl: async () => jsonResponse(200, {}), url }), /Capture URL is not configured/);
  }
});

test("aborts a capture request after the configured timeout", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  await assert.rejects(
    requestCapture({ fetchImpl, url: "/n8n/inspect-now", timeoutMs: 5 }),
    { name: "AbortError" }
  );
});

test("lets a timeout while reading the answer surface as a timeout", async () => {
  const fetchImpl = async (_url, { signal }) => ({
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  await assert.rejects(
    requestCapture({ fetchImpl, url: "/n8n/inspect-now", timeoutMs: 5 }),
    { name: "AbortError" }
  );
});

test("passes network failures to the caller", async () => {
  await assert.rejects(
    requestCapture({
      fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
      url: "/n8n/inspect-now"
    }),
    /Failed to fetch/
  );
});
