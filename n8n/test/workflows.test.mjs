import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLACEHOLDERS,
  WORKFLOW_FILES,
  buildAllWorkflows,
  serializeWorkflows,
  sharedLogicSource
} from "../lib/workflow-definitions.mjs";
import {
  CAPTURE_TIMEOUT_MS,
  MODEL_PROMPT_TIMEOUT_MS,
  MODEL_TIMEOUT_MS,
  VERDICT_POST_TIMEOUT_MS,
  VERDICT_WINDOW_MS
} from "../lib/inspection-logic.mjs";
import { MODEL_INSTRUCTION_TEMPLATE } from "../lib/inspection-records.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = join(HERE, "..", "workflows");

const workflows = buildAllWorkflows();
const inspection = workflows[WORKFLOW_FILES.inspectionLoop];
const promptCapture = workflows[WORKFLOW_FILES.promptCapture];
const healthWatchdog = workflows[WORKFLOW_FILES.healthWatchdog];

function nodeNamed(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `workflow has no node named ${name}`);
  return node;
}

// Breadth-first reachability order, which is the order data actually flows in.
function walk(workflow, from) {
  const seen = [from];
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const branch of workflow.connections[current]?.main ?? []) {
      for (const target of branch) {
        if (seen.includes(target.node)) continue;
        seen.push(target.node);
        queue.push(target.node);
      }
    }
  }

  return seen;
}

function allWorkflowText() {
  return Object.values(workflows)
    .map((workflow) => JSON.stringify(workflow))
    .join("\n");
}

function codeOf(workflow, name) {
  return nodeNamed(workflow, name).parameters.jsCode;
}

// Every Code node is prefixed with the whole inlined library, so assertions
// about what a node's own glue does have to look past that prefix.
function glueOf(workflow, name) {
  const code = codeOf(workflow, name);
  const shared = sharedLogicSource();
  assert.ok(code.startsWith(shared), `${name} has stale inlined logic. Run: npm run build`);
  return code.slice(shared.length);
}

// A node dominates another if removing the first makes the second unreachable.
// This is the honest way to assert "X always happens before Y" in a graph with
// fan-out and merges, where depth order means nothing.
function dominates(workflow, earlier, later) {
  const withoutEarlier = {
    ...workflow,
    connections: Object.fromEntries(
      Object.entries(workflow.connections).filter(([from]) => from !== earlier)
    )
  };
  return !walk(withoutEarlier, "begin-inspection").includes(later);
}

test("the committed workflow files match a fresh build", () => {
  const expected = serializeWorkflows(workflows);
  for (const [file, contents] of Object.entries(expected)) {
    const committed = readFileSync(join(WORKFLOW_DIR, file), "utf8");
    assert.equal(
      committed,
      contents,
      `workflows/${file} is stale. Run: npm run build`
    );
  }
});

test("every workflow file exists on disk", () => {
  for (const file of Object.values(WORKFLOW_FILES)) {
    assert.doesNotThrow(
      () => readFileSync(join(WORKFLOW_DIR, file), "utf8"),
      `workflows/${file} is missing. Run: npm run build`
    );
  }
});

test("every workflow is valid JSON with a name and nodes", () => {
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.equal(typeof workflow.name, "string", file);
    assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, file);
    assert.equal(workflow.active, false, `${file} must not import as active`);
  }
});

test("the three workflows are split by concern", () => {
  const names = Object.values(workflows).map((workflow) => workflow.name);
  assert.deepEqual(names, [
    "CN360 - Inspection Loop",
    "CN360 - Prompt Capture",
    "CN360 - Health Watchdog"
  ]);
});

test("the inspection loop exposes all three triggers", () => {
  const types = inspection.nodes.map((node) => node.type);
  assert.equal(types.filter((type) => type === "n8n-nodes-base.webhook").length, 2);
  assert.ok(types.includes("n8n-nodes-base.scheduleTrigger"));
});

test("the item webhook keeps the ESP32 path", () => {
  assert.equal(nodeNamed(inspection, "trigger-item-detected").parameters.path, "item-detected");
  assert.equal(nodeNamed(inspection, "trigger-item-detected").parameters.httpMethod, "POST");
});

