import test from "node:test";
import assert from "node:assert/strict";
import { testConveyor } from "./conveyor-bench.mjs";

function bench({ refuseMovement = false, loseMovementResponse = false, restart = false, state = "idle" } = {}) {
  const calls = [];
  let clock = 0;
  let sequence = 10;
  let lease = 100;
  const options = {
    baseUrl: "http://controller.test",
    log() {},
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    async fetchImpl(url, init) {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ path: url.pathname, body });
      let result;
      if (url.pathname === "/status") {
        result = { controller_session: "boot-a", conveyor_sequence: sequence, state };
      } else if (url.pathname === "/mode") {
        result = { accepted: true, mode: body.mode };
      } else if (url.pathname === "/conveyor/lease") {
        result = { controller_session: restart ? "boot-b" : "boot-a", conveyor_sequence: sequence, lease: ++lease };
      } else {
        assert.equal(body.controller_session, "boot-a");
        assert.equal(body.lease, lease);
        assert.equal(body.sequence, sequence + 1);
        sequence = body.sequence;
        result = { accepted: !(refuseMovement && body.direction !== 0), controller_session: "boot-a", conveyor_sequence: sequence, lease: ++lease };
        if (loseMovementResponse && body.direction !== 0) throw new Error("Response lost after movement");
      }
      return { ok: true, json: async () => result };
    }
  };
  return { options, calls };
}

test("status is read-only", async () => {
  const { options, calls } = bench();
  await testConveyor(options);
  assert.deepEqual(calls.map((c) => c.path), ["/status"]);
});

for (const [action, direction] of [["forward", 1], ["reverse", -1]]) {
  test(`${action} selects Manual, centers, renews ordered leases and stops`, async () => {
    const { options, calls } = bench();
    await testConveyor({ ...options, action, seconds: 0.3 });
    const commands = calls.filter((c) => c.path === "/conveyor");
    assert.deepEqual(commands.map((c) => c.body.direction), [0, direction, direction, direction, 0]);
    assert.ok(calls.findIndex((c) => c.path === "/mode") < calls.findIndex((c) => c.path === "/conveyor"));
    assert.equal(calls.at(-2).path, "/conveyor/lease");
  });
}

for (const fault of ["refuseMovement", "loseMovementResponse"]) {
  test(`${fault} cancels movement and obtains a fresh lease to stop`, async () => {
    const { options, calls } = bench({ [fault]: true });
    await assert.rejects(testConveyor({ ...options, action: "forward" }));
    assert.equal(calls.filter((c) => c.body?.direction === 1).length, 1);
    assert.equal(calls.at(-2).path, "/conveyor/lease");
    assert.equal(calls.at(-1).body.direction, 0);
  });
}

test("stop works without changing operating mode", async () => {
  const { options, calls } = bench();
  await testConveyor({ ...options, action: "stop" });
  assert.ok(!calls.some((c) => c.path === "/mode"));
  assert.equal(calls.at(-1).body.direction, 0);
});

test("interruption ends renewals and sends stop", async () => {
  const { options, calls } = bench();
  let interrupted = false;
  await testConveyor({ ...options, action: "forward", cancelled: () => interrupted,
    sleep: async () => { interrupted = true; } });
  assert.equal(calls.filter((c) => c.body?.direction === 1).length, 1);
  assert.equal(calls.at(-1).body.direction, 0);
});

test("restart is refused before sending a movement command", async () => {
  const { options, calls } = bench({ restart: true });
  await assert.rejects(testConveyor({ ...options, action: "forward" }), /restarted/);
  assert.ok(!calls.some((c) => c.path === "/conveyor"));
});

test("long duration is refused before accessing hardware", async () => {
  const { options, calls } = bench();
  await assert.rejects(testConveyor({ ...options, action: "forward", seconds: 10 }), /at most 5/);
  assert.equal(calls.length, 0);
});

test("active inspection refuses a movement test without changing mode", async () => {
  const { options, calls } = bench({ state: "awaiting_verdict" });
  await assert.rejects(testConveyor({ ...options, action: "forward" }), /wait until idle/);
  assert.deepEqual(calls.map((c) => c.path), ["/status"]);
});

test("old firmware status is refused before obtaining a lease", async () => {
  let requests = 0;
  await assert.rejects(testConveyor({ baseUrl: "http://controller.test", action: "forward", log() {},
    fetchImpl: async () => { requests += 1; return { ok: true, json: async () => ({ state: "idle" }) }; }
  }), /does not report the conveyor contract/);
  assert.equal(requests, 1);
});

test("read-only status permits a response slower than the former 250 ms limit", async () => {
  await testConveyor({ baseUrl: "http://controller.test", log() {},
    fetchImpl: async (url, init) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 350);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
      return { ok: true, json: async () => ({ state: "idle" }) };
    }
  });
});

test("timeout identifies the endpoint and allowed wait", async () => {
  await assert.rejects(testConveyor({ baseUrl: "http://controller.test", log() {},
    fetchImpl: async () => { throw new DOMException("Aborted", "AbortError"); }
  }), /http:\/\/controller.test\/status: no complete response within 5000 ms/);
});
