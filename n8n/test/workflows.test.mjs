import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

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
  SNAPSHOT_UPLOAD_TIMEOUT_MS,
  VERDICT_POST_TIMEOUT_MS,
  VERDICT_WINDOW_MS,
  buildInspectionDecision,
  classifyModelOutcome,
  resolveVerdictBudget
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

// Runs a Code node's real jsCode against stubbed n8n globals. Asserting on what
// a node *returns* is the only way a test about workflow glue can fail — a test
// that greps its own source for a word cannot.
function runCode(
  workflow,
  name,
  { items = [{}], nodes = {}, executed, vars, binary, store = {} } = {}
) {
  const $input = items;
  $input.all = () => items;
  $input.first = () => items[0] ?? {};

  const known = new Set(workflow.nodes.map((node) => node.name));

  // `executed` names the nodes a real run would have completed. A node that did
  // not run is still referenceable and reports isExecuted: false, which is how
  // the pass/reject branch gets chosen. A name that is not a node at all is a
  // genuine wiring bug, so that still throws.
  const ran = (nodeName) => (executed === undefined ? true : executed.includes(nodeName));
  const $ = (nodeName) => {
    if (!known.has(nodeName)) throw new Error(`no node named ${nodeName} in ${workflow.name}`);
    const stub = nodes[nodeName];
    const isExecuted = nodeName in nodes ? ran(nodeName) : false;
    return { isExecuted, first: () => ({ json: stub ?? {} }) };
  };

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "$",
    "$input",
    "$json",
    "$binary",
    "$getWorkflowStaticData",
    "$vars",
    codeOf(workflow, name)
  );

  // In n8n $json is the current item's json and $binary its binary sidecar.
  return factory($, $input, items[0]?.json ?? {}, binary ?? {}, () => store, vars);
}

const FRAME = {
  "x-camera-session": "s1",
  "x-frame-sequence": "7",
  "x-captured-at": "2026-01-01T00:00:00.000Z",
  "x-frame-width": "640",
  "x-frame-height": "480"
};

const FRAME_CONTEXT = {
  sessionId: "s1",
  sequence: 7,
  capturedAt: "2026-01-01T00:00:00.000Z",
  width: 640,
  height: 480
};

const DECISION_PASS = {
  verdict: "pass",
  reason: "no_defect_detected",
  coverage: 0,
  coverageThreshold: 0.005,
  boxCount: 0,
  promptVerified: true,
  promptUsed: "Look for mould.",
  promptMismatch: false
};

// n8n wraps a Code node's jsCode in one function body, so glue that redeclares
// an inlined name — `const rejected = ...` beside `function rejected()` — is a
// SyntaxError that only shows up when the node runs. Compiling each node here is
// the only thing that catches it before import.
test("every Code node compiles as a single function body", () => {
  for (const workflow of Object.values(workflows)) {
    for (const node of workflow.nodes) {
      if (node.type !== "n8n-nodes-base.code") continue;
      assert.doesNotThrow(
        () => new Script(`(function () {${node.parameters.jsCode}\n})`),
        `${workflow.name} / ${node.name} does not compile. A glue name may be shadowing an inlined one.`
      );
    }
  }
});

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

test("the model timeout is the budget-clamped value, not the raw placeholder", () => {
  const detect = nodeNamed(inspection, "detect-defects");

  assert.match(
    detect.parameters.options.timeout,
    /verify-verdict-budget.*appliedModelTimeoutMs/,
    "an over-budget configured timeout must be clamped at the wire, or the auto-pass fires first"
  );

  // And the budget node itself must be the place that computes it.
  const budgeted = runCode(inspection, "verify-verdict-budget");
  assert.equal(budgeted[0].json.budget.readable, false, "the placeholder is not a number");
  assert.equal(budgeted[0].json.budget.appliedModelTimeoutMs, MODEL_TIMEOUT_MS);
  assert.ok(budgeted[0].json.budget.fits, "the documented default fits the window");
});

test("the model server is asked for the prompt before every inspection", () => {
  assert.equal(
    nodeNamed(inspection, "fetch-current-prompt").parameters.url,
    `=https://${PLACEHOLDERS.modelHost}/get_prompt`
  );
  assert.ok(
    dominates(inspection, "resolve-instruction", "detect-defects"),
    "every path to the model call must have resolved an instruction first"
  );
});

