import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { assertNativePortAvailable, nativeEnvironment, waitForNativeModel } from "../lib/native-profile.mjs";

const file = fileURLToPath(import.meta.url);
const settings = { python: file, modelLibrary: file, modelPath: file, modelDevice: "cpu" };
test("production and diagnostic deadlines remain explicitly separate and invalid paths fail early", () => {
  assert.equal(nativeEnvironment(settings, file).CN360_MODEL_REQUEST_TIMEOUT, "1.1");
  assert.equal(nativeEnvironment(settings, file, { profile: "diagnostic", port: 8002 }).CN360_MODEL_REQUEST_TIMEOUT, "120");
  assert.throws(() => nativeEnvironment({ ...settings, modelPath: "missing-native-weights.gguf" }, file), /weights.*missing/);
  assert.throws(() => nativeEnvironment({ ...settings, modelDevice: "auto" }, file), /explicit native backend/);
});
test("readiness accepts only the requested actual backend and reports process death", async () => {
  const ready = await waitForNativeModel("http://model", "CUDA0", { fetchImpl: async () => Response.json({ status: "ok", backend: "CUDA0" }) });
  assert.equal(ready.backend, "CUDA0");
  await assert.rejects(waitForNativeModel("http://model", "CUDA0", { fetchImpl: async () => Response.json({ status: "ok", backend: "cpu" }) }), /backend mismatch/);
  await assert.rejects(waitForNativeModel("http://model", "CUDA0", { child: { exitCode: 1 } }), /exited before readiness/);
});

test("native startup refuses an occupied endpoint instead of trusting another model's health", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try { await assert.rejects(assertNativePortAvailable(port), /already in use/); }
  finally { await new Promise(resolve => server.close(resolve)); }
  await assertNativePortAvailable(port);
});
