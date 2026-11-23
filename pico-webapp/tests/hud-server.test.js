import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHandler } from "../tools/hud-server.mjs";

async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function send(base, pathname, { method = "GET", body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(base, {
      path: pathname,
      method,
      headers: body ? { "content-type": "application/json" } : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString()
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function publicRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "cn360-hud-server-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "tools"));
  await writeFile(path.join(root, "index.html"), "<h1>VisionQC</h1>");
  await writeFile(path.join(root, "tools", "dev-key.pem"), "TEST-ONLY-PRIVATE-FILE");
  await writeFile(path.join(root, "package.json"), "{}");
  return root;
}

test("serves the HUD and HEAD requests without caching", async (t) => {
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1" }));
  const page = await send(base, "/");
  assert.equal(page.status, 200);
  assert.equal(page.body, "<h1>VisionQC</h1>");
  assert.match(page.headers["content-type"], /text\/html/);
  assert.equal(page.headers["cache-control"], "no-store");
  const head = await send(base, "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(page.body));
  assert.equal((await send(base, "/", { method: "POST" })).status, 405);
});

test("never serves private files through encoded or Windows alias paths", async (t) => {
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1" }));
  for (const pathname of [
    "/tools/dev-key.pem",
    "/%74ools/dev-key.pem",
    "/tools%2fdev-key.pem",
    "/tools%5cdev-key.pem",
    "/TOOLS/dev-key.pem",
    "/tools./dev-key.pem",
    "/tools%20/dev-key.pem",
    "/package.json",
    "/%70ackage.json",
    "/tools/dev-key.pem::$DATA"
  ]) {
    const result = await send(base, pathname);
    assert.ok([403, 404].includes(result.status), `${pathname}: ${result.status}`);
    assert.doesNotMatch(result.body, /TEST-ONLY-PRIVATE-FILE/);
  }
});

test("forwards controller commands and firmware acceptance through /esp", async (t) => {
  const received = [];
  const upstream = await listen(t, (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, body, type: req.headers["content-type"] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"accepted":false}');
    });
  });
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: upstream }));
  const result = await send(base, "/esp/servo?source=vr", {
    method: "POST", body: '{"sweep":true}'
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { accepted: false });
  assert.deepEqual(received, [{
    method: "POST", url: "/servo?source=vr", body: '{"sweep":true}', type: "application/json"
  }]);
});

test("reports an unreachable control unit as an HTTP failure", async (t) => {
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1" }));
  const result = await send(base, "/esp/servo", { method: "POST", body: '{"sweep":true}' });
  assert.equal(result.status, 504);
  assert.equal(JSON.parse(result.body).error, "control unit unreachable");
});