test("the verdict reaches the ESP32 before anything is persisted or broadcast", () => {
  for (const downstream of [
    "insert-inspection",
    "insert-control-action",
    "broadcast-hud",
    "log-outcome"
  ]) {
    assert.ok(
      dominates(inspection, "post-verdict", downstream),
      `every path to ${downstream} must pass through the ESP32 verdict`
    );
  }
});

test("the HUD is sent a payload a Code node built", () => {
  const broadcast = nodeNamed(inspection, "broadcast-hud");
  assert.ok(
    broadcast.parameters.jsonBody.includes("hudPayload"),
    "the payload must be built in a Code node, not inside an HTTP expression"
  );

  const built = runCode(inspection, "build-hud-broadcast", {
    nodes: {
      "build-control-action": {
        action: "pass",
        frameContext: FRAME_CONTEXT,
        frameUrl: `https://${PLACEHOLDERS.supabaseHost}/x/s1-7.jpg`,
        decision: DECISION_PASS
      }
    }
  });
  const payload = built[0].json.hudPayload;

  assert.equal(payload.frame.id, "s1:7", "the HUD orders frames by this id");
  assert.equal(payload.frame.sessionId, "s1", "frame identity is load-bearing for ordering");
  assert.equal(payload.frame.sequence, 7);
  assert.equal(payload.status, "pass");
  assert.equal(payload.snapshotUrl, `https://${PLACEHOLDERS.supabaseHost}/x/s1-7.jpg`);
  assert.deepEqual(payload.detections, [], "a pass with no detections sends nothing to draw");
  assert.equal(
    JSON.stringify(payload).includes("confidence"),
    false,
    "the model hardcodes confidence 0.0; it must never reach the HUD"
  );
});

test("boxes are drawn on the HUD whatever the verdict", () => {
  const built = runCode(inspection, "build-hud-broadcast", {
    nodes: {
      "build-control-action": {
        action: "reject",
        frameContext: FRAME_CONTEXT,
        frameUrl: null,
        decision: {
          ...DECISION_PASS,
          verdict: "reject",
          reason: "defect_detected",
          detections: [{ label: "mould", box: [10, 20, 30, 40] }]
        }
      }
    }
  });

  assert.deepEqual(built[0].json.hudPayload.detections, [
    { label: "mould", box: [10, 20, 30, 40], status: "reject" }
  ]);
});

test("the verdict path is budgeted against the ESP32 verdict window", () => {
  const [{ json: { budget } }] = runCode(inspection, "verify-verdict-budget");

  assert.equal(budget.fits, true, "the shipped timeouts must leave headroom in the window");
  assert.ok(
    budget.totalMs < VERDICT_WINDOW_MS,
    `${budget.totalMs}ms of work inside a ${VERDICT_WINDOW_MS}ms window`
  );
});

test("a budget that cannot fit is rejected, and known before the model call", () => {
  assert.ok(
    dominates(inspection, "verify-verdict-budget", "detect-defects"),
    "a budget that cannot fit must be known before the model call it governs"
  );

  const decision = buildInspectionDecision({
    outcome: classifyModelOutcome({ status: "success", detections: [] }),
    frameContext: FRAME_CONTEXT,
    instruction: "Look for mould.",
    threshold: 0.005,
    budget: { fits: false, totalMs: 4200, modelTimeoutMs: 3600 }
  });

  assert.equal(decision.verdict, "reject");
  assert.equal(decision.reason, "invalid_verdict_budget");
});

test("the timeouts on the verdict path are budgeted, not left at defaults", () => {
  assert.equal(
    nodeNamed(inspection, "fetch-current-prompt").parameters.options.timeout,
    MODEL_PROMPT_TIMEOUT_MS
  );
  assert.equal(
    nodeNamed(inspection, "capture-frame").parameters.options.timeout,
    CAPTURE_TIMEOUT_MS
  );
  assert.equal(
    nodeNamed(inspection, "upload-snapshot").parameters.options.timeout,
    SNAPSHOT_UPLOAD_TIMEOUT_MS
  );
  assert.equal(
    nodeNamed(inspection, "post-verdict").parameters.options.timeout,
    VERDICT_POST_TIMEOUT_MS
  );
});

