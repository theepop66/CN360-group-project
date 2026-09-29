export const DEFAULT_COVERAGE_THRESHOLD = 0.005;
export const MODEL_TIMEOUT_MS = 2000;
export const VERDICT_WINDOW_MS = 3000;
export const MODEL_SUCCESS_STATUS = "success";
export const DEFAULT_DETECTION_LABEL = "defect";

export const VERDICT = Object.freeze({ PASS: "pass", REJECT: "reject" });

export const FailureReason = Object.freeze({
  MODEL_TIMEOUT: "model_timeout",
  MODEL_UNREACHABLE: "model_unreachable",
  MODEL_HTTP_ERROR: "model_http_error",
  MODEL_INVALID_RESPONSE: "model_invalid_response",
  MODEL_STATUS_MISSING: "model_status_missing",
  MODEL_ERROR_STATUS: "model_error_status",
  MODEL_INVALID_BOX: "model_invalid_box",
  FRAME_CAPTURE_FAILED: "frame_capture_failed",
  FRAME_CONTEXT_INVALID: "frame_context_invalid",
  INVALID_THRESHOLD: "invalid_threshold"
});

const REASON_NO_DEFECT = "no_defect_detected";
const REASON_DEFECT = "defect_detected";

const FRAME_HEADERS = Object.freeze({
  sessionId: "x-camera-session",
  sequence: "x-frame-sequence",
  capturedAt: "x-captured-at",
  width: "x-frame-width",
  height: "x-frame-height"
});

function asFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  if (key === undefined) return null;
  const value = headers[key];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === null || first === undefined) return null;
  return String(first);
}

function readTrimmed(header) {
  return header && header.trim() ? header.trim() : null;
}

