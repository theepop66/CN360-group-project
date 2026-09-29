import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CAPTURE_TIMEOUT_MS,
  MODEL_PROMPT_TIMEOUT_MS,
  SNAPSHOT_UPLOAD_TIMEOUT_MS,
  VERDICT_POST_TIMEOUT_MS
} from "./inspection-logic.mjs";

const LIB = dirname(fileURLToPath(import.meta.url));

export const WORKFLOW_FILES = {
  inspectionLoop: "01-inspection-loop.json",
  promptCapture: "02-prompt-capture.json",
  healthWatchdog: "03-health-watchdog.json"
};

export const PLACEHOLDERS = Object.freeze({
  modelHost: "REPLACE_MODEL_HOST:8000",
  piHost: "REPLACE_PI_HOST:8000",
  esp32Host: "REPLACE_ESP32_HOST",
  relayHost: "REPLACE_RELAY_HOST:8081",
  supabaseHost: "REPLACE_SUPABASE_HOST",
  supabaseKey: "REPLACE_SUPABASE_SERVICE_ROLE_KEY",
  coverageThreshold: "REPLACE_COVERAGE_THRESHOLD",
  modelTimeoutMs: "REPLACE_MODEL_TIMEOUT_MS",
  snapshotBucket: "REPLACE_SNAPSHOT_BUCKET"
});

// n8n Code nodes cannot import from the filesystem, so the tested modules are
// inlined verbatim. The workflow tests fail if this stops matching the sources.
export function sharedLogicSource() {
  const sources = ["inspection-logic.mjs", "inspection-records.mjs"].map(
    (name) => readFileSync(join(LIB, name), "utf8")
  );

  return sources
    .join("\n")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s+\{[^}]*\};?[ \t]*$/gm, "")
    .replace(/^export\s+/gm, "")
    .trim();
}

const MODEL_BASE = `https://${PLACEHOLDERS.modelHost}`;
const PI_CAPTURE = `http://${PLACEHOLDERS.piHost}/capture`;
const ESP32_VERDICT = `http://${PLACEHOLDERS.esp32Host}/verdict`;
const RELAY_DETECTIONS = `http://${PLACEHOLDERS.relayHost}/detections`;
const SUPABASE_REST = `https://${PLACEHOLDERS.supabaseHost}/rest/v1`;

function codeNode(slug, name, position, glue) {
  return {
    parameters: { jsCode: `${sharedLogicSource()}\n\n${glue.trim()}\n` },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    name,
    id: `cn360-${slug}`
  };
}

function httpNode(slug, name, position, parameters) {
  return {
    parameters,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    name,
    id: `cn360-${slug}`,
    retryOnFail: false,
    onError: parameters.__continueOnError === true ? "continueRegularOutput" : "stopWorkflow"
  };
}

// The body is passed in rather than assumed to be $json: an insert must send
// one real row, not the whole execution envelope.
function supabaseTable(name, position, table, jsonBody) {
  const node = httpNode(`supabase-${name}`, name, position, {
    __continueOnError: true,
    method: "POST",
    url: `=${SUPABASE_REST}/${table}`,
    sendHeaders: true,
    headerParameters: supabaseHeaders([{ name: "Prefer", value: "return=representation" }]),
    sendBody: true,
    specifyBody: "json",
    jsonBody,
    options: {}
  });
  delete node.parameters.__continueOnError;
  return node;
}

function supabaseHeaders(extra = []) {
  return {
    parameters: [
      { name: "apikey", value: `=${PLACEHOLDERS.supabaseKey}` },
      { name: "Authorization", value: `=Bearer ${PLACEHOLDERS.supabaseKey}` },
      ...extra
    ]
  };
}

function link(from, to) {
  return { [from]: { main: [[{ node: to, type: "main", index: 0 }]] } };
}

function branch(from, targets) {
  return { [from]: { main: targets.map((node) => [{ node, type: "main", index: 0 }]) } };
}

function mergeLinks(...sources) {
  return sources.reduce((all, source) => {
    for (const [from, outputs] of Object.entries(source)) {
      const existing = all[from]?.main ?? [];
      all[from] = { main: outputs.main.map((output, index) => [...(existing[index] ?? []), ...output]) };
    }
    return all;
  }, {});
}

