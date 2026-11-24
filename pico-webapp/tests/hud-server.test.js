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

function send(base, pathname, { method = "GET", body = "", headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(base, {
      path: pathname,
      method,
      headers: headers ?? (body ? { "content-type": "application/json" } : {})
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


function collectUpstream(received, respond) {
  return (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, body, type: req.headers["content-type"] });
      respond(res);
    });
  };
}

test("forwards a capture request to n8n as an unpaired inspect-now", async (t) => {
  const received = [];
  const n8n = await listen(t, collectUpstream(received, (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"success","result":"pass","item":null}');
  }));
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1", n8nOrigin: n8n }));

  // Whatever the browser sends, n8n only ever receives an empty object, so the request cannot
  // carry an item identity and become a paired inspection.
  const result = await send(base, "/n8n/inspect-now?x=1", {
    method: "POST", body: '{"controller_session":"abc","item_id":"7","testCaseId":"x"}'
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { status: "success", result: "pass", item: null });
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(received, [{
    method: "POST", url: "/webhook/inspect-now", body: "{}", type: "application/json"
  }]);
});

test("only accepts JSON POST requests on the capture path", async (t) => {
  const received = [];
  const n8n = await listen(t, collectUpstream(received, (res) => { res.writeHead(200); res.end("{}"); }));
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1", n8nOrigin: n8n }));

  const get = await send(base, "/n8n/inspect-now");
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, "POST");

  for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"]) {
    const result = await send(base, "/n8n/inspect-now", { method: "POST", body: "{}", headers: { "content-type": type } });
    assert.equal(result.status, 415, type);
  }
  const noType = await send(base, "/n8n/inspect-now", { method: "POST", body: "{}", headers: {} });
  assert.equal(noType.status, 415);

  const tooLarge = await send(base, "/n8n/inspect-now", { method: "POST", body: " ".repeat(5000) });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(received, []);
});

test("passes n8n errors through and reports an unreachable n8n", async (t) => {
  const n8n = await listen(t, (req, res) => {
    req.resume();
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"code":404,"message":"The requested webhook is not registered."}');
  });
  const root = await publicRoot(t);
  const inactive = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1", n8nOrigin: n8n }));
  const notFound = await send(inactive, "/n8n/inspect-now", { method: "POST", body: "{}" });
  assert.equal(notFound.status, 404);
  assert.equal(JSON.parse(notFound.body).code, 404);

  const down = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1", n8nOrigin: "http://127.0.0.1:1" }));
  const unreachable = await send(down, "/n8n/inspect-now", { method: "POST", body: "{}" });
  assert.equal(unreachable.status, 504);
  assert.equal(JSON.parse(unreachable.body).error, "n8n unreachable");
});

test("runs one inspection at a time", async (t) => {
  let releaseUpstream;
  const gate = new Promise((resolve) => { releaseUpstream = resolve; });
  let markArrived;
  const firstArrived = new Promise((resolve) => { markArrived = resolve; });
  let calls = 0;
  const n8n = await listen(t, (req, res) => {
    req.resume();
    calls += 1;
    markArrived();
    gate.then(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"success","result":"reject"}');
    });
  });
  const root = await publicRoot(t);
  const base = await listen(t, createHandler({ root, controlUnit: "http://127.0.0.1:1", n8nOrigin: n8n }));

  const first = send(base, "/n8n/inspect-now", { method: "POST", body: "{}" });
  await firstArrived;
  const second = await send(base, "/n8n/inspect-now", { method: "POST", body: "{}" });
  assert.equal(second.status, 429);
  assert.equal(JSON.parse(second.body).error, "an inspection is already running");
  assert.equal(calls, 1);

  releaseUpstream();
  assert.equal((await first).status, 200);
  // The slot is freed when the upstream request closes, a moment after the answer is relayed.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const third = await send(base, "/n8n/inspect-now", { method: "POST", body: "{}" });
  assert.equal(third.status, 200);
  assert.equal(calls, 2);
});

test("rejects an n8n origin that carries a path or credentials", () => {
  for (const origin of ["http://n8n:5678/webhook", "http://user:pw@n8n:5678", "ftp://n8n", "not a url", "http://n8n:5678/?a=1"]) {
    assert.throws(
      () => createHandler({ root: ".", controlUnit: "http://127.0.0.1:1", n8nOrigin: origin }),
      /--n8n-origin must be an HTTP\(S\) origin/,
      origin
    );
  }
});
