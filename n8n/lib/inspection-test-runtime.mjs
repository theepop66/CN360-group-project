import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { configureWorkflows } from "../configure.mjs";
import { WORKFLOW_FILES } from "./workflow-definitions.mjs";

export function command(executable, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { windowsHide: true, ...options });
    let stdout = ""; let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? accept(stdout) : reject(new Error(`${executable} exited ${code}: ${stderr || stdout}`)));
  });
}

function callback(name, origin, expression) {
  return { id: "test-" + name, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 250,
    position: [4800, 0], parameters: { method: "POST", url: origin + "/completed", sendBody: true, specifyBody: "json", jsonBody: expression, options: { timeout: 3000 } } };
}

export function testWorkflows(origin, { supabaseCredentialId, runtimeConfig = {}, ambient = false } = {}) {
  const configured = configureWorkflows({ modelBaseUrl: origin, piBaseUrl: origin, esp32BaseUrl: origin, relayBaseUrl: origin, supabaseBaseUrl: origin, snapshotBucket: "static-test", coverageThreshold: 0.005, modelTimeoutMs: 1200,
    ...runtimeConfig, ...(supabaseCredentialId ? { supabaseCredentialId } : {}) }, "isolated-fixture-key");
  const inspection = configured[WORKFLOW_FILES.inspectionLoop];
  inspection.id = "cn360StaticTest";
  inspection.name = "CN360 TEST - Static picture inspection";
  inspection.nodes.find(n => n.name === "trigger-schedule").disabled = !ambient;
  if (ambient) inspection.nodes.find(n => n.name === "trigger-schedule").parameters.rule.interval = [{ field: "seconds", secondsInterval: 5 }];
  for (const name of ["done", "done-duplicate"]) {
    const old = inspection.nodes.find(n => n.name === name);
    Object.assign(old, callback(name, origin, "={{ JSON.stringify({ testCaseId: ($('trigger-item-detected').isExecuted ? $('trigger-item-detected') : $('trigger-inspect-now')).first().json.body.testCaseId, executionId: $execution.id, decision: $('decide-inspection').first().json.decision, frame: $('read-frame-context').first().json.frameContext, control: $('capture-esp32-response').first().json.esp32, response: $('build-inspection-response').first().json.inspectionResponse, duplicate: $('build-record-duplicate').isExecuted || $('duplicate-guard').first().json.duplicate }) }}"));
  }
  const invalidComplete = "complete-invalid-item";
  inspection.nodes.push(callback(invalidComplete, origin, "={{ JSON.stringify({ testCaseId: ($('trigger-item-detected').isExecuted ? $('trigger-item-detected') : $('trigger-inspect-now')).first().json.body.testCaseId, executionId: $execution.id, invalidItem: true }) }}"));
  inspection.connections["respond-invalid-item"] = { main: [[{ node: invalidComplete, type: "main", index: 0 }]] };
  const prompt = configured[WORKFLOW_FILES.promptCapture];
  prompt.id = "cn360PromptTest"; prompt.name = "CN360 TEST - Static prompt capture";
  for (const from of ["insert-prompt-history", "respond-rejected"]) {
    const name = "complete-" + from;
    prompt.nodes.push(callback(name, origin, "={{ JSON.stringify({ testCaseId: $('trigger-detection-prompt').first().json.body.testCaseId, executionId: $execution.id, promptComplete: true }) }}"));
    prompt.connections[from] = { main: [[{ node: name, type: "main", index: 0 }]] };
  }
  // Add only a test trigger. Probe/transition/row code remains the shipped code.
  const watchdog = configured[WORKFLOW_FILES.healthWatchdog];
  watchdog.id = "cn360HealthTest"; watchdog.name = "CN360 TEST - Static health watchdog";
  const trigger = watchdog.nodes.find(n => n.name === "trigger-health-schedule");
  trigger.type = "n8n-nodes-base.webhook"; trigger.typeVersion = 2;
  trigger.webhookId = "cn360-static-health-hook";
  trigger.parameters = { httpMethod: "POST", path: "static-health", responseMode: "onReceived", options: {} };
  // A separate completion branch observes both probes even when no transition is emitted.
  for (const from of ["probe-model-result", "probe-capture-result"]) {
    const name = "complete-" + from;
    watchdog.nodes.push(callback(name, origin, "={{ JSON.stringify({ testCaseId: $('trigger-health-schedule').first().json.body.testCaseId, executionId: $execution.id, healthProbe: $json.component, healthy: $json.healthy }) }}"));
    watchdog.connections[from].main[0].push({ node: name, type: "main", index: 0 });
  }
  for (const [flow, expression] of [
    [inspection, "={{ ($('trigger-item-detected').isExecuted ? $('trigger-item-detected') : $('trigger-inspect-now')).first().json.body.testCaseId }}"],
    [prompt, "={{ $('trigger-detection-prompt').first().json.body.testCaseId }}"],
    [watchdog, "={{ $('trigger-health-schedule').first().json.body.testCaseId }}"]
  ]) {
    for (const node of flow.nodes.filter(node => node.type === "n8n-nodes-base.httpRequest")) {
      node.parameters.sendHeaders = true;
      node.parameters.headerParameters ??= { parameters: [] };
      node.parameters.headerParameters.parameters.push({ name: "X-CN360-Test-Case", value: expression });
      node.parameters.headerParameters.parameters.push({ name: "X-CN360-Test-Execution", value: "={{ $execution.id }}" });
    }
  }
  if (ambient) {
    // The production scheduled branch stays unchanged; test instrumentation
    // needs a case identity even when neither webhook trigger has executed.
    for (const node of inspection.nodes) {
      const replace = value => typeof value === "string" ? value.replaceAll("($('trigger-item-detected').isExecuted ? $('trigger-item-detected') : $('trigger-inspect-now')).first().json.body.testCaseId",
        "($('trigger-item-detected').isExecuted ? $('trigger-item-detected').first().json.body.testCaseId : $('trigger-inspect-now').isExecuted ? $('trigger-inspect-now').first().json.body.testCaseId : 'ambient')") : value;
      if (node.parameters.jsonBody) node.parameters.jsonBody = replace(node.parameters.jsonBody);
      for (const header of node.parameters.headerParameters?.parameters ?? []) header.value = replace(header.value);
    }
  }
  return [inspection, prompt, watchdog];
}