export function buildInspectionLoop() {
  const beginInspection = `
const source = $('trigger-item-detected').isExecuted
  ? 'item_detected'
  : $('trigger-inspect-now').isExecuted
    ? 'manual'
    : 'schedule';
const incoming = $input.first().json ?? {};
return [{ json: {
  source,
  requestedAt: new Date().toISOString(),
  inspectionTarget: typeof incoming.inspectionTarget === 'string' ? incoming.inspectionTarget : null
} }];
`;

  const verifyVerdictBudget = `
const budget = resolveVerdictBudget('${PLACEHOLDERS.modelTimeoutMs}');
return [{ json: { budget } }];
`;

  const resolveInstruction = `
const begun = $('begin-inspection').first().json;
const promptResponse = $('fetch-current-prompt').first().json ?? {};
const current = typeof promptResponse.current_prompt === 'string' ? promptResponse.current_prompt.trim() : '';
const instruction = current || buildModelInstruction(begun.inspectionTarget);
return [{ json: {
  source: begun.source,
  requestedAt: begun.requestedAt ?? new Date().toISOString(),
  instruction,
  modelPromptMissing: current === '',
  inspectionTarget: parseInspectionTarget(instruction)
} }];
`;

  const readFrameContext = `
const frameContext = parseFrameContext($json.headers ?? {});
return [{ json: {
  frameContext,
  snapshotObjectName: buildSnapshotObjectName(frameContext)
}, binary: { image: $binary.data } }];
`;

  // NB: a local must not shadow an inlined name. The compile test enforces it.
  const decideInspection = `
const frameContext = $('read-frame-context').first().json.frameContext;
const resolved = $('resolve-instruction').first().json;
const budget = $('verify-verdict-budget').first().json.budget;
const capture = $('capture-frame').first().json ?? {};
const configured = typeof $vars !== 'undefined' && $vars.COVERAGE_THRESHOLD !== undefined
  ? $vars.COVERAGE_THRESHOLD
  : '${PLACEHOLDERS.coverageThreshold}';
const threshold = resolveCoverageThreshold(configured);
const decision = buildInspectionDecision({
  outcome: classifyModelOutcome($input.first().json),
  frameContext,
  instruction: resolved.instruction,
  threshold: threshold.value,
  budget,
  frameCaptureFailed: capture.error !== undefined && capture.error !== null
});
return [{ json: {
  frameContext,
  instruction: resolved.instruction,
  inspectionTarget: resolved.inspectionTarget,
  modelPromptMissing: resolved.modelPromptMissing,
  coverageThreshold: threshold,
  decision,
  budget,
  decidedAt: new Date().toISOString()
} }];
`;

  // A repeated frame inside the Verdict Window must not move the machinery
  // twice, so the duplicate is flagged and its *record* suppressed. It is NOT
  // dropped here: the ESP32 is waiting out its 3000 ms auto-pass for whatever
  // physically arrived, and staying silent here would let that fallback pass a
  // real item. Re-posting is safe because the firmware's acceptVerdict ignores
  // any verdict once it has left AwaitVerdict, answering `accepted: false`.
  const duplicateGuard = `
const store = $getWorkflowStaticData('global');
const carried = $input.first().json;
const { frameContext } = carried;
return [{ json: {
  ...carried,
  duplicate: shouldSuppressDuplicate(store, frameContext),
  duplicateSuppressedAt: new Date().toISOString()
} }];
`;

  // Only an explicit pass becomes a pass. Deriving the action from the Verdict
  // means an unrecognised verdict can never fall through to the pass branch.
  const toControlAction = `
const { decision } = $input.first().json;
return [{ json: { ...$input.first().json, action: decision.verdict === VERDICT.PASS ? 'pass' : 'reject' } }];
`;

  // A duplicate was still told to the ESP32; only the record is suppressed. It
  // is logged rather than dropped so the audit trail shows the frame was seen
  // twice instead of once.
  const buildDuplicateLog = `
const base = $input.first().json;
return [{ json: { logRow: buildSystemLogRow({
  loggedAt: base.duplicateSuppressedAt,
  severity: 'info',
  component: 'inspection-loop',
  message: 'duplicate frame suppressed',
  details: {
    verdict: base.decision?.verdict ?? null,
    action: base.action,
    cameraSession: base.frameContext?.sessionId ?? null,
    frameSequence: base.frameContext?.sequence ?? null,
    esp32Accepted: base.esp32?.esp32Accepted ?? null,
    esp32Status: base.esp32?.esp32Status ?? null,
    esp32HttpStatus: base.esp32?.esp32HttpStatus ?? null,
    esp32Error: base.esp32?.esp32Error ?? null
  }
}) } }];
`;

  const captureEsp32Response = `
const decided = $input.first().json;
return [{ json: { ...decided, esp32: readEsp32Outcome($('post-verdict').first().json) } }];
`;

  const buildSnapshotUrl = `
const decided = $('capture-esp32-response').first().json;
const upload = $('upload-snapshot').first().json ?? {};
const objectName = $('read-frame-context').first().json.snapshotObjectName;
const stored = upload.error === undefined || upload.error === null;
const publicBase = 'https://${PLACEHOLDERS.supabaseHost}/storage/v1/object/public/${PLACEHOLDERS.snapshotBucket}/';
const frameUrl = stored ? publicBase + objectName : null;
return [{ json: { ...decided, snapshotObjectName: objectName, snapshotStored: stored, frameUrl } }];
`;

  const buildInspectionRecord = `
const base = $('build-snapshot-url').first().json;
return [{ json: { ...base, inspectionRow: buildInspectionRow(base.decision, {
  frameContext: base.frameContext,
  inspectionTarget: base.inspectionTarget,
  modelInstruction: base.instruction,
  inspectedAt: base.decidedAt,
  frameUrl: base.frameUrl
}) } }];
`;

  // PostgREST returns the inserted row, which is the only place the inspection
  // id exists. The Control Action can only be anchored to it once it is back.
  const buildControlAction = `
const inserted = $input.first().json;
const base = $('build-snapshot-url').first().json;
const row = Array.isArray(inserted) ? inserted[0] : inserted;
const inspectionId = row && typeof row === 'object' && row.id !== undefined ? row.id : null;
return [{ json: { ...base, inspectionId, controlActionRow: buildControlActionRow({
  inspectionId,
  action: base.action,
  esp32Accepted: base.esp32?.esp32Accepted ?? null,
  esp32Status: base.esp32?.esp32Status ?? null,
  esp32HttpStatus: base.esp32?.esp32HttpStatus ?? null,
  esp32Error: base.esp32?.esp32Error ?? null,
  requestedAt: base.decidedAt
}) } }];
`;

  const buildHudBroadcast = `
const base = $('build-control-action').first().json;
return [{ json: { ...base, hudPayload: buildHudPayload({
  decision: base.decision,
  frameContext: base.frameContext,
  snapshotUrl: base.frameUrl
}) } }];
`;

  // The outcome row is the audit trail: it is where a prompt that drifted
  // mid-flight, an unreachable board, or a budget that cannot fit is recorded.
  // NB: the local must not be named `rejected` — the inlined logic declares that.
  const buildOutcomeLog = `
const base = $('build-control-action').first().json;
const decision = base.decision;
const wasRejected = decision.verdict !== VERDICT.PASS;
return [{ json: { logRow: buildSystemLogRow({
  loggedAt: base.decidedAt,
  // A mid-flight prompt change is a warning even on a pass: the model answered
  // a question the operator did not ask, and that must be visible.
  severity: wasRejected || decision.promptMismatch ? 'warn' : 'info',
  component: 'inspection-loop',
  message: wasRejected ? 'inspection rejected' : 'inspection passed',
  details: {
    verdict: decision.verdict,
    reason: decision.reason,
    defectCoverage: decision.coverage,
    coverageThreshold: decision.coverageThreshold,
    boxCount: decision.boxCount,
    source: base.source,
    cameraSession: base.frameContext?.sessionId ?? null,
    frameSequence: base.frameContext?.sequence ?? null,
    inspectionId: base.inspectionId ?? null,
    modelPromptMissing: base.modelPromptMissing ?? null,
    promptVerified: decision.promptVerified,
    promptUsed: decision.promptUsed,
    promptMismatch: decision.promptMismatch,
    verdictBudget: base.budget ?? null,
    esp32Accepted: base.esp32?.esp32Accepted ?? null,
    esp32Status: base.esp32?.esp32Status ?? null,
    esp32HttpStatus: base.esp32?.esp32HttpStatus ?? null,
    esp32Error: base.esp32?.esp32Error ?? null,
    frameUrl: base.frameUrl
  }
}) } }];
`;

  return {
    name: "CN360 - Inspection Loop",
    nodes: [
      {
        parameters: { rule: { interval: [{ field: "seconds", secondsInterval: 30 }] } },
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [-620, 0],
        name: "trigger-schedule",
        id: "cn360-trigger-schedule"
      },
      {
        parameters: {
          httpMethod: "POST",
          path: "item-detected",
          responseMode: "lastNode",
          options: {}
        },
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [-620, 160],
        name: "trigger-item-detected",
        id: "cn360-trigger-item",
        webhookId: "6c1a0f1e-0b4d-4a5e-9a0b-2f4d1c7e5a11"
      },
      {
        parameters: {
          httpMethod: "POST",
          path: "inspect-now",
          responseMode: "lastNode",
          options: {}
        },
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [-620, 320],
        name: "trigger-inspect-now",
        id: "cn360-trigger-inspect-now",
        webhookId: "6c1a0f1e-0b4d-4a5e-9a0b-2f4d1c7e5a12"
      },
      codeNode("begin-inspection", "begin-inspection", [-400, 160], beginInspection),
      codeNode("verify-verdict-budget", "verify-verdict-budget", [-180, 160], verifyVerdictBudget),
      httpNode("fetch-current-prompt", "fetch-current-prompt", [40, 160], {
        __continueOnError: true,
        method: "GET",
        url: `=${MODEL_BASE}/get_prompt`,
        options: { timeout: MODEL_PROMPT_TIMEOUT_MS }
      }),
      codeNode("resolve-instruction", "resolve-instruction", [260, 160], resolveInstruction),
      httpNode("capture-frame", "capture-frame", [480, 160], {
        __continueOnError: true,
        method: "GET",
        url: `=${PI_CAPTURE}`,
        options: {
          timeout: CAPTURE_TIMEOUT_MS,
          // fullResponse is what puts the response headers on the output item.
          // Without it a file-format response passes the input json through
          // untouched, and read-frame-context would see {} on every capture.
          response: { response: { responseFormat: "file", fullResponse: true } }
        }
      }),
      codeNode("read-frame-context", "read-frame-context", [700, 160], readFrameContext),
      // The snapshot upload is serialised ahead of the model call — and it must
      // carry the frame forward. n8n's HTTP node only copies the input binary
      // through when responseFormat is 'file', so this node answers that way and
      // posts as binaryData; 'binary' is not a real content type.
      httpNode("upload-snapshot", "upload-snapshot", [920, 280], {
        __continueOnError: true,
        method: "POST",
        url: `=https://${PLACEHOLDERS.supabaseHost}/storage/v1/object/${PLACEHOLDERS.snapshotBucket}/{{ $json.snapshotObjectName }}`,
        sendHeaders: true,
        headerParameters: supabaseHeaders([
          { name: "Content-Type", value: "image/jpeg" },
          { name: "x-upsert", value: "true" }
        ]),
        sendBody: true,
        contentType: "binaryData",
        inputDataFieldName: "image",
        options: {
          timeout: SNAPSHOT_UPLOAD_TIMEOUT_MS,
          response: { response: { responseFormat: "file" } }
        }
      }),
      httpNode("detect-defects", "detect-defects", [1140, 40], {
        __continueOnError: true,
        method: "POST",
        url: `=${MODEL_BASE}/predict`,
        sendHeaders: true,
        headerParameters: { parameters: [] },
        sendBody: true,
        contentType: "multipart-form-data",
        bodyParameters: {
          parameters: [
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "image" },
            {
              parameterType: "formData",
              name: "prompt",
              value: "={{ $('resolve-instruction').first().json.instruction }}"
            }
          ]
        },
        options: {
          // The budget is computed upstream and already clamped inside the
          // Verdict Window, so a misconfigured value can never outrun the
          // ESP32's auto-pass fallback.
          timeout: "={{ $('verify-verdict-budget').first().json.budget.appliedModelTimeoutMs }}"
        }
      }),
      codeNode("decide-inspection", "decide-inspection", [1360, 160], decideInspection),
      codeNode("to-control-action", "to-control-action", [1580, 160], toControlAction),
      codeNode("duplicate-guard", "duplicate-guard", [1800, 160], duplicateGuard),
      httpNode("post-verdict", "post-verdict", [2020, 160], {
        __continueOnError: true,
        method: "POST",
        url: `=${ESP32_VERDICT}`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ action: $json.action }) }}",
        options: {
          timeout: VERDICT_POST_TIMEOUT_MS,
          // The Control Action records whether the board accepted and the HTTP
          // status it returned; both live on the full-response envelope.
          response: { response: { fullResponse: true } }
        }
      }),
      codeNode("capture-esp32-response", "capture-esp32-response", [2240, 160], captureEsp32Response),
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
            conditions: [
              {
                id: "is-duplicate",
                leftValue: "={{ $json.duplicate }}",
                rightValue: true,
                operator: { type: "boolean", operation: "true", singleValue: true }
              }
            ],
            combinator: "and"
          },
          options: {}
        },
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [2460, 160],
        name: "duplicate-or-new",
        id: "cn360-duplicate-if"
      },
      codeNode("build-duplicate-log", "build-duplicate-log", [2680, 40], buildDuplicateLog),
      supabaseTable(
        "log-duplicate",
        [2900, 40],
        "system_logs",
        "={{ JSON.stringify($json.logRow) }}"
      ),
      codeNode("build-snapshot-url", "build-snapshot-url", [2680, 300], buildSnapshotUrl),
      codeNode("build-inspection-record", "build-inspection-record", [2900, 160], buildInspectionRecord),
      supabaseTable(
        "insert-inspection",
        [3120, 60],
        "inspection_results",
        "={{ JSON.stringify($json.inspectionRow) }}"
      ),
      codeNode("build-control-action", "build-control-action", [3340, 60], buildControlAction),
      supabaseTable(
        "insert-control-action",
        [3560, 60],
        "control_actions",
        "={{ JSON.stringify($json.controlActionRow) }}"
      ),
      codeNode("build-hud-broadcast", "build-hud-broadcast", [3780, 60], buildHudBroadcast),
      httpNode("broadcast-hud", "broadcast-hud", [4000, 60], {
        __continueOnError: true,
        method: "POST",
        url: `=${RELAY_DETECTIONS}`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json.hudPayload) }}",
        options: { timeout: 1000 }
      }),
      codeNode("build-outcome-log", "build-outcome-log", [4220, 60], buildOutcomeLog),
      supabaseTable(
        "log-outcome",
        [4440, 60],
        "system_logs",
        "={{ JSON.stringify($json.logRow) }}"
      ),
      {
        parameters: {},
        type: "n8n-nodes-base.noOp",
        typeVersion: 1,
        position: [4660, 60],
        name: "done",
        id: "cn360-done"
      },
      {
        parameters: {},
        type: "n8n-nodes-base.noOp",
        typeVersion: 1,
        position: [3120, 40],
        name: "done-duplicate",
        id: "cn360-done-duplicate"
      }
    ],
    connections: mergeLinks(
      link("trigger-schedule", "begin-inspection"),
      link("trigger-item-detected", "begin-inspection"),
      link("trigger-inspect-now", "begin-inspection"),
      link("begin-inspection", "verify-verdict-budget"),
      link("verify-verdict-budget", "fetch-current-prompt"),
      link("fetch-current-prompt", "resolve-instruction"),
      link("resolve-instruction", "capture-frame"),
      link("capture-frame", "read-frame-context"),
      // One capture, one consumer at a time. The HTTP nodes that follow cannot
      // pass binary along, so serialising is what keeps the bytes reachable.
      link("read-frame-context", "upload-snapshot"),
      link("upload-snapshot", "detect-defects"),
      link("detect-defects", "decide-inspection"),
      link("decide-inspection", "to-control-action"),
      link("to-control-action", "duplicate-guard"),
      // The ESP32 is told on every event, duplicate or not: silence here is
      // what lets its auto-pass fallback fire on a real item.
      link("duplicate-guard", "post-verdict"),
      link("post-verdict", "capture-esp32-response"),
      link("capture-esp32-response", "duplicate-or-new"),
      branch("duplicate-or-new", ["build-duplicate-log", "build-snapshot-url"]),
      link("build-duplicate-log", "log-duplicate"),
      link("log-duplicate", "done-duplicate"),
      link("build-snapshot-url", "build-inspection-record"),
      link("build-inspection-record", "insert-inspection"),
      link("insert-inspection", "build-control-action"),
      link("build-control-action", "insert-control-action"),
      link("insert-control-action", "build-hud-broadcast"),
      link("build-hud-broadcast", "broadcast-hud"),
      link("broadcast-hud", "build-outcome-log"),
      link("build-outcome-log", "log-outcome"),
      link("log-outcome", "done")
    ),
    settings: { executionOrder: "v1" },
    active: false,
    pinData: {},
    tags: []
  };
}

