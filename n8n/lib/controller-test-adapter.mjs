import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parsePhysicalItem } from "./item-control.mjs";

// A thin HTTP-facing adapter to the executable linked to ControlUnitState.cpp.
// It owns transport/virtual time only; it never decides the physical item outcome.
export function startControllerAdapter(executable) {
  const child = spawn(executable, [], { windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  let pending;
  let fatal;
  let queue = Promise.resolve();
  const fail = error => { fatal = error; pending?.reject(error); pending = null; };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", code => fail(new Error(`Controller adapter exited ${code}`)));
  lines.on("line", line => {
    try { pending?.resolve(JSON.parse(line)); } catch (error) { pending?.reject(error); }
    pending = null;
  });
  function send(line) {
    const request = queue.then(() => new Promise((resolve, reject) => {
      if (fatal) { reject(fatal); return; }
      const timeout = setTimeout(() => { fail(new Error("Controller adapter did not respond")); child.kill(); }, 3000);
      pending = { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } };
      child.stdin.write(line + "\n");
    }));
    queue = request.catch(() => {});
    return request;
  }
  return {
    reset(session = "test-boot", now = 0, enabled = true) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) throw new Error("Invalid test session");
      return send(`reset ${now >>> 0} ${session} ${enabled ? 1 : 0}`);
    },
    step(now, present) { return send(`step ${now >>> 0} ${present ? 1 : 0}`); },
    async admit(now) {
      await this.step(now, false);
      await this.step(now + 1, true);
      return this.step(now + 31, true);
    },
    async verdict(body, now) {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { httpStatus: 400, body: { accepted: false, status: "ignored", reason: "invalid_request" } };
      }
      const parsed = parsePhysicalItem("item_detected", { ...body, verdict_window_ms: 3000 });
      if (parsed.error || !["pass", "reject"].includes(body.action)) {
        return { httpStatus: 400, body: { accepted: false, status: "ignored", reason: "invalid_request", controller_session: body.controller_session ?? null, item_id: body.item_id ?? null } };
      }
      return { httpStatus: 200, body: await send(`verdict ${now >>> 0} ${body.controller_session} ${body.item_id} ${body.action}`) };
    },
    async close() {
      if (fatal || child.exitCode !== null) { lines.close(); return; }
      const done = new Promise(resolve => child.once("exit", resolve));
      child.stdin.end();
      await done;
      lines.close();
    }
  };
}
