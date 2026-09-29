export const DEFAULT_COVERAGE_THRESHOLD = 0.005;

// The ESP32 auto-passes after 3000 ms, so every stage before the verdict is
// budgeted: fetch the prompt, capture the frame, store the snapshot, ask the
// model. The snapshot upload is in here on purpose — see the note on the
// capture fan-out in workflow-definitions.mjs.
export const VERDICT_WINDOW_MS = 3000;
export const MODEL_PROMPT_TIMEOUT_MS = 250;
export const CAPTURE_TIMEOUT_MS = 800;
export const SNAPSHOT_UPLOAD_TIMEOUT_MS = 300;
export const MODEL_TIMEOUT_MS = 1200;
export const VERDICT_POST_TIMEOUT_MS = 250;
export const PRE_VERDICT_BUDGET_MS =
  MODEL_PROMPT_TIMEOUT_MS +
  CAPTURE_TIMEOUT_MS +
  SNAPSHOT_UPLOAD_TIMEOUT_MS +
  MODEL_TIMEOUT_MS;

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
  MODEL_INSTRUCTION_MISSING: "model_instruction_missing",
  MODEL_INVALID_BOX: "model_invalid_box",
  FRAME_CAPTURE_FAILED: "frame_capture_failed",
  FRAME_CONTEXT_INVALID: "frame_context_invalid",
  INVALID_THRESHOLD: "invalid_threshold",
  INVALID_VERDICT_BUDGET: "invalid_verdict_budget"
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

const UNREACHABLE_PATTERN = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|fetch failed|socket hang up/i;
const TIMEOUT_PATTERN = /timed?\s*out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i;

// n8n hands an HTTP failure back as an error item. Mapping it here means the
// fail-safe reasons are decided by tested code, not by node configuration.
export function classifyModelOutcome(json) {
  const error = json?.error;
  if (error === undefined || error === null) {
    return { kind: "ok", response: json };
  }

  const detail = String(typeof error === "string" ? error : error?.message ?? error ?? "");
  const reason = TIMEOUT_PATTERN.test(detail)
    ? FailureReason.MODEL_TIMEOUT
    : UNREACHABLE_PATTERN.test(detail)
      ? FailureReason.MODEL_UNREACHABLE
      : FailureReason.MODEL_HTTP_ERROR;

  return { kind: "failure", reason, detail };
}

function suppressionKey(frameContext) {
  if (!frameContext || typeof frameContext !== "object") return null;
  const sessionId = readTrimmed(frameContext.sessionId);
  const sequence = asFiniteNumber(frameContext.sequence);
  if (!sessionId || sequence === null) return null;
  return `${sessionId}:${sequence}`;
}

export function shouldSuppressDuplicate(store, frameContext, nowMs, windowMs = VERDICT_WINDOW_MS) {
  const key = suppressionKey(frameContext);
  if (!key) return false;

  const target = store && typeof store === "object" ? store : {};
  const now = asFiniteNumber(nowMs) ?? Date.now();
  const last = target.lastVerdictAt?.[key];
  if (typeof last === "number" && now - last < windowMs) return true;

  target.lastVerdictAt = target.lastVerdictAt ?? {};
  target.lastVerdictAt[key] = now;
  return false;
}

const UNSAFE_NAME_CHARS = /[^A-Za-z0-9._-]/g;

export function buildSnapshotObjectName(frameContext) {
  const session = readTrimmed(frameContext?.sessionId) ?? "frame";
  const sequence = asFiniteNumber(frameContext?.sequence);
  const stamp = sequence === null ? "unknown" : String(sequence);
  return `${session}-${stamp}.jpg`.replace(UNSAFE_NAME_CHARS, "-");
}

