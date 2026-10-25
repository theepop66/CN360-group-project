// Runs the shipped graph in a disposable n8n container against HTTP fixtures.
// Never imports into the user's n8n instance and never contacts real actuators.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { configureWorkflows } from "../configure.mjs";
import { WORKFLOW_FILES } from "../lib/workflow-definitions.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, ".runtime");
mkdirSync(output, { recursive: true });
mkdirSync(join(root, "../docs/evidence"), { recursive: true });
const docker = process.env.CN360_DOCKER ?? "docker";
const fixtureImage = readFileSync(process.argv[2]);
const webhooksOnly = process.argv.includes("--webhooks-only");
let scenario = "pass";
let instruction = "Locate all the instances that matches the following description: scratch.";
const observed = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, "http://fixture");
  const reply = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname === "/capture") {
    res.writeHead(200, { "content-type": "image/png", "x-camera-session": "fixture-session", "x-frame-sequence": "7", "x-captured-at": "2026-10-20T00:00:00Z", "x-frame-width": "448", "x-frame-height": "448" });
    return res.end(fixtureImage);
  }
  if (url.pathname === "/get_prompt") return reply(200, { status: "ok", current_prompt: instruction });
  if (url.pathname === "/set_prompt") {
    if (scenario === "prompt-error") return reply(503, { status: "error" });
    instruction = url.searchParams.get("prompt");
    return reply(200, { status: "updated", current_prompt: instruction });
  }
  if (url.pathname === "/predict") {
    const validFile = body.includes(Buffer.from('name="file"')) && body.includes(fixtureImage);
    const validPrompt = body.includes(Buffer.from(instruction));
    observed.push({ stage: "model", validFile, validPrompt });
    if (!validFile || !validPrompt) return reply(422, { status: "error", reason: "fixture_contract_failed" });
    if (scenario === "model-error") return reply(200, { status: "error", reason: "inference_failed" });
    if (scenario === "timeout") await new Promise(resolve => setTimeout(resolve, 1500));
    return reply(200, { status: "success", prompt_used: instruction, detections: scenario === "reject" ? [{ label: "scratch", box: [0, 0, 100, 100] }] : [] });
  }
  if (url.pathname === "/verdict") {
    observed.push({ stage: "actuator-fixture", ...JSON.parse(body) });
    return reply(200, { accepted: true, status: "accepted" });
  }
  if (url.pathname.startsWith("/rest/v1/")) return reply(200, [{ id: "fixture-inspection" }]);
  return reply(200, {});
});
await new Promise(resolve => server.listen(8100, "0.0.0.0", resolve));