test("the capture is serialised, not fanned out behind a merge", () => {
  // A parallel snapshot upload would need a merge to re-join the branches.
  // Serialising costs budget but cannot block on an input that never arrives.
  assert.ok(
    dominates(inspection, "upload-snapshot", "detect-defects"),
    "every path to the model call must have stored the snapshot first"
  );
  assert.equal(
    inspection.nodes.filter((node) => node.type === "n8n-nodes-base.merge").length,
    0,
    "no merge means no node that can block on an input that never arrives"
  );
  assert.equal(
    inspection.connections["read-frame-context"].main[0].length,
    1,
    "the capture feeds one consumer, not two"
  );
});

test("a failed capture is decided at the wire, as a capture failure", () => {
  // The HTTP node surfaces its own error; the glue must name it as the capture
  // failing, not smuggle it in as a model problem.
  const decided = runCode(inspection, "decide-inspection", {
    items: [{ json: { error: { message: "anything" } } }],
    nodes: {
      "read-frame-context": { frameContext: {} },
      "resolve-instruction": { instruction: "Look for mould.", inspectionTarget: "mould", modelPromptMissing: false },
      "verify-verdict-budget": { budget: { fits: true, totalMs: 2800 } },
      "capture-frame": { error: { message: "connect ETIMEDOUT" } }
    },
    vars: { COVERAGE_THRESHOLD: 0.005 }
  });

  assert.equal(decided[0].json.decision.verdict, "reject");
  assert.equal(decided[0].json.decision.reason, "frame_capture_failed");
});

test("a duplicate frame is still told to the ESP32, but only recorded once", () => {
  const carried = { json: { frameContext: FRAME_CONTEXT, decision: DECISION_PASS } };
  const store = {};

  const first = runCode(inspection, "duplicate-guard", { items: [carried], store });
  assert.equal(first[0].json.duplicate, false, "the first frame for this sequence is not a duplicate");

  const second = runCode(inspection, "duplicate-guard", { items: [carried], store });
  assert.equal(
    second[0].json.duplicate,
    true,
    "a repeat of the same frame is recognised"
  );

  // The critical part: the duplicate still has to reach the firmware. Dropping
  // it here would let the ESP32's 3000 ms auto-pass fallback pass a real item.
  assert.equal(second.length, 1, "the duplicate is never dropped, only flagged");
  assert.ok(
    dominates(inspection, "duplicate-guard", "post-verdict"),
    "the ESP32 verdict must be sent for duplicates too"
  );
  assert.ok(
    dominates(inspection, "post-verdict", "duplicate-or-new"),
    "the board must be told before the record is suppressed"
  );
  // Nothing downstream of the duplicate branch may write or broadcast. This is
  // a reachability question from that branch, not a dominance one: the branch
  // is one of two outputs, so it cannot dominate anything downstream.
  const writes = [
    "build-snapshot-url",
    "insert-inspection",
    "insert-control-action",
    "broadcast-hud",
    "log-outcome"
  ];
  const reached = walk(inspection, "build-duplicate-log");
  for (const write of writes) {
    assert.ok(!reached.includes(write), `the duplicate branch must not reach ${write}`);
  }
  assert.ok(reached.includes("log-duplicate"), "but it must still record that it suppressed one");
});

test("a duplicate is logged rather than vanishing", () => {
  const logged = runCode(inspection, "build-duplicate-log", {
    items: [
      {
        json: {
          action: "reject",
          frameContext: FRAME_CONTEXT,
          decision: DECISION_PASS,
          duplicateSuppressedAt: "2026-01-01T00:00:00.000Z",
          esp32: { esp32Accepted: false, esp32Status: "ignored", esp32Error: null }
        }
      }
    ]
  });

  const { logRow } = logged[0].json;
  assert.equal(logRow.message, "duplicate frame suppressed");
  assert.equal(logRow.details.frameSequence, 7);
  assert.equal(
    logRow.details.esp32Status,
    "ignored",
    "the firmware's refusal of the repeat is the evidence the board did not move twice"
  );
});

test("the firmware answer is read once, upstream of the record", () => {
  const captured = runCode(inspection, "capture-esp32-response", {
    items: [{ json: { action: "pass", frameContext: FRAME_CONTEXT } }],
    nodes: { "post-verdict": { accepted: false, status: "ignored" } }
  });

  assert.deepEqual(captured[0].json.esp32, {
    esp32Accepted: false,
    esp32Status: "ignored",
    esp32HttpStatus: null,
    esp32Error: null
  });
});

