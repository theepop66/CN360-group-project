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