test("the manual trigger is inspect-now", () => {
  assert.equal(nodeNamed(inspection, "trigger-inspect-now").parameters.path, "inspect-now");
});

test("the prompt webhook keeps the HUD path", () => {
  assert.equal(
    nodeNamed(promptCapture, "trigger-detection-prompt").parameters.path,
    "detection-prompt"
  );
  assert.equal(
    nodeNamed(promptCapture, "trigger-detection-prompt").parameters.httpMethod,
    "POST"
  );
});

test("the frame is pulled from the capture service, not pushed to it", () => {
  const capture = nodeNamed(inspection, "capture-frame");
  assert.equal(capture.parameters.method, "GET");
  assert.equal(capture.parameters.url, `=http://${PLACEHOLDERS.piHost}/capture`);
});

test("the model is asked over multipart with the image and the instruction", () => {
  const detect = nodeNamed(inspection, "detect-defects");
  assert.equal(detect.parameters.contentType, "multipart-form-data");

  const fields = detect.parameters.bodyParameters.parameters;
  const image = fields.find((field) => field.name === "image");
  const prompt = fields.find((field) => field.name === "prompt");

  assert.equal(image.parameterType, "formBinaryData");
  assert.equal(image.inputDataFieldName, "image");
  assert.equal(prompt.value, "={{ $('resolve-instruction').first().json.instruction }}");
});

test("the model timeout is a placeholder inside the verdict window", () => {
  const detect = nodeNamed(inspection, "detect-defects");
  assert.equal(detect.parameters.options.timeout, PLACEHOLDERS.modelTimeoutMs);
  assert.ok(MODEL_TIMEOUT_MS < VERDICT_WINDOW_MS, "documented default must fit the window");
});

test("the model server is asked for the prompt before every inspection", () => {
  assert.equal(
    nodeNamed(inspection, "fetch-current-prompt").parameters.url,
    `=https://${PLACEHOLDERS.modelHost}/get_prompt`
  );
  const order = inspection.nodes.map((node) => node.name);
  assert.ok(
    order.indexOf("resolve-instruction") < order.indexOf("detect-defects"),
    "the instruction is resolved before the model is called"
  );
});

test("the verdict reaches the ESP32 before anything is persisted or broadcast", () => {
  assert.ok(
    dominates(inspection, "post-verdict", "capture-esp32-response"),
    "the firmware result must be read after the verdict, not before"
  );

  // Persistence hangs off a 2-input merge, so it cannot run until the ESP32
  // verdict branch has arrived. numberInputs is what makes that true; without
  // it the snapshot branch would carry the run on its own.
  const join = nodeNamed(inspection, "join-snapshot-and-verdict");
  assert.equal(join.type, "n8n-nodes-base.merge");
  assert.equal(join.parameters.numberInputs, 2, "the join must wait for the verdict branch");

  const feeds = (target) =>
    Object.keys(inspection.connections)
      .filter((from) =>
        inspection.connections[from].main.some((branch) =>
          branch.some((link) => link.node === target)
        )
      )
      .sort();
  assert.deepEqual(feeds("join-snapshot-and-verdict"), [
    "capture-esp32-response",
    "upload-snapshot"
  ]);

  for (const downstream of [
    "insert-inspection",
    "insert-control-action",
    "broadcast-hud",
    "log-outcome"
  ]) {
    assert.ok(
      dominates(inspection, "join-snapshot-and-verdict", downstream),
      `${downstream} must hang off the join that waits for the verdict`
    );
  }
});

test("the snapshot URL is stored and broadcast, not left null", () => {
  const build = glueOf(inspection, "build-snapshot-url");
  assert.ok(build.includes("snapshotObjectName"), "the object name is computed once, upstream");
  assert.ok(build.includes("frameUrl"), "the public URL must be derived from the upload result");
  assert.ok(
    build.includes("stored ?"),
    "a failed upload must not leave a URL that points at nothing"
  );

  assert.ok(
    glueOf(inspection, "build-inspection-record").includes("frameUrl: base.frameUrl"),
    "the inspection row must carry the real frame_url"
  );

  const broadcast = nodeNamed(inspection, "broadcast-hud");
  assert.ok(
    broadcast.parameters.jsonBody.includes("hudPayload"),
    "the HUD payload must be built in a Code node, not inside an HTTP expression"
  );
});