export function buildPromptCapture() {
  // The instruction is read from the node that built it, not from $input: the
  // predecessor is the HTTP call to the model server, so $input here is that
  // server's response body and carries none of the prompt fields.
  const buildPromptRecord = `
const built = $('build-instruction').first().json;
const applied = $('set-model-prompt').first().json ?? {};
const status = applied.statusCode ?? applied.status ?? null;
return [{ json: { promptRow: buildPromptHistoryRow({
  changedAt: built.changedAt,
  inspectionTarget: built.inspectionTarget,
  modelInstruction: built.modelInstruction,
  source: 'hud',
  modelHttpStatus: status,
  modelError: applied.error ? String(applied.error?.message ?? applied.error) : null
}) } }];
`;
  const buildInstruction = `
const target = $input.first().json?.prompt;
const modelInstruction = buildModelInstruction(target);
return [{ json: {
  inspectionTarget: typeof target === 'string' ? target.trim() : null,
  modelInstruction,
  changedAt: new Date().toISOString()
} }];
`;

  return {
    name: "CN360 - Prompt Capture",
    nodes: [
      {
        parameters: {
          httpMethod: "POST",
          path: "detection-prompt",
          responseMode: "lastNode",
          options: {}
        },
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [-400, 0],
        name: "trigger-detection-prompt",
        id: "cn360-prompt-webhook",
        webhookId: "6c1a0f1e-0b4d-4a5e-9a0b-2f4d1c7e5a13"
      },
      codeNode("build-instruction", "build-instruction", [-180, 0], buildInstruction),
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
            conditions: [
              {
                id: "instruction-present",
                leftValue: "={{ $json.modelInstruction }}",
                rightValue: "",
                operator: { type: "string", operation: "notEmpty", singleValue: true }
              }
            ],
            combinator: "and"
          },
          options: {}
        },
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [40, 0],
        name: "instruction-is-usable",
        id: "cn360-instruction-if"
      },
      httpNode("set-model-prompt", "set-model-prompt", [280, -100], {
        __continueOnError: true,
        method: "GET",
        url: `=${MODEL_BASE}/set_prompt`,
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: "prompt", value: "={{ $json.modelInstruction }}" }]
        },
        // The Prompt History records the model server's HTTP status, which only
        // exists on the item when the full-response envelope is requested.
        options: {
          timeout: 1500,
          response: { response: { fullResponse: true } }
        }
      }),
      codeNode("build-prompt-record", "build-prompt-record", [500, -100], buildPromptRecord),
      supabaseTable(
        "insert-prompt-history",
        [720, -100],
        "prompt_history",
        "={{ JSON.stringify($json.promptRow) }}"
      ),
      {
        parameters: {
          respondWith: "json",
          responseBody: "={{ JSON.stringify({ status: 'updated', inspectionTarget: $('build-instruction').first().json.inspectionTarget }) }}",
          options: {}
        },
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.1,
        position: [940, -100],
        name: "respond-ok",
        id: "cn360-respond-ok"
      },
      {
        parameters: {
          respondWith: "json",
          responseCode: 400,
          responseBody: "={{ JSON.stringify({ status: 'rejected', reason: 'empty_inspection_target' }) }}",
          options: {}
        },
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.1,
        position: [280, 120],
        name: "respond-rejected",
        id: "cn360-respond-rejected"
      }
    ],
    connections: mergeLinks(
      link("trigger-detection-prompt", "build-instruction"),
      link("build-instruction", "instruction-is-usable"),
      branch("instruction-is-usable", ["set-model-prompt", "respond-rejected"]),
      link("set-model-prompt", "build-prompt-record"),
      link("build-prompt-record", "insert-prompt-history"),
      link("insert-prompt-history", "respond-ok")
    ),
    settings: { executionOrder: "v1" },
    active: false,
    pinData: {},
    tags: []
  };
}

