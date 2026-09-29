import { VERDICT } from "./inspection-logic.mjs";

export const MODEL_INSTRUCTION_TEMPLATE =
  "Locate all the instances that matches the following description: {target}.";

export const HUD_MESSAGE_TYPE = "detections";
export const HUD_COORDINATE_SPACE = "pixel";

const TRAILING_SENTENCE_PUNCTUATION = /[.!?]+$/;

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

// The exact grammar is part of the model contract, so the target is normalised
// here once and every consumer gets an identical instruction.
export function buildModelInstruction(target) {
  const normalized = trimmed(target).replace(TRAILING_SENTENCE_PUNCTUATION, "").trim();
  if (!normalized) return null;
  return MODEL_INSTRUCTION_TEMPLATE.replace("{target}", normalized);
}

// Recovering the target from the instruction is the inverse of the builder, so
// it is derived from the same template rather than split on a hand-written
// delimiter. An instruction that is not the canonical shape yields null: a
// guess would write the operator's own words into the Inspection Result wrong.
const [TEMPLATE_PREFIX, TEMPLATE_SUFFIX] = MODEL_INSTRUCTION_TEMPLATE.split("{target}");

export function parseInspectionTarget(instruction) {
  if (typeof instruction !== "string") return null;
  const candidate = instruction.trim();
  if (candidate.length <= TEMPLATE_PREFIX.length + TEMPLATE_SUFFIX.length) return null;
  if (!candidate.startsWith(TEMPLATE_PREFIX)) return null;
  if (!candidate.endsWith(TEMPLATE_SUFFIX)) return null;

  const target = candidate
    .slice(TEMPLATE_PREFIX.length, candidate.length - TEMPLATE_SUFFIX.length)
    .trim();
  return target ? target : null;
}

// The firmware answers { accepted, status }. Anything else means the board never
// spoke, and recording that as acceptance would hide an unreachable controller.
// n8n wraps an HTTP response in { body, headers, statusCode, statusMessage }
// when "Include Response Headers and Status" is on. The ESP32's own contract
// { accepted, status } lives inside `body` there; a bare object means the
// verdict post went through without the envelope (or in an older graph).
export function readEsp32Outcome(json) {
  const error = json?.error;
  if (error !== undefined && error !== null) {
    const message = typeof error === "string" ? error : error?.message;
    return {
      esp32Accepted: null,
      esp32Status: null,
      esp32HttpStatus: null,
      esp32Error: message === undefined || message === null ? String(error) : String(message)
    };
  }

  const body =
    json && typeof json === "object" && json.body && typeof json.body === "object"
      ? json.body
      : json;
  const accepted = typeof body?.accepted === "boolean" ? body.accepted : null;
  const status =
    typeof body?.status === "string" && body.status.trim() ? body.status : null;
  const httpStatus = typeof json?.statusCode === "number" ? json.statusCode : null;

  return { esp32Accepted: accepted, esp32Status: status, esp32HttpStatus: httpStatus, esp32Error: null };
}

function orNull(value) {
  return value === undefined ? null : value;
}

function readFrameContext(frameContext) {
  if (!frameContext || typeof frameContext !== "object") {
    return { sessionId: null, sequence: null, width: null, height: null };
  }
  return {
    sessionId: orNull(frameContext.sessionId),
    sequence: orNull(frameContext.sequence),
    width: orNull(frameContext.width),
    height: orNull(frameContext.height)
  };
}

export function buildInspectionRow(decision, {
  frameContext,
  inspectionTarget,
  modelInstruction,
  inspectedAt,
  frameUrl
} = {}) {
  const frame = readFrameContext(frameContext);
  return {
    inspection_at: orNull(inspectedAt),
    inspection_target: orNull(inspectionTarget),
    model_instruction: orNull(modelInstruction),
    camera_session: frame.sessionId,
    frame_sequence: frame.sequence,
    frame_width: frame.width,
    frame_height: frame.height,
    box_count: decision.boxCount ?? 0,
    defect_coverage: decision.coverage ?? null,
    coverage_threshold: decision.coverageThreshold ?? null,
    verdict: decision.verdict,
    prompt_verified: decision.promptVerified ?? null,
    frame_url: orNull(frameUrl)
  };
}

export function buildControlActionRow({
  inspectionId,
  action,
  esp32Accepted,
  esp32Status,
  esp32HttpStatus,
  esp32Error,
  requestedAt
} = {}) {
  return {
    inspection_id: orNull(inspectionId),
    action: orNull(action),
    esp32_accepted: esp32Accepted ?? null,
    esp32_status: esp32Status ?? null,
    esp32_http_status: esp32HttpStatus ?? null,
    esp32_error: esp32Error ?? null,
    requested_at: orNull(requestedAt)
  };
}

export function buildPromptHistoryRow({
  changedAt,
  inspectionTarget,
  modelInstruction,
  source,
  modelHttpStatus,
  modelError
} = {}) {
  return {
    changed_at: orNull(changedAt),
    inspection_target: orNull(inspectionTarget),
    model_instruction: orNull(modelInstruction),
    source: orNull(source),
    model_http_status: orNull(modelHttpStatus),
    model_error: orNull(modelError)
  };
}

export function buildSystemLogRow({
  loggedAt,
  severity,
  component,
  message,
  details
} = {}) {
  return {
    logged_at: orNull(loggedAt),
    severity: orNull(severity),
    component: orNull(component),
    message: orNull(message),
    details: details === undefined ? null : details
  };
}

export function buildHudPayload({ decision, frameContext, snapshotUrl } = {}) {
  const frame = readFrameContext(frameContext);
  const verdict = decision.verdict ?? VERDICT.REJECT;

  return {
    type: HUD_MESSAGE_TYPE,
    coordinateSpace: HUD_COORDINATE_SPACE,
    status: verdict,
    reason: decision.reason ?? null,
    timestamp: frameContext?.capturedAt ?? null,
    frame: {
      // The HUD's parser reads frame.id first and uses it to order and
      // de-duplicate frames, so it is composed from the Frame Context the Pi
      // sent rather than left null. Session plus sequence is the same identity
      // the duplicate guard uses.
      id: frame.sessionId && frame.sequence !== null ? `${frame.sessionId}:${frame.sequence}` : null,
      sessionId: frame.sessionId,
      sequence: frame.sequence,
      width: frame.width,
      height: frame.height
    },
    snapshotUrl: orNull(snapshotUrl),
    detections: (decision.detections ?? []).map((detection) => ({
      label: detection.label,
      box: detection.box,
      status: verdict
    }))
  };
}