test("the budget is verified before the model is called", () => {
  assert.ok(
    dominates(inspection, "verify-verdict-budget", "detect-defects"),
    "a budget that cannot fit must be known before the model call it governs"
  );
  assert.ok(glueOf(inspection, "verify-verdict-budget").includes("resolveVerdictBudget"));
});

test("the timeouts on the verdict path are budgeted, not left at defaults", () => {
  assert.equal(
    nodeNamed(inspection, "fetch-current-prompt").parameters.options.timeout,
    MODEL_PROMPT_TIMEOUT_MS
  );
  assert.equal(nodeNamed(inspection, "capture-frame").parameters.options.timeout, CAPTURE_TIMEOUT_MS);
  assert.equal(nodeNamed(inspection, "post-verdict").parameters.options.timeout, VERDICT_POST_TIMEOUT_MS);
});

test("the capture fans out to the model and the snapshot in one pass", () => {
  assert.deepEqual(inspection.connections["read-frame-context"].main[0].map((t) => t.node).sort(), [
    "detect-defects",
    "upload-snapshot"
  ]);
  assert.equal(nodeNamed(inspection, "join-snapshot-and-verdict").type, "n8n-nodes-base.merge");
});

test("a duplicate frame is dropped rather than flagged and sent on", () => {
  const guard = glueOf(inspection, "duplicate-guard");
  assert.ok(guard.includes("shouldSuppressDuplicate"));
  assert.ok(guard.includes("return []"), "the duplicate must not reach the ESP32");
  assert.equal(guard.includes("shouldActuate"), false);
});

test("the control action is anchored to the inserted inspection id", () => {
  const build = glueOf(inspection, "build-control-action");
  assert.ok(build.includes("inspectionId"), "the id comes back from PostgREST");
  assert.equal(
    build.includes("readEsp32Outcome"),
    false,
    "the firmware result is read once, upstream"
  );
  assert.ok(
    glueOf(inspection, "capture-esp32-response").includes("readEsp32Outcome"),
    "the firmware answers { accepted, status }, not esp32Accepted"
  );
});

test("the prompt comparison reaches the audit trail", () => {
  const log = glueOf(inspection, "build-outcome-log");
  assert.ok(log.includes("buildSystemLogRow"));
  for (const field of ["promptVerified", "promptMismatch", "esp32Accepted", "verdictBudget"]) {
    assert.ok(log.includes(field), `the outcome log must record ${field}`);
  }
});

test("the inspection target is not recovered by splitting the instruction", () => {
  const resolve = glueOf(inspection, "resolve-instruction");
  assert.ok(resolve.includes("parseInspectionTarget"));
  assert.equal(
    resolve.includes("description:"),
    false,
    "the canonical template is the only place the grammar is written down"
  );
});

test("every Supabase insert sends one named row, not the execution envelope", () => {
  const expected = {
    "insert-inspection": "inspectionRow",
    "insert-control-action": "controlActionRow",
    "log-outcome": "logRow",
    "insert-prompt-history": "promptRow"
  };

  for (const [node, field] of Object.entries(expected)) {
    const workflow = Object.values(workflows).find((candidate) =>
      candidate.nodes.some((n) => n.name === node)
    );
    const body = nodeNamed(workflow, node).parameters.jsonBody;
    assert.equal(body, `={{ JSON.stringify($json.${field}) }}`, `${node} must send $json.${field}`);
  }
});

test("the verdict body carries only the action", () => {
  const verdict = nodeNamed(inspection, "post-verdict");
  assert.equal(verdict.parameters.url, `=http://${PLACEHOLDERS.esp32Host}/verdict`);
  assert.equal(
    verdict.parameters.jsonBody,
    "={{ JSON.stringify({ action: $json.action }) }}"
  );
});

test("both verdict branches are wired back into the single verdict call", () => {
  const guard = inspection.connections["verdict-is-reject"].main;
  assert.equal(guard[0][0].node, "action-reject");
  assert.equal(guard[1][0].node, "action-pass");
  assert.equal(inspection.connections["action-reject"].main[0][0].node, "duplicate-guard");
  assert.equal(inspection.connections["action-pass"].main[0][0].node, "duplicate-guard");
});