// The workflow ships the timeout as REPLACE_MODEL_TIMEOUT_MS so it can be tuned
// per deployment. Whatever it becomes, the whole pre-verdict path has to leave
// headroom inside the ESP32 Verdict Window, so the budget is checked rather
// than assumed. An unreadable value falls back to the shipped default instead
// of disabling the check — but the substitution is reported, never silent,
// because a configured value that quietly went unread is a deployment fault.
export function resolveVerdictBudget(configuredModelTimeoutMs) {
  const requested = asFiniteNumber(configuredModelTimeoutMs);
  const readable = requested !== null && requested > 0;
  const modelTimeoutMs = readable ? requested : MODEL_TIMEOUT_MS;
  const totalMs =
    PRE_VERDICT_BUDGET_MS - MODEL_TIMEOUT_MS + modelTimeoutMs + VERDICT_POST_TIMEOUT_MS;
  const fits = totalMs < VERDICT_WINDOW_MS;

  return {
    configured: configuredModelTimeoutMs ?? null,
    readable,
    substituted: !readable,
    modelTimeoutMs,
    // Refusing the load means nothing if the wire wait is untouched — the
    // ESP32's auto-pass would fire first. The timeout the HTTP node applies is
    // clamped inside the window so the forced reject is the thing that arrives.
    appliedModelTimeoutMs: fits ? modelTimeoutMs : MODEL_TIMEOUT_MS,
    totalMs,
    fits
  };
}

// The Coverage Threshold decides pass or reject, so an unreadable configured
// value must not be guessed at. An unconfigured placeholder falls back to the
// documented default; a value that was set but cannot be read is a fault and is
// returned as null so the decision fails closed with `invalid_threshold`.
export function resolveCoverageThreshold(configuredThreshold) {
  const raw = typeof configuredThreshold === "string" ? configuredThreshold.trim() : configuredThreshold;

  if (raw === null || raw === undefined || raw === "") {
    return { value: DEFAULT_COVERAGE_THRESHOLD, configured: null, readable: true, defaulted: true };
  }
  if (typeof raw === "string" && raw.startsWith("REPLACE_")) {
    return { value: DEFAULT_COVERAGE_THRESHOLD, configured: raw, readable: true, defaulted: true };
  }

  const value = asFiniteNumber(raw);
  if (value === null || value < 0 || value > 1) {
    return { value: null, configured: raw, readable: false, defaulted: false };
  }

  return { value, configured: raw, readable: true, defaulted: false };
}

// Both watchdog probes read a different response shape but share one rule: a
// throw is a failure, and only a well-formed answer can be healthy.
export function buildHealthProbe(component, readDetail, isHealthy) {
  try {
    const detail = readDetail();
    return { component, healthy: isHealthy(detail) === true, detail, error: null };
  } catch (error) {
    return { component, healthy: false, detail: null, error: String(error?.message ?? error) };
  }
}

export function buildInspectionDecision({
  outcome,
  frameContext,
  instruction,
  threshold,
  budget,
  frameCaptureFailed = false
} = {}) {
  // A dead Pi is its own failure, and naming it keeps it out of the model's
  // failure reasons where it would be misread as a model problem. There are no
  // boxes to show in this case: the frame never arrived.
  if (frameCaptureFailed) {
    return rejected(FailureReason.FRAME_CAPTURE_FAILED);
  }

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

  // Boxes found under an instruction nobody can name are not a verdict, but they
  // are still what the operator needs to see — the threshold never hides a box.
  // So the boxes are parsed first and the Verdict is forced afterwards.
  const instructionMissing = typeof instruction !== "string" || !instruction.trim();
  if (instructionMissing) {
    return {
      ...rejected(FailureReason.MODEL_INSTRUCTION_MISSING, { coverageThreshold }),
      coverage,
      boxCount: detections.length,
      detections,
      ...prompt
    };
  }

  // A budget that cannot fit is a setup error, but it is still a reject. The
  // measured figures and the boxes survive so the operator can see what the
  // model found; only the physical path is forced.
  const budgetFits = budget?.fits !== false;
  const verdict = budgetFits ? decideVerdict(coverage, coverageThreshold) : VERDICT.REJECT;

  return {
    verdict,
    reason: budgetFits
      ? verdict === VERDICT.REJECT
        ? REASON_DEFECT
        : REASON_NO_DEFECT
      : FailureReason.INVALID_VERDICT_BUDGET,
    coverage,
    coverageThreshold,
    boxCount: detections.length,
    detections,
    ...prompt
  };
}