test("the wire result the firmware sent is recorded, envelope and all", () => {
  const captured = runCode(inspection, "capture-esp32-response", {
    items: [{ json: { action: "reject", frameContext: FRAME_CONTEXT } }],
    nodes: { "post-verdict": { body: { accepted: true, status: "applied" }, statusCode: 200 } }
  });

  assert.equal(captured[0].json.esp32.esp32Accepted, true);
  assert.equal(
    captured[0].json.esp32.esp32HttpStatus,
    200,
    "the Control Action records the HTTP status, not just the firmware payload"
  );
});

test("only an explicit pass becomes a pass", () => {
  for (const [verdict, action] of [
    ["pass", "pass"],
    ["reject", "reject"],
    ["PASS", "reject"],
    ["anything else", "reject"]
  ]) {
    const items = runCode(inspection, "to-control-action", {
      items: [{ json: { decision: { verdict, reason: "x" } } }]
    });
    assert.equal(items[0].json.action, action, `verdict ${verdict} must not become ${action}`);
  }
});

test("the capture headers become the frame context, and the bytes ride along", () => {
  const items = runCode(inspection, "read-frame-context", {
    items: [{ json: { headers: FRAME } }],
    binary: { data: { data: "JPEGBYTES" } }
  });

  assert.deepEqual(items[0].json.frameContext, FRAME_CONTEXT);
  assert.equal(
    items[0].json.snapshotObjectName,
    "s1-7.jpg",
    "the object name is derived once, upstream, so upload and record agree"
  );
  assert.equal(
    items[0].binary.image.data,
    "JPEGBYTES",
    "both HTTP nodes need the image, so the binary must survive this node"
  );
});

test("a prompt mismatch on a passing item is still a warning", () => {
  // Spec: drift is "surfaced as a warning rather than silently accepted" — the
  // Verdict can be a pass and the drift is still the thing an operator must see.
  const items = runCode(inspection, "build-outcome-log", {
    nodes: {
      "build-control-action": {
        decidedAt: "2026-01-01T00:00:00.000Z",
        source: "schedule",
        frameContext: FRAME_CONTEXT,
        frameUrl: null,
        budget: { fits: true, totalMs: 2800 },
        esp32: { esp32Accepted: true, esp32Status: "applied", esp32Error: null },
        decision: {
          verdict: "pass",
          reason: "no_defect_detected",
          coverage: 0,
          coverageThreshold: 0.005,
          boxCount: 0,
          promptVerified: false,
          promptUsed: "some other instruction",
          promptMismatch: true
        }
      }
    }
  });

  assert.equal(items[0].json.logRow.severity, "warn");
});

test("a failed snapshot upload yields no frame URL", () => {
  const nodes = {
    "capture-esp32-response": {
      action: "pass",
      frameContext: FRAME_CONTEXT,
      decision: DECISION_PASS
    },
    "read-frame-context": { snapshotObjectName: "s1-7.jpg" },
    "upload-snapshot": { Key: "s1-7.jpg" }
  };

  const uploaded = runCode(inspection, "build-snapshot-url", { nodes });
  assert.equal(uploaded[0].json.snapshotStored, true);
  assert.equal(
    uploaded[0].json.frameUrl,
    `https://${PLACEHOLDERS.supabaseHost}/storage/v1/object/public/${PLACEHOLDERS.snapshotBucket}/s1-7.jpg`
  );

  const failed = runCode(inspection, "build-snapshot-url", {
    nodes: { ...nodes, "upload-snapshot": { error: { message: "storage is down" } } }
  });
  assert.equal(failed[0].json.snapshotStored, false);
  assert.equal(
    failed[0].json.frameUrl,
    null,
    "a URL pointing at an object nobody stored is worse than no URL"
  );

  // And the inspection row must carry that null, not invent a URL.
  const record = runCode(inspection, "build-inspection-record", {
    nodes: { "build-snapshot-url": failed[0].json }
  });
  assert.equal(record[0].json.inspectionRow.frame_url, null);
});