test("a model failure cannot stop the loop before the verdict", () => {
  for (const name of [
    "fetch-current-prompt",
    "capture-frame",
    "detect-defects",
    "post-verdict"
  ]) {
    assert.equal(
      nodeNamed(inspection, name).onError,
      "continueRegularOutput",
      `${name} must continue on error so the fail-safe branch still runs`
    );
  }
});

test("the model timeout is a placeholder inside the verdict window", () => {
  const detect = nodeNamed(inspection, "detect-defects");
  assert.equal(detect.parameters.options.timeout, PLACEHOLDERS.modelTimeoutMs);
  assert.ok(MODEL_TIMEOUT_MS < VERDICT_WINDOW_MS, "documented default must fit the window");
});

test("the broadcast targets the relay ingest rather than the HUD websocket", () => {
  const broadcast = nodeNamed(inspection, "broadcast-hud");
  assert.equal(broadcast.parameters.url, `=http://${PLACEHOLDERS.relayHost}/detections`);
  assert.equal(
    JSON.stringify(workflows).includes("n8n-nodes-base.websocket"),
    false,
    "stock n8n cannot broadcast to a WebSocket"
  );
});

test("Supabase is written over PostgREST so the column names stay visible", () => {
  const insert = nodeNamed(inspection, "insert-inspection");
  assert.equal(insert.parameters.url, `=https://${PLACEHOLDERS.supabaseHost}/rest/v1/inspection_results`);
  assert.equal(insert.parameters.sendBody, true);
  assert.ok(insert.parameters.jsonBody.includes("$json."), "an insert must name the row it sends");

  const writtenTables = Object.values(workflows)
    .flatMap((workflow) => workflow.nodes)
    .map((node) => String(node.parameters?.url ?? ""))
    .filter((url) => url.includes("/rest/v1/"))
    .map((url) => url.split("/rest/v1/")[1]);

  for (const table of [
    "inspection_results",
    "control_actions",
    "prompt_history",
    "system_logs"
  ]) {
    assert.ok(writtenTables.includes(table), `no workflow writes ${table}`);
  }
});

test("the prompt history row is built by the tested module", () => {
  assert.ok(
    codeOf(promptCapture, "build-prompt-record").includes("buildPromptHistoryRow"),
    "row building must not be reimplemented inside a Code node"
  );
});

test("the health watchdog records transitions rather than every poll", () => {
  const record = codeOf(healthWatchdog, "record-transitions");
  assert.ok(record.includes("buildSystemLogRow"));
  assert.ok(record.includes("previous === probe.healthy"));
});

test("the health watchdog probes the model server and the capture service", () => {
  assert.equal(
    nodeNamed(healthWatchdog, "probe-model-health").parameters.url,
    `=https://${PLACEHOLDERS.modelHost}/health`
  );
  assert.equal(
    nodeNamed(healthWatchdog, "probe-capture").parameters.url,
    `=http://${PLACEHOLDERS.piHost}/capture`
  );
});

test("the canonical instruction grammar is inlined verbatim into the workflows", () => {
  const source = codeOf(promptCapture, "build-instruction");
  assert.ok(
    source.includes(MODEL_INSTRUCTION_TEMPLATE),
    "the instruction template must not drift between the library and the workflow"
  );
});

test("every Code node carries the tested decision logic", () => {
  const shared = sharedLogicSource();
  for (const workflow of Object.values(workflows)) {
    for (const node of workflow.nodes) {
      if (node.type !== "n8n-nodes-base.code") continue;
      for (const symbol of ["buildInspectionDecision", "buildModelInstruction"]) {
        assert.ok(
          node.parameters.jsCode.includes(symbol),
          `${workflow.name} / ${node.name} is missing ${symbol}`
        );
      }
      assert.ok(
        node.parameters.jsCode.startsWith(shared),
        `${workflow.name} / ${node.name} has stale inlined logic. Run: npm run build`
      );
    }
  }
});

