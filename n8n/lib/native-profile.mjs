import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connect } from "node:net";

export function assertNativePortAvailable(port) {
  return new Promise((accept, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); reject(new Error(`Native model port ${port} is already in use; stop only its owned service first`)); });
    socket.once("error", error => { socket.destroy(); if (error.code === "ECONNREFUSED") accept(); else reject(error); });
  });
}

export function settingsFromCheckout(source, overrides = {}) {
  const checkout = resolve(source);
  return { python: resolve(checkout, "venv/Scripts/python.exe"), modelProfile: "native", modelDevice: "CUDA0",
    modelPath: resolve(checkout, "models/locate-anything-q8_0.gguf"),
    modelLibrary: resolve(checkout, "../builds/resident-cuda/cn360_model.dll"),
    cudaPath: resolve(checkout, "../toolchains/cuda-12.6.3"), imageMaxSide: 448,
    ambient: false, healthIntervalSeconds: 10, telemetryBaseUrl: "http://host.docker.internal:8106", ...overrides };
}

export function nativeEnvironment(settings, warmupImage, { port = 8000, profile = "production" } = {}) {
  if (!["production", "diagnostic"].includes(profile)) throw new Error("Unknown native measurement profile");
  for (const [label, path] of [["Python", settings.python], ["model library", settings.modelLibrary], ["model weights", settings.modelPath], ["warm-up image", warmupImage]]) {
    if (typeof path !== "string" || !existsSync(path)) throw new Error(`Native ${label} is missing; configure its actual local path`);
  }
  if (!["cpu", "CUDA0"].includes(settings.modelDevice)) throw new Error("Select an explicit native backend: cpu or CUDA0");
  if (settings.modelDevice === "CUDA0" && (!settings.cudaPath || !existsSync(settings.cudaPath))) throw new Error("Configure the actual CUDA toolkit path");
  return { ...process.env, CN360_MODEL_LIBRARY: resolve(settings.modelLibrary), CN360_MODEL_PATH: resolve(settings.modelPath),
    CN360_MODEL_WARMUP_IMAGE: resolve(warmupImage), CN360_MODEL_WARMUP_TIMEOUT: "120", CN360_MODEL_STARTUP_TIMEOUT: "120",
    CN360_MODEL_REQUEST_TIMEOUT: profile === "production" ? "1.1" : "120", CN360_MODEL_PORT: String(port),
    CN360_MODEL_BIND: "127.0.0.1", CN360_MODEL_THREADS: "6", CN360_MODEL_MODE: "hybrid", LA_DEVICE: settings.modelDevice,
    ...(settings.cudaPath ? { CUDA_PATH: resolve(settings.cudaPath) } : {}) };
}

export async function waitForNativeModel(origin, backend, { child, timeoutMs = 250000, fetchImpl = fetch } = {}) {
  const end = Date.now() + timeoutMs;
  let reason = "model_loading";
  while (Date.now() < end) {
    if (child && child.exitCode !== null) throw new Error("Native model process exited before readiness; inspect model.log");
    try {
      const response = await fetchImpl(origin + "/health", { signal: AbortSignal.timeout(2000) });
      const body = await response.json();
      if (response.ok && body.status === "ok") {
        if (body.backend !== backend) throw new Error(`Native backend mismatch: requested ${backend}, received ${body.backend}`);
        return body;
      }
      reason = body.reason ?? "model_unavailable";
    } catch (error) {
      if (error.message?.startsWith("Native backend mismatch")) throw error;
    }
    await delay(250);
  }
  throw new Error("Native model readiness timed out: " + reason);
}
