import test from "node:test";
import assert from "node:assert/strict";

import { sendPrompt } from "../js/prompt.js";

test("posts only the documented prompt JSON", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 204 };
  };

  await sendPrompt({
    fetchImpl,
    url: "http://n8n.test/webhook/prompt",
    prompt: "scratch",
    timeoutMs: 100
  });

  assert.equal(request.url, "http://n8n.test/webhook/prompt");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, '{"prompt":"scratch"}');
  assert.deepEqual(request.options.headers, { "Content-Type": "application/json" });
});

test("aborts a prompt request after the configured timeout", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  await assert.rejects(
    sendPrompt({
      fetchImpl,
      url: "http://n8n.test/webhook/prompt",
      prompt: "mold",
      timeoutMs: 5
    }),
    { name: "AbortError" }
  );
});

test("reports non-success n8n responses", async () => {
  await assert.rejects(
    sendPrompt({
      fetchImpl: async () => ({ ok: false, status: 500 }),
      url: "http://n8n.test/webhook/prompt",
      prompt: "hole",
      timeoutMs: 100
    }),
    /n8n returned HTTP 500/
  );
});
