// PC bench test for the conveyor HTTP contract. Node.js 18+, no packages.
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function testConveyor({
  baseUrl,
  action = "status",
  seconds = 2,
  fetchImpl = fetch,
  sleep = delay,
  now = () => performance.now(),
  cancelled = () => false,
  log = console.log
}) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Use an HTTP(S) ESP32 URL.");
  if (!["status", "forward", "reverse", "stop"].includes(action)) throw new Error("Action: status, forward, reverse or stop.");
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5) throw new Error("Duration must be greater than 0 and at most 5 seconds.");

  async function request(path, body) {
    const controller = new AbortController();
    // Status is read-only and can include connection establishment. Motor
    // requests remain bounded so renewals stay inside the firmware's 500 ms command limit.
    const timeoutMs = path === "/status" ? 5000 : path === "/mode" ? 1500 : 250;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}; check the installed firmware.`);
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`${new URL(path, base).href}: no complete response within ${timeoutMs} ms. Check the ESP32 IP and Wi-Fi connection.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const status = await request("/status");
  log(JSON.stringify(status, null, 2));
  if (action === "status") return status;
  if (typeof status.controller_session !== "string" || !status.controller_session ||
      !Number.isSafeInteger(status.conveyor_sequence) || status.conveyor_sequence < 0) {
    throw new Error("Installed firmware does not report the conveyor contract. No movement requested.");
  }
  if (action !== "stop" && status.state !== "idle") {
    throw new Error(`Controller state is ${status.state}; wait until idle. No movement requested.`);
  }

  let session;
  let sequence;
  let lease;
  async function acquire() {
    const result = await request("/conveyor/lease");
    if (result.controller_session !== status.controller_session ||
        !Number.isSafeInteger(result.conveyor_sequence) || result.conveyor_sequence < 0 ||
        !Number.isSafeInteger(result.lease) || result.lease <= 0) {
      throw new Error("Invalid lease or controller restarted. Movement cancelled.");
    }
    session = result.controller_session;
    sequence = result.conveyor_sequence;
    lease = result.lease;
  }

  async function command(direction) {
    const previousLease = lease;
    const result = await request("/conveyor", {
      direction, controller_session: session, sequence: ++sequence, lease
    });
    if (result.controller_session !== session || result.conveyor_sequence !== sequence ||
        !Number.isSafeInteger(result.lease) || result.lease <= 0 || result.lease === previousLease) {
      throw new Error("Unverified conveyor receipt. Movement cancelled.");
    }
    lease = result.lease;
    if (result.accepted !== true) throw new Error(`Controller refused direction ${direction}.`);
  }

  let failure;
  let pulses = 0;
  let selectedManual = false;
  try {
    // Lease acquisition also stops any existing conveyor command locally.
    await acquire();
    if (action !== "stop" && !cancelled()) {
      const mode = await request("/mode", { mode: "manual" });
      if (mode.accepted !== true || mode.mode !== "manual") throw new Error("Manual mode was refused.");
      selectedManual = true;
      // A slow mode request can outlast the lease window; obtain a fresh lease.
      await acquire();
      await command(0);
      const end = now() + seconds * 1000;
      while (!cancelled() && now() < end) {
        await command(action === "forward" ? 1 : -1);
        pulses += 1;
        await sleep(Math.min(100, Math.max(0, end - now())));
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    // A fresh lease handles a lost response or an expired command token.
    // Requests are sequential so a movement request cannot overtake this stop.
    try {
      await acquire();
      await command(0);
      log("STOP acknowledged by ESP32.");
    } catch (error) {
      log(`STOP acknowledgement unavailable: ${error.message}`);
      log("Command renewals ended. The firmware stops the belt 500 ms after the last accepted command; check the belt physically.");
      failure ??= error;
    }
  }
  if (failure) throw failure;
  if (action !== "stop") log(`${pulses} movement commands acknowledged. Check physical rotation; HTTP acceptance cannot confirm motor movement.`);
  if (selectedManual) log("Controller remains in Manual mode.");
  return { pulses };
}

async function main() {
  const [baseUrl, action = "status", duration = "2", ...extra] = process.argv.slice(2);
  if (!baseUrl || extra.length) {
    throw new Error("Usage: node 360ControlUnit/test/conveyor-bench.mjs http://<ESP32-IP> [status|forward|reverse|stop] [seconds<=5]");
  }
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  try {
    await testConveyor({ baseUrl, action, seconds: Number(duration), cancelled: () => interrupted });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Conveyor test failed: ${error.message}`);
    if (error.cause?.message) console.error(error.cause.message);
    process.exitCode = 1;
  });
}