test("an unreadable model prompt fails the item closed, by name", () => {
  const begun = runCode(inspection, "begin-inspection", { items: [{ json: {} }] });
  assert.equal(begun[0].json.inspectionTarget, null);

  const resolved = runCode(inspection, "resolve-instruction", {
    nodes: {
      "fetch-current-prompt": { error: { message: "connect ECONNREFUSED" } },
      "begin-inspection": begun[0].json
    }
  });
  assert.equal(resolved[0].json.modelPromptMissing, true);
  assert.equal(resolved[0].json.instruction, null);

  const decided = runCode(inspection, "decide-inspection", {
    items: [{ json: { status: "success", detections: [] } }],
    nodes: {
      "read-frame-context": { frameContext: FRAME_CONTEXT },
      "resolve-instruction": resolved[0].json,
      "verify-verdict-budget": { budget: resolveVerdictBudget(undefined) }
    },
    vars: { COVERAGE_THRESHOLD: 0.005 }
  });

  assert.equal(decided[0].json.decision.verdict, "reject");
  assert.equal(
    decided[0].json.decision.reason,
    "model_instruction_missing",
    "an item nobody can name an instruction for is not a pass"
  );
});

test("a target on the webhook becomes a canonical instruction, built not recovered", () => {
  const begun = runCode(inspection, "begin-inspection", {
    items: [{ json: { inspectionTarget: "  mould  " } }]
  });
  assert.equal(begun[0].json.inspectionTarget, "  mould  ");

  const resolved = runCode(inspection, "resolve-instruction", {
    nodes: { "fetch-current-prompt": { current_prompt: "  " }, "begin-inspection": begun[0].json }
  });

  assert.equal(
    resolved[0].json.instruction,
    "Locate all the instances that matches the following description: mould."
  );
  assert.equal(
    resolved[0].json.inspectionTarget,
    "mould",
    "the target is parsed back out of the template by the tested parser, not by splitting here"
  );
  assert.equal(resolved[0].json.modelPromptMissing, true);
});

test("the model server's own prompt wins over the target on the webhook", () => {
  const begun = runCode(inspection, "begin-inspection", {
    items: [{ json: { inspectionTarget: "mould" } }]
  });
  const resolved = runCode(inspection, "resolve-instruction", {
    nodes: {
      "fetch-current-prompt": { current_prompt: "Look for hairline cracks on the rim." },
      "begin-inspection": begun[0].json
    }
  });

  assert.equal(resolved[0].json.instruction, "Look for hairline cracks on the rim.");
  assert.equal(resolved[0].json.modelPromptMissing, false);
});

test("the prompt comparison and the board result reach the audit trail", () => {
  const items = runCode(inspection, "build-outcome-log", {
    nodes: {
      "build-control-action": {
        decidedAt: "2026-01-01T00:00:00.000Z",
        source: "manual",
        inspectionId: 17,
        frameContext: FRAME_CONTEXT,
        frameUrl: `https://${PLACEHOLDERS.supabaseHost}/x/s1-7.jpg`,
        modelPromptMissing: false,
        budget: { fits: true, totalMs: 2800 },
        esp32: { esp32Accepted: false, esp32Status: "ignored", esp32Error: null },
        decision: {
          verdict: "reject",
          reason: "defect_detected",
          coverage: 0.02,
          coverageThreshold: 0.005,
          boxCount: 2,
          promptVerified: false,
          promptUsed: "some other instruction",
          promptMismatch: true
        }
      }
    }
  });

  const { logRow } = items[0].json;
  assert.equal(logRow.component, "inspection-loop");
  assert.equal(logRow.severity, "warn");
  assert.equal(logRow.details.promptMismatch, true, "a mid-flight prompt change must be visible");
  assert.equal(logRow.details.esp32Accepted, false, "a board that refused must not read accepted");
  assert.equal(logRow.details.inspectionId, 17);
  assert.equal(logRow.details.verdictBudget.totalMs, 2800);
});

test("a passing inspection logs at info", () => {
  const items = runCode(inspection, "build-outcome-log", {
    nodes: {
      "build-control-action": {
        decidedAt: "2026-01-01T00:00:00.000Z",
        source: "schedule",
        frameContext: FRAME_CONTEXT,
        frameUrl: null,
        budget: { fits: true, totalMs: 2800 },
        esp32: { esp32Accepted: true, esp32Status: "applied", esp32Error: null },
        decision: {
          verdict: "pass",
          reason: "no_defect_detected",
          coverage: 0,
          coverageThreshold: 0.005,
          boxCount: 0,
          promptVerified: true,
          promptMismatch: false
        }
      }
    }
  });

  assert.equal(items[0].json.logRow.severity, "info");
  assert.equal(items[0].json.logRow.message, "inspection passed");
});

