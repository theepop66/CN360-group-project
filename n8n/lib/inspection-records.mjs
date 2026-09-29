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
export function readEsp32Outcome(json) {
  const error = json?.error;
  if (error !== undefined && error !== null) {
    const message = typeof error === "string" ? error : error?.message;
    return {
      esp32Accepted: null,
      esp32Status: null,
      esp32Error: message === undefined || message === null ? String(error) : String(message)
    };
  }

  const accepted = typeof json?.accepted === "boolean" ? json.accepted : null;
  const status = typeof json?.status === "string" && json.status.trim() ? json.status : null;

  return { esp32Accepted: accepted, esp32Status: status, esp32Error: null };
}

function orNull(value) {
  return value === undefined ? null : value;
}

function readFrameContext(frameContext) {
  if (!frameContext || typeof frameContext !== "object") {
    return { sessionId: null, sequence: null, width: null, height: null };
  }
  return {
    sessionId: orNull(frameContext.sessionId) ?? null,
    sequence: orNull(frameContext.sequence) ?? null,
    width: orNull(frameContext.width) ?? null,
    height: orNull(frameContext.height) ?? null
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
  requestedAt
} = {}) {
  return {
    inspection_id: orNull(inspectionId),
    action: orNull(action),
    esp32_accepted: esp32Accepted ?? null,
    esp32_status: esp32Status ?? null,
    requested_at: orNull(requestedAt)
  };
}

export function buildPromptHistoryRow({
  changedAt,
  inspectionTarget,
  modelInstruction,
  source,
  modelHttpStatus
} = {}) {
  return {
    changed_at: orNull(changedAt),
    inspection_target: orNull(inspectionTarget),
    model_instruction: orNull(modelInstruction),
    source: orNull(source),
    model_http_status: orNull(modelHttpStatus)
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