export async function startTestN8n({ output, fixturePort, port = 5682, docker = "docker", image = "n8n-backup:latest", supabaseCredentialId, runtimeConfig, credentialFile, ambient }) {
  mkdirSync(output, { recursive: true });
  const origin = `http://host.docker.internal:${fixturePort}`;
  const flows = testWorkflows(origin, { supabaseCredentialId, runtimeConfig, ambient });
  if (supabaseCredentialId && !credentialFile) writeFileSync(join(output, "credentials.json"), JSON.stringify([
    { id: supabaseCredentialId, name: "CN360 Supabase", type: "supabaseApi", data: { host: origin, serviceRole: "isolated-fixture-key" } }
  ]) + "\n");
  writeFileSync(join(output, "workflows.json"), JSON.stringify(flows, null, 2) + "\n");
  const name = `cn360-static-test-${process.pid}`;
  let log = "";
  // The shell program is constant; user-supplied paths are separate Docker arguments.
  const program = (supabaseCredentialId ? `n8n import:credentials --input=${credentialFile ? "/credentials.json" : "/fixtures/credentials.json"} && ` : "") + "n8n import:workflow --input=/fixtures/workflows.json && n8n publish:workflow --id=cn360StaticTest && n8n publish:workflow --id=cn360PromptTest && n8n publish:workflow --id=cn360HealthTest && n8n start";
  const child = spawn(docker, ["run", "--rm", "--name", name, "--publish", `127.0.0.1:${port}:5678`, "--env", "N8N_USER_FOLDER=/tmp/cn360-static", "--env", "DB_TYPE=sqlite", "--env", "DB_SQLITE_DATABASE=/tmp/cn360-static.sqlite", "--env", "N8N_DIAGNOSTICS_ENABLED=false", "--env", "N8N_LICENSE_AUTO_RENEW_ENABLED=false", "--env", "N8N_RUNNERS_ENABLED=false", "--env", "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false", "--volume", `${resolve(output)}:/fixtures:ro`, ...(credentialFile ? ["--volume", `${resolve(credentialFile)}:/credentials.json:ro`] : []), "--entrypoint", "sh", image, "-c", program], { windowsHide: true });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  child.stdout.on("data", value => { log += value; }); child.stderr.on("data", value => { log += value; });
  const stop = async () => {
    writeFileSync(join(output, "n8n.log"), log);
    if (child.exitCode === null && !spawnError) await command(docker, ["stop", "--time", "3", name]).catch(() => {});
  };
  try {
    for (let i = 0; i < 120; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error("Test n8n stopped: " + log.slice(-1800));
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz/readiness`, { signal: AbortSignal.timeout(500) });
        if (response.ok && log.includes("Activated workflow \"CN360 TEST - Static health watchdog\"")) return {
          origin: `http://127.0.0.1:${port}`, stop,
          async executionDetails(ids) {
            if (!ids.length || ids.some(id => !/^\d+$/.test(String(id)))) return [];
            const script = `const db = new (require('node:sqlite').DatabaseSync)('/tmp/cn360-static.sqlite', {readOnly:true});
const rows = db.prepare('SELECT e.id,e.status,d.data FROM execution_entity e LEFT JOIN execution_data d ON d.executionId=e.id WHERE e.id IN (${ids.map(Number).join(",")})').all();
console.log(JSON.stringify(rows.map(({data,...row})=>{try { const parsed=JSON.parse(data); const root=Array.isArray(parsed)?parsed[0]:parsed; const get=v=>Array.isArray(parsed)&&typeof v==='string'&&/^\\d+$/.test(v)?parsed[Number(v)]:v; const result=get(root.resultData); const error=get(result?.error); const runs=get(result?.runData)??{}; const nodes=Object.entries(runs).map(([name,value])=>({name,runs:get(value).map(ref=>{const run=get(ref);const err=get(run.error);return {status:get(run.executionStatus),error:err?{message:get(err.message),description:get(err.description)}:null};})})); return {...row,lastNode:get(result?.lastNodeExecuted),error: error?{message:get(error.message),description:get(error.description),name:get(error.name)}:null,nodes}; } catch{return row;} })));`;
            return JSON.parse(await command(docker, ["exec", name, "node", "--disable-warning=ExperimentalWarning", "-e", script]));
          },
          async waitExecutions(ids) {
            if (!ids.length || ids.some(id => !/^\d+$/.test(String(id)))) throw new Error("Invalid test execution IDs");
            const script = `const db = new (require('node:sqlite').DatabaseSync)('/tmp/cn360-static.sqlite', {readOnly:true}); console.log(JSON.stringify(db.prepare('SELECT id,status FROM execution_entity WHERE id IN (${ids.map(Number).join(",")})').all()));`;
            for (let attempt = 0; attempt < 40; attempt++) {
              const rows = JSON.parse(await command(docker, ["exec", name, "node", "--disable-warning=ExperimentalWarning", "-e", script]));
              if (rows.length === new Set(ids).size && rows.every(row => ["success", "error", "canceled", "crashed"].includes(row.status))) return rows;
              await delay(100);
            }
            throw new Error("n8n executions did not finish after the callback");
          }
        };
      } catch { /* wait for the owned runtime only */ }
      await delay(500);
    }
    throw new Error("Test n8n readiness timeout: " + log.slice(-1800));
  } catch (error) { await stop(); throw error; }
}