export function boxArea(box) {
  if (!Array.isArray(box) || box.length < 4) return 0;
  const coords = box.slice(0, 4).map(asFiniteNumber);
  if (coords.some((value) => value === null)) return 0;
  const [x1, y1, x2, y2] = coords;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

// Overlapping boxes are summed rather than unioned: the figure is a relative
// signal, so the clamp to 1 is what keeps it a fraction of the frame.
export function defectCoverage(detections, frameWidth, frameHeight) {
  const width = asFiniteNumber(frameWidth);
  const height = asFiniteNumber(frameHeight);
  if (width === null || height === null || width <= 0 || height <= 0) return null;

  const frameArea = width * height;
  if (!Number.isFinite(frameArea) || frameArea <= 0) return null;

  const boxes = Array.isArray(detections) ? detections : [];
  const covered = boxes.reduce((total, candidate) => {
    const box = candidate && typeof candidate === "object" && "box" in candidate ? candidate.box : candidate;
    return total + boxArea(box);
  }, 0);

  return Math.min(1, Math.max(0, covered / frameArea));
}

// A coverage figure or threshold we cannot read is treated as suspect rather
// than clean: `coverage >= NaN` would otherwise pass every item.
export function decideVerdict(coverage, threshold) {
  const limit = asFiniteNumber(threshold);
  const value = asFiniteNumber(coverage);
  if (limit === null || limit < 0) return VERDICT.REJECT;
  if (value === null) return VERDICT.REJECT;
  return value >= limit ? VERDICT.REJECT : VERDICT.PASS;
}

export function parseFrameContext(headers) {
  return {
    sessionId: readTrimmed(readHeader(headers, FRAME_HEADERS.sessionId)),
    sequence: asFiniteNumber(readHeader(headers, FRAME_HEADERS.sequence)),
    capturedAt: readTrimmed(readHeader(headers, FRAME_HEADERS.capturedAt)),
    width: asFiniteNumber(readHeader(headers, FRAME_HEADERS.width)),
    height: asFiniteNumber(readHeader(headers, FRAME_HEADERS.height))
  };
}

export function hasUsableFrameGeometry(frameContext) {
  if (!frameContext || typeof frameContext !== "object") return false;
  const width = asFiniteNumber(frameContext.width);
  const height = asFiniteNumber(frameContext.height);
  return width !== null && height !== null && width > 0 && height > 0;
}

// Mirrors the HUD parser's own box rule (x2 > x1, y2 > y1) so a box we accept
// is always a box the overlay can render.
function readRenderableBox(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (!Array.isArray(candidate.box) || candidate.box.length < 4) return null;
  const coords = candidate.box.slice(0, 4).map(asFiniteNumber);
  if (coords.some((value) => value === null)) return null;
  const [x1, y1, x2, y2] = coords;
  if (x2 <= x1 || y2 <= y1) return null;
  return coords;
}

function readLabel(candidate) {
  const label = candidate.label;
  if (typeof label !== "string") return DEFAULT_DETECTION_LABEL;
  return label.trim() ? label.trim() : DEFAULT_DETECTION_LABEL;
}

function rejected(reason, overrides = {}) {
  return {
    verdict: VERDICT.REJECT,
    reason,
    coverage: null,
    coverageThreshold: null,
    boxCount: 0,
    detections: [],
    promptVerified: null,
    promptUsed: null,
    promptMismatch: false,
    ...overrides
  };
}

function readCoverageThreshold(threshold) {
  if (threshold === undefined) return DEFAULT_COVERAGE_THRESHOLD;
  const value = asFiniteNumber(threshold);
  return value !== null && value >= 0 ? value : null;
}

function verifyPrompt(response, instruction) {
  const promptUsed = typeof response.prompt_used === "string" && response.prompt_used.trim()
    ? response.prompt_used
    : null;
  const expected = typeof instruction === "string" && instruction.trim() ? instruction : null;

  if (promptUsed === null || expected === null) {
    return { promptVerified: null, promptUsed, promptMismatch: false };
  }
  const verified = promptUsed === expected;
  return { promptVerified: verified, promptUsed, promptMismatch: !verified };
}

export function buildInspectionDecision({ outcome, frameContext, instruction, threshold } = {}) {
  const coverageThreshold = readCoverageThreshold(threshold);
  if (coverageThreshold === null) {
    return rejected(FailureReason.INVALID_THRESHOLD);
  }

  if (!outcome || typeof outcome !== "object") {
    return rejected(FailureReason.MODEL_INVALID_RESPONSE);
  }
  if (outcome.kind === "failure") {
    return rejected(outcome.reason || FailureReason.MODEL_UNREACHABLE, { coverageThreshold });
  }
  if (outcome.kind !== "ok") {
    return rejected(FailureReason.MODEL_INVALID_RESPONSE, { coverageThreshold });
  }

  const response = outcome.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return rejected(FailureReason.MODEL_INVALID_RESPONSE, { coverageThreshold });
  }
  if (typeof response.status !== "string" || !response.status.trim()) {
    return rejected(FailureReason.MODEL_STATUS_MISSING, { coverageThreshold });
  }
  if (response.status !== MODEL_SUCCESS_STATUS) {
    return rejected(FailureReason.MODEL_ERROR_STATUS, { coverageThreshold });
  }
  if (!Array.isArray(response.detections)) {
    return rejected(FailureReason.MODEL_INVALID_RESPONSE, { coverageThreshold });
  }
  if (!hasUsableFrameGeometry(frameContext)) {
    return rejected(FailureReason.FRAME_CONTEXT_INVALID, { coverageThreshold });
  }

  const detections = [];
  for (const candidate of response.detections) {
    const box = readRenderableBox(candidate);
    if (box === null) {
      return rejected(FailureReason.MODEL_INVALID_BOX, { coverageThreshold });
    }
    detections.push({ label: readLabel(candidate), box });
  }

  const coverage = defectCoverage(detections, frameContext.width, frameContext.height);
  const prompt = verifyPrompt(response, instruction);

  return {
    verdict: decideVerdict(coverage, coverageThreshold),
    reason: decideVerdict(coverage, coverageThreshold) === VERDICT.REJECT ? REASON_DEFECT : REASON_NO_DEFECT,
    coverage,
    coverageThreshold,
    boxCount: detections.length,
    detections,
    ...prompt
  };
}
