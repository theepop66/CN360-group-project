import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

function supabaseTable(name, position, table) {
  const node = httpNode(`supabase-${name}`, name, position, {
    __continueOnError: true,
    method: "POST",
    url: `=${SUPABASE_REST}/${table}`,
    sendHeaders: true,
    headerParameters: supabaseHeaders([{ name: "Prefer", value: "return=representation" }]),
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json) }}",
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
return [{ json: { source, requestedAt: new Date().toISOString() } }];
`;

  const resolveInstruction = `
const requestedAt = $('begin-inspection').first().json.requestedAt ?? new Date().toISOString();
const promptResponse = $('fetch-current-prompt').first().json ?? {};
const current = typeof promptResponse.current_prompt === 'string' ? promptResponse.current_prompt.trim() : '';
const instruction = current || buildModelInstruction($input.first().json.inspectionTarget);
return [{ json: {
  source: $('begin-inspection').first().json.source,
  requestedAt,
  instruction,
  modelPromptMissing: current === '',
  inspectionTarget: instruction ? instruction.split('description:')[1]?.replace(/\\.$/, '').trim() ?? '' : ''
} }];
`;

  const readFrameContext = `
const frameContext = parseFrameContext($json.headers ?? {});
return [{ json: { frameContext }, binary: { image: $binary.data } }];
`;

  const decideInspection = `
const frameContext = $('read-frame-context').first().json.frameContext;
const instruction = $('resolve-instruction').first().json.instruction;
const configured = typeof $vars !== 'undefined' && $vars.COVERAGE_THRESHOLD !== undefined
  ? $vars.COVERAGE_THRESHOLD
  : '${PLACEHOLDERS.coverageThreshold}';
const decision = buildInspectionDecision({
  outcome: $input.first().json,
  frameContext,
  instruction,
  threshold: Number(configured)
});
return [{ json: { frameContext, instruction, decision, decidedAt: new Date().toISOString() } }];
`;

  const duplicateGuard = `
const store = $getWorkflowStaticData('global');
const { frameContext, decision } = $input.first().json;
const key = frameContext.sessionId + ':' + frameContext.sequence;
const last = store.lastVerdictAt?.[key];
const duplicate =
  typeof last === 'number' && Date.now() - last < VERDICT_WINDOW_MS;
if (!duplicate) {
  store.lastVerdictAt = store.lastVerdictAt ?? {};
  store.lastVerdictAt[key] = Date.now();
}
return [{ json: { ...$input.first().json, shouldActuate: !duplicate } }];
`;

  const buildRecords = `