test("the inlined logic drops module syntax the Code node cannot resolve", () => {
  const source = sharedLogicSource();
  assert.equal(/^export\s/m.test(source), false, "export statements are not valid in a Code node");
  assert.equal(/^\s*import\s/m.test(source), false, "imports are not resolvable in a Code node");
});

test("no credential is committed to the workflow files", () => {
  const text = allWorkflowText();
  assert.equal(text.includes(PLACEHOLDERS.supabaseKey), true, "the key must be a named placeholder");

  const secrets = [
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    /\bsk-[A-Za-z0-9]{16,}\b/,
    /\bsupabase\b.{0,40}\b[A-Za-z0-9]{40,}\b/,
    /"(?:service_role|anon)"\s*:\s*"[A-Za-z0-9._-]{20,}"/,
    /eyJhbGciOi/
  ];
  for (const pattern of secrets) {
    assert.equal(pattern.test(text), false, `workflow files contain a secret: ${pattern}`);
  }
});

test("every placeholder the setup promises appears in the workflows", () => {
  const text = allWorkflowText();
  for (const [name, value] of Object.entries(PLACEHOLDERS)) {
    assert.ok(text.includes(value), `placeholder ${name} (${value}) is unused or missing`);
  }
});

test("every placeholder is documented in the setup guide", () => {
  const readme = readFileSync(join(WORKFLOW_DIR, "..", "README.md"), "utf8");
  for (const [name, value] of Object.entries(PLACEHOLDERS)) {
    assert.ok(readme.includes(value), `n8n/README.md does not document ${name} (${value})`);
  }
});

test("the setup guide warns about the bind-address trap and the fail-safe default", () => {
  const readme = readFileSync(join(WORKFLOW_DIR, "..", "README.md"), "utf8");
  assert.ok(readme.includes("0.0.0.0"), "the bind-address trap must be called out");
  assert.ok(
    readme.includes("fails closed") || readme.includes("fail-safe"),
    "the fail-closed decision must be stated up front"
  );
});

test("the setup guide is explicit that the Supabase schema is assumed", () => {
  const readme = readFileSync(join(WORKFLOW_DIR, "..", "README.md"), "utf8");
  assert.ok(/assum/i.test(readme), "the assumed schema must be labelled as an assumption");
});

test("no workflow points at an unresolvable n8n host", () => {
  const text = allWorkflowText();
  assert.equal(
    text.includes("n8n.local"),
    false,
    "n8n.local does not resolve; the ESP32 and HUD defaults must be corrected"
  );
});

test("the model host is never configured as a bind address", () => {
  const text = allWorkflowText();
  assert.equal(
    text.includes("0.0.0.0"),
    false,
    "0.0.0.0 is a bind address, not a connectable target"
  );
});

test("every node is reachable from a trigger", () => {
  for (const workflow of Object.values(workflows)) {
    const triggerTypes = new Set(["n8n-nodes-base.webhook", "n8n-nodes-base.scheduleTrigger"]);
    const reachable = new Set(
      workflow.nodes.filter((node) => triggerTypes.has(node.type)).map((node) => node.name)
    );

    let changed = true;
    while (changed) {
      changed = false;
      for (const [from, outputs] of Object.entries(workflow.connections)) {
        if (!reachable.has(from)) continue;
        for (const branch of outputs.main ?? []) {
          for (const target of branch) {
            if (!reachable.has(target.node)) {
              reachable.add(target.node);
              changed = true;
            }
          }
        }
      }
    }

    const orphans = workflow.nodes
      .map((node) => node.name)
      .filter((name) => !reachable.has(name));
    assert.deepEqual(orphans, [], `${workflow.name} has unreachable nodes`);
  }
});

test("every connection points at a node that exists", () => {
  for (const workflow of Object.values(workflows)) {
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const [from, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from), `${workflow.name} connects from unknown node ${from}`);
      for (const branch of outputs.main ?? []) {
        for (const target of branch) {
          assert.ok(
            names.has(target.node),
            `${workflow.name} connects to unknown node ${target.node}`
          );
        }
      }
    }
  }
});

test("node names are unique within a workflow", () => {
  for (const workflow of Object.values(workflows)) {
    const names = workflow.nodes.map((node) => node.name);
    assert.equal(new Set(names).size, names.length, `${workflow.name} has duplicate node names`);
  }
});