export function buildHealthWatchdog() {
  const probeModel = `
return [{ json: buildHealthProbe(
  'model-server',
  () => $input.first().json,
  (body) => body?.status === 'ok'
) }];
`;

  const probePi = `
return [{ json: buildHealthProbe(
  'capture-service',
  () => parseFrameContext($json.headers ?? {}),
  (frameContext) => hasUsableFrameGeometry(frameContext)
) }];
`;

  const recordTransitions = `
const store = $getWorkflowStaticData('global');
const rows = $input.all().map((item) => item.json);
const emitted = [];
for (const probe of rows) {
  const previous = store.health?.[probe.component];
  if (previous === probe.healthy) continue;
  store.health = store.health ?? {};
  store.health[probe.component] = probe.healthy;
  emitted.push({
    json: buildSystemLogRow({
      loggedAt: new Date().toISOString(),
      severity: probe.healthy ? 'info' : 'error',
      component: probe.component,
      message: probe.healthy
        ? probe.component + ' recovered'
        : probe.component + ' is not responding',
      details: { healthy: probe.healthy, ...(probe.error ? { error: probe.error } : {}) }
    })
  });
}
return emitted;
`;

  return {
    name: "CN360 - Health Watchdog",
    nodes: [
      {
        parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [-400, 0],
        name: "trigger-health-schedule",
        id: "cn360-health-schedule"
      },
      httpNode("probe-model-health", "probe-model-health", [-180, -100], {
        __continueOnError: true,
        method: "GET",
        url: `=${MODEL_BASE}/health`,
        options: { timeout: 2000 }
      }),
      codeNode("probe-model-result", "probe-model-result", [40, -100], probeModel),
      httpNode("probe-capture", "probe-capture", [-180, 100], {
        __continueOnError: true,
        method: "GET",
        url: `=${PI_CAPTURE}`,
        options: {
          timeout: 3000,
          // Same reason as capture-frame: the health probe reads the capture
          // headers, and they only survive with the full-response envelope.
          response: { response: { responseFormat: "file", fullResponse: true } }
        }
      }),
      codeNode("probe-capture-result", "probe-capture-result", [40, 100], probePi),
      codeNode("record-transitions", "record-transitions", [260, 0], recordTransitions),
      // record-transitions already emits a built system log row as $json.
      supabaseTable("insert-health-log", [480, 0], "system_logs", "={{ JSON.stringify($json) }}")
    ],
    connections: mergeLinks(
      link("trigger-health-schedule", "probe-model-health"),
      link("trigger-health-schedule", "probe-capture"),
      link("probe-model-health", "probe-model-result"),
      link("probe-capture", "probe-capture-result"),
      link("probe-model-result", "record-transitions"),
      link("probe-capture-result", "record-transitions"),
      link("record-transitions", "insert-health-log")
    ),
    settings: { executionOrder: "v1" },
    active: false,
    pinData: {},
    tags: []
  };
}

export function buildAllWorkflows() {
  return {
    [WORKFLOW_FILES.inspectionLoop]: buildInspectionLoop(),
    [WORKFLOW_FILES.promptCapture]: buildPromptCapture(),
    [WORKFLOW_FILES.healthWatchdog]: buildHealthWatchdog()
  };
}

export function serializeWorkflows(workflows) {
  return Object.fromEntries(
    Object.entries(workflows).map(([file, workflow]) => [
      file,
      `${JSON.stringify(workflow, null, 2)}\n`
    ])
  );
}