function execute(file) {
  return new Promise((resolve, reject) => {
    const command = `n8n import:workflow --input=/fixtures/${file} >/dev/null && n8n execute --id=cn360-fixture-inspection --rawOutput`;
    const child = spawn(docker, ["run", "--rm", "--env", "N8N_USER_FOLDER=/tmp/cn360-isolated", "--env", "DB_TYPE=sqlite", "--env", "DB_SQLITE_DATABASE=/tmp/cn360.sqlite", "--env", "N8N_DIAGNOSTICS_ENABLED=false", "--env", "N8N_RUNNERS_ENABLED=false", "--volume", `${output}:/fixtures:ro`, "--entrypoint", "sh", "n8n-backup:latest", "-c", command], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("exit", code => {
      writeFileSync(join(output, `${file}.log`), stdout + stderr);
      if (code) return reject(new Error(`n8n exit ${code}; see .runtime/${file}.log`));
      for (const line of stdout.split(/\r?\n/)) {
        try { const parsed = JSON.parse(line); if (parsed.data?.resultData) return resolve(parsed); } catch {}
      }
      for (let index = stdout.indexOf("{"); index >= 0; index = stdout.indexOf("{", index + 1)) {
        try { return resolve(JSON.parse(stdout.slice(index))); } catch {}
      }
      reject(new Error("n8n did not return execution JSON"));
    });
  });
}

const base = "http://host.docker.internal:8100";
const configured = configureWorkflows({ modelBaseUrl: base, piBaseUrl: base, esp32BaseUrl: base, relayBaseUrl: base, supabaseBaseUrl: base, snapshotBucket: "fixture", coverageThreshold: 0.005, modelTimeoutMs: 1200 }, "fixture-key");
const reports = [];
try {
  for (const [name, expected] of webhooksOnly ? [] : [["pass", "pass"], ["reject", "reject"], ["model-error", "error"], ["timeout", "error"]]) {
    scenario = name;
    observed.length = 0;
    const workflow = structuredClone(configured[WORKFLOW_FILES.inspectionLoop]);
    workflow.id = "cn360-fixture-inspection";
    workflow.nodes.find(node => node.name === "trigger-inspect-now").type = "n8n-nodes-base.manualTrigger";
    workflow.nodes.find(node => node.name === "trigger-inspect-now").parameters = {};
    workflow.nodes.find(node => node.name === "trigger-schedule").disabled = true;
    for (const terminal of ["done", "done-duplicate"]) {
      const node = workflow.nodes.find(node => node.name === terminal);
      node.type = "n8n-nodes-base.code";
      node.typeVersion = 2;
      node.parameters = { jsCode: "return [{json: {response: $('build-inspection-response').first().json.inspectionResponse, frame: $('read-frame-context').first().json.frameContext, action: $('to-control-action').first().json.action}}];" };
    }
    const file = `${name}.json`;
    writeFileSync(join(output, file), JSON.stringify(workflow));
    const execution = await execute(file);
    const result = execution.data.resultData;
    if (result.error) throw new Error(JSON.stringify(result.error));
    const delivered = result.runData[result.lastNodeExecuted][0].data.main[0][0].json;
    assert.equal(delivered.response.result, expected);
    assert.equal(delivered.action, expected === "pass" ? "pass" : "reject");
    assert.equal(delivered.frame.sessionId, "fixture-session");
    assert.equal(delivered.frame.sequence, 7);
    assert.ok(observed.some(item => item.stage === "model" && item.validFile && item.validPrompt));
    assert.ok(observed.some(item => item.stage === "actuator-fixture" && item.action === delivered.action));
    reports.push({ scenario, ...delivered, observed: [...observed] });
    console.log(`${name}: ${expected}, actuator=${delivered.action}`);
  }
  for (const [name, target, expected] of webhooksOnly ? [] : [["prompt-ok", "mold", "updated"], ["prompt-blank", " ", "rejected"], ["prompt-error", "scratch", "error"]]) {
    scenario = name;
    const previous = instruction;
    const workflow = structuredClone(configured[WORKFLOW_FILES.promptCapture]);
    workflow.id = "cn360-fixture-inspection";
    workflow.nodes.push(
      { id: "fixture-manual", name: "fixture-manual", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [-800, 0], parameters: {} },
      { id: "fixture-body", name: "fixture-body", type: "n8n-nodes-base.code", typeVersion: 2, position: [-600, 0], parameters: { jsCode: `return [{json: {body: {prompt: ${JSON.stringify(target)}}}}];` } },
      { id: "fixture-result", name: "fixture-result", type: "n8n-nodes-base.code", typeVersion: 2, position: [1300, 0], parameters: { jsCode: "return [{json: {status: $('respond-ok').isExecuted ? 'updated' : $('respond-model-error').isExecuted ? 'error' : 'rejected'}}];" } }
    );
    workflow.connections["fixture-manual"] = { main: [[{ node: "fixture-body", type: "main", index: 0 }]] };
    workflow.connections["fixture-body"] = { main: [[{ node: "build-instruction", type: "main", index: 0 }]] };
    workflow.connections["insert-prompt-history"] = { main: [[{ node: "fixture-result", type: "main", index: 0 }]] };
    workflow.connections["respond-rejected"] = { main: [[{ node: "fixture-result", type: "main", index: 0 }]] };
    const file = `${name}.json`;
    writeFileSync(join(output, file), JSON.stringify(workflow));
    const execution = await execute(file);
    const result = execution.data.resultData;
    if (result.error) throw new Error(JSON.stringify(result.error));
    const delivered = result.runData[result.lastNodeExecuted][0].data.main[0][0].json;
    assert.equal(delivered.status, expected);
    assert.equal(instruction, expected === "updated" ? `Locate all the instances that matches the following description: ${target}.` : previous);
    reports.push({ scenario, ...delivered, instructionUnchanged: expected !== "updated" ? instruction === previous : null });
    console.log(`${name}: ${expected}`);
  }
  if (!webhooksOnly) writeFileSync(join(root, "../docs/evidence/n8n-runtime-fixtures-2026-10-20.json"), JSON.stringify({ runtime: "n8n 2.6.4 disposable container", boundary: "CLI manual trigger running shipped graph; external services are HTTP fixtures, no real hardware", reports }, null, 2) + "\n");

  // Public Webhook HTTP boundary with unmodified trigger/response nodes.
  const liveFlows = [structuredClone(configured[WORKFLOW_FILES.inspectionLoop]), structuredClone(configured[WORKFLOW_FILES.promptCapture])];
  liveFlows[0].id = "cn360-fixture-inspection";
  liveFlows[1].id = "cn360-fixture-prompt";
  liveFlows[0].nodes.find(node => node.name === "trigger-schedule").disabled = true;
  writeFileSync(join(output, "webhooks.json"), JSON.stringify(liveFlows));
  const name = `cn360-webhook-smoke-${process.pid}`;
  const command = "n8n import:workflow --input=/fixtures/webhooks.json >/dev/null && n8n publish:workflow --id=cn360-fixture-inspection >/dev/null && n8n publish:workflow --id=cn360-fixture-prompt >/dev/null && n8n start";
  const live = spawn(docker, ["run", "--rm", "--name", name, "--publish", "127.0.0.1:5681:5678", "--env", "N8N_USER_FOLDER=/tmp/cn360-isolated", "--env", "DB_TYPE=sqlite", "--env", "DB_SQLITE_DATABASE=/tmp/cn360.sqlite", "--env", "N8N_DIAGNOSTICS_ENABLED=false", "--env", "N8N_LICENSE_AUTO_RENEW_ENABLED=false", "--volume", `${output}:/fixtures:ro`, "--entrypoint", "sh", "n8n-backup:latest", "-c", command], { windowsHide: true });
  let liveLog = "";
  live.stdout.on("data", data => { liveLog += data; });
  live.stderr.on("data", data => { liveLog += data; });
  const stop = () => new Promise(resolve => {
    const child = spawn(docker, ["stop", "--time", "5", name], { windowsHide: true, stdio: "ignore" });
    child.on("exit", resolve);
    child.on("error", resolve);
  });
  const webhookReports = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (live.exitCode !== null) throw new Error("Disposable webhook server exited");
      try {
        const health = await fetch("http://127.0.0.1:5681/healthz/readiness", { signal: AbortSignal.timeout(500) });
        if (health.ok && liveLog.includes("Activated workflow") && liveLog.includes("cn360-fixture-prompt")) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Disposable webhook server did not become ready");
    const post = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:5681/webhook/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`Webhook ${path} HTTP ${response.status}: ${text.slice(0, 100)}`);
      return { httpStatus: response.status, body: JSON.parse(text) };
    };
    for (const [mode, expected, path = "inspect-now"] of [["pass", "pass"], ["reject", "reject"], ["model-error", "error"], ["timeout", "error"], ["pass", "pass", "item-detected"]]) {
      scenario = mode;
      observed.length = 0;
      const received = await post(path, {});
      assert.equal(received.body.result, expected);
      assert.ok(observed.some(row => row.stage === "model" && row.validFile && row.validPrompt));
      assert.ok(observed.some(row => row.stage === "actuator-fixture" && row.action === (expected === "pass" ? "pass" : "reject")));
      webhookReports.push({ scenario, path, ...received, observed: [...observed] });
      console.log(`public webhook ${path} ${scenario}: ${expected}`);
    }
    for (const [mode, prompt, expectedStatus, expectedBodyStatus] of [["prompt-ok", "hole", 200, "updated"], ["prompt-blank", " ", 400, "rejected"], ["prompt-error", "mold", 502, "error"]]) {
      scenario = mode;
      const received = await post("detection-prompt", { prompt });
      assert.equal(received.httpStatus, expectedStatus);
      assert.equal(received.body.status, expectedBodyStatus);
      webhookReports.push({ scenario, ...received });
      console.log(`public webhook ${scenario}: HTTP ${expectedStatus}`);
    }
    writeFileSync(join(root, "../docs/evidence/n8n-webhook-fixtures-2026-10-20.json"), JSON.stringify({ runtime: "n8n 2.6.4 disposable server", boundary: "Real public HTTP webhooks, shipped triggers and response nodes, HTTP fixtures for external services, no real hardware", reports: webhookReports }, null, 2) + "\n");
  } finally {
    writeFileSync(join(output, "webhook-server.log"), liveLog);
    if (live.exitCode === null) await stop();
  }
} finally {
  server.closeAllConnections();
  server.close();
}