test("the control action is anchored to the id PostgREST returns", () => {
  const base = {
    action: "reject",
    decidedAt: "2026-01-01T00:00:00.000Z",
    frameContext: FRAME_CONTEXT,
    esp32: { esp32Accepted: true, esp32Status: "applied", esp32Error: null }
  };

  const anchored = runCode(inspection, "build-control-action", {
    items: [{ json: [{ id: "a1b2", inspection_at: "2026-01-01" }] }],
    nodes: { "build-snapshot-url": base }
  });
  assert.equal(anchored[0].json.controlActionRow.inspection_id, "a1b2");

  // A failed insert must not invent an anchor.
  const orphaned = runCode(inspection, "build-control-action", {
    items: [{ json: { error: { message: "PostgREST 400" } } }],
    nodes: { "build-snapshot-url": base }
  });
  assert.equal(orphaned[0].json.controlActionRow.inspection_id, null);
  assert.equal(
    orphaned[0].json.controlActionRow.esp32_accepted,
    true,
    "the board moved the machinery whether or not the row was written"
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

test("the duplicate branch and the full branch both terminate", () => {
  assert.equal(nodeNamed(inspection, "duplicate-or-new").type, "n8n-nodes-base.if");

  const condition = nodeNamed(inspection, "duplicate-or-new").parameters.conditions.conditions[0];
  assert.equal(condition.leftValue, "={{ $json.duplicate }}");
  assert.equal(condition.operator.operation, "true");

  const targets = inspection.connections["duplicate-or-new"].main.map((branch) => branch[0].node);
  assert.deepEqual(targets, ["build-duplicate-log", "build-snapshot-url"]);

  assert.ok(
    walk(inspection, "build-duplicate-log").includes("done-duplicate"),
    "a suppressed duplicate must still reach an end, not dangle"
  );
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
  // The predecessor is the model server's HTTP response, so the prompt fields
  // have to come from the node that built them, not from $input.
  const items = runCode(promptCapture, "build-prompt-record", {
    items: [{ json: { status: "ok", unrelated: true } }],
    nodes: {
      "build-instruction": {
        inspectionTarget: "mould",
        modelInstruction: "Locate all the instances that matches the following description: mould.",
        changedAt: "2026-01-01T00:00:00.000Z"
      },
      "set-model-prompt": { statusCode: 200, ok: true }
    }
  });

  assert.deepEqual(items[0].json.promptRow, {
    changed_at: "2026-01-01T00:00:00.000Z",
    inspection_target: "mould",
    model_instruction: "Locate all the instances that matches the following description: mould.",
    source: "hud",
    model_http_status: 200,
    model_error: null
  });
});

test("a rejected prompt change is recorded with its status and error", () => {
  const items = runCode(promptCapture, "build-prompt-record", {
    items: [{ json: { error: { message: "Model server unavailable" } } }],
    nodes: {
      "build-instruction": {
        inspectionTarget: "mould",
        modelInstruction: "Locate all the instances that matches the following description: mould.",
        changedAt: "2026-01-01T00:00:00.000Z"
      },
      "set-model-prompt": { error: { message: "Model server unavailable" } }
    }
  });

  const { promptRow } = items[0].json;
  assert.equal(promptRow.model_http_status, null);
  assert.equal(promptRow.model_error, "Model server unavailable");
  assert.equal(
    promptRow.inspection_target,
    "mould",
    "the operator still sees what they tried to change"
  );
});

test("the health watchdog records transitions rather than every poll", () => {
  // First poll of each component is a transition; an unchanged poll is not.
  const store = {};
  const first = runCode(healthWatchdog, "record-transitions", {
    items: [{ json: { component: "model", healthy: true } }, { json: { component: "capture", healthy: false } }],
    store
  });

  assert.equal(first.length, 2, "the first reading of each component is news");
  assert.deepEqual(
    first.map((item) => item.json.severity),
    ["info", "error"]
  );
  assert.equal(first[1].json.message, "capture is not responding");

  const unchanged = runCode(healthWatchdog, "record-transitions", {
    items: [{ json: { component: "model", healthy: true } }, { json: { component: "capture", healthy: false } }],
    store
  });
  assert.deepEqual(unchanged, [], "polling every 30s must not write a row every 30s");

  const flipped = runCode(healthWatchdog, "record-transitions", {
    items: [{ json: { component: "model", healthy: false } }],
    store
  });
  assert.equal(flipped.length, 1);
  assert.equal(flipped[0].json.severity, "error");
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