const { frameContext, instruction, decision, decidedAt } = $input.first().json;
const inspectionRow = buildInspectionRow(decision, {
  frameContext,
  inspectionTarget: $('resolve-instruction').first().json.inspectionTarget,
  modelInstruction: instruction,
  inspectedAt: decidedAt,
  frameUrl: null
});
const controlActionRow = buildControlActionRow({
  inspectionId: null,
  action: decision.verdict,
  esp32Accepted: $json.esp32Accepted ?? null,
  esp32Status: $json.esp32Status ?? null,
  requestedAt: decidedAt
});
return [{ json: { frameContext, instruction, decision, inspectionRow, controlActionRow, decidedAt } }];
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
      httpNode("fetch-current-prompt", "fetch-current-prompt", [-180, 160], {
        __continueOnError: true,
        method: "GET",
        url: `=${MODEL_BASE}/get_prompt`,
        options: { timeout: 1000 }
      }),
      codeNode("resolve-instruction", "resolve-instruction", [40, 160], resolveInstruction),
      httpNode("capture-frame", "capture-frame", [260, 160], {
        __continueOnError: true,
        method: "GET",
        url: `=${PI_CAPTURE}`,
        options: { timeout: 2000, response: { response: { responseFormat: "file" } } }
      }),
      codeNode("read-frame-context", "read-frame-context", [460, 160], readFrameContext),
      httpNode("detect-defects", "detect-defects", [680, 160], {
        method: "POST",
        url: `=${MODEL_BASE}/predict`,
        sendHeaders: true,
        headerParameters: { parameters: [] },
        sendBody: true,
        contentType: "multipart-form-data",
        bodyParameters: {
          parameters: [
            { parameterType: "formBinaryData", name: "image", inputDataFieldName: "image" },
            { parameterType: "formData", name: "prompt", value: "={{ $('resolve-instruction').first().json.instruction }}" }
          ]
        },
        options: { timeout: PLACEHOLDERS.modelTimeoutMs }
      }),
      codeNode("decide-inspection", "decide-inspection", [900, 160], decideInspection),
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
            conditions: [
              {
                id: "verdict-is-reject",
                leftValue: "={{ $json.decision.verdict }}",
                rightValue: "reject",
                operator: { type: "string", operation: "equals" }
              }
            ],
            combinator: "and"
          },
          options: {}
        },
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [1120, 160],
        name: "verdict-is-reject",
        id: "cn360-verdict-if"
      },
      {
        parameters: {
          assignments: {
            assignments: [
              { id: "action-reject", name: "action", value: "reject", type: "string" }
            ]
          },
          includeOtherFields: true
        },
        type: "n8n-nodes-base.set",
        typeVersion: 3.4,
        position: [1340, 40],
        name: "action-reject",
        id: "cn360-action-reject"
      },
      {
        parameters: {
          assignments: {
            assignments: [
              { id: "action-pass", name: "action", value: "pass", type: "string" }
            ]
          },
          includeOtherFields: true
        },
        type: "n8n-nodes-base.set",
        typeVersion: 3.4,
        position: [1340, 280],
        name: "action-pass",
        id: "cn360-action-pass"
      },
      codeNode("duplicate-guard", "duplicate-guard", [1560, 160], duplicateGuard),
      httpNode("post-verdict", "post-verdict", [1780, 160], {
        __continueOnError: true,
        method: "POST",
        url: `=${ESP32_VERDICT}`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ action: $json.action }) }}",
        options: { timeout: 800 }
      }),
      codeNode("build-records", "build-records", [2000, 160], buildRecords),
      supabaseTable("insert-inspection", [2220, 60], "inspection_results"),
      supabaseTable("insert-control-action", [2440, 60], "control_actions"),
      httpNode("upload-snapshot", "upload-snapshot", [2660, 60], {
        __continueOnError: true,
        method: "POST",
        url: `=https://${PLACEHOLDERS.supabaseHost}/storage/v1/object/${PLACEHOLDERS.snapshotBucket}/{{ $json.frameContext.sessionId }}-{{ $json.frameContext.sequence }}.jpg`,
        sendHeaders: true,
        headerParameters: supabaseHeaders([
          { name: "Content-Type", value: "image/jpeg" },
          { name: "x-upsert", value: "true" }
        ]),
        sendBody: true,
        contentType: "binary",
        options: {}
      }),
      httpNode("broadcast-hud", "broadcast-hud", [2880, 60], {
        __continueOnError: true,
        method: "POST",
        url: `=${RELAY_DETECTIONS}`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify(buildHudPayload({ decision: $('build-records').first().json.decision, frameContext: $('build-records').first().json.frameContext, snapshotUrl: null })) }}",
        options: { timeout: 1000 }
      }),
      supabaseTable("log-outcome", [3100, 60], "system_logs"),
      {
        parameters: {},
        type: "n8n-nodes-base.noOp",
        typeVersion: 1,
        position: [3320, 60],
        name: "done",
        id: "cn360-done"
      }
    ],
    connections: mergeLinks(
      link("trigger-schedule", "begin-inspection"),
      link("trigger-item-detected", "begin-inspection"),
      link("trigger-inspect-now", "begin-inspection"),
      link("begin-inspection", "fetch-current-prompt"),
      link("fetch-current-prompt", "resolve-instruction"),
      link("resolve-instruction", "capture-frame"),
      link("capture-frame", "read-frame-context"),
      link("read-frame-context", "detect-defects"),
      link("detect-defects", "decide-inspection"),
      link("decide-inspection", "verdict-is-reject"),
      branch("verdict-is-reject", ["action-reject", "action-pass"]),
      link("action-reject", "duplicate-guard"),
      link("action-pass", "duplicate-guard"),
      link("duplicate-guard", "post-verdict"),
      link("post-verdict", "build-records"),
      link("build-records", "insert-inspection"),
      link("insert-inspection", "insert-control-action"),
      link("insert-control-action", "upload-snapshot"),
      link("upload-snapshot", "broadcast-hud"),
      link("broadcast-hud", "log-outcome"),
      link("log-outcome", "done")
    ),
    settings: { executionOrder: "v1" },
    active: false,
    pinData: {},
    tags: []
  };
}

export function buildPromptCapture() {
  const buildPromptRecord = `
const { inspectionTarget, modelInstruction, modelHttpStatus, changedAt } = $input.first().json;
return [{ json: { promptRow: buildPromptHistoryRow({
  changedAt,
  inspectionTarget,
  modelInstruction,
  source: 'hud',
  modelHttpStatus
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
        options: { timeout: 1500 }
      }),
      codeNode("build-prompt-record", "build-prompt-record", [500, -100], buildPromptRecord),
      supabaseTable("insert-prompt-history", [720, -100], "prompt_history"),
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
try {
  const body = $input.first().json;
  return [{ json: { component: 'model-server', healthy: body?.status === 'ok', detail: body ?? null } }];
} catch (error) {
  return [{ json: { component: 'model-server', healthy: false, detail: null, error: String(error?.message ?? error) } }];
}
`;

  const probePi = `
try {
  const frameContext = parseFrameContext($json.headers ?? {});
  return [{ json: {
    component: 'capture-service',
    healthy: hasUsableFrameGeometry(frameContext),
    detail: frameContext
  } }];
} catch (error) {
  return [{ json: { component: 'capture-service', healthy: false, detail: null, error: String(error?.message ?? error) } }];
}
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
        options: { timeout: 3000, response: { response: { responseFormat: "file" } } }
      }),
      codeNode("probe-capture-result", "probe-capture-result", [40, 100], probePi),
      codeNode("record-transitions", "record-transitions", [260, 0], recordTransitions),
      supabaseTable("insert-health-log", [480, 0], "system_logs")
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
