// "Take a photo": asks n8n for one unpaired inspection. n8n pulls a fresh frame from the
// camera node, asks the model, broadcasts the boxes to the HUD relay and stores the result.
// An unpaired inspect-now evaluates the image only and never sends a physical command
// (n8n/README.md, "Item identity and repeat frames"), so a pass or reject here is advice
// for the operator, not an action.
//
// The URL is a same-origin path (/n8n/inspect-now) that hud-server forwards to n8n, so this
// also works from the HTTPS page that WebXR needs. Mirrors the request/timeout pattern in
// js/prompt.js.

export const CAPTURE_TIMEOUT_MS = 15000;

const ADVICE_ONLY = "advice only, no machine command sent";

function readText(value, limit = 60) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

// Turns n8n's response into one line for the operator. `kind` is "ok", "review" or
// "error". Anything that is not a recognised evaluation is reported as a failure, never
// as a result, so a broken inspection cannot look like a clean one.
export function describeCaptureOutcome(httpStatus, body) {
  const payload = body && typeof body === "object" ? body : {};

  if (payload.status === "success" && (payload.result === "pass" || payload.result === "reject")) {
    return { kind: "ok", message: `Captured · AI says ${payload.result} · ${ADVICE_ONLY}` };
  }
  if (payload.status === "review_required") {
    const suggestion = readText(payload.modelSuggestion) ?? "unavailable";
    return {
      kind: "review",
      message: `Captured · human review required · AI suggestion: ${suggestion}`
    };
  }
  if (payload.status === "error") {
    return { kind: "error", message: `Capture failed · ${readText(payload.reason) ?? "unknown reason"}` };
  }
  if (httpStatus === 404) {
    return { kind: "error", message: "Capture failed · n8n webhook not found (is the workflow active?)" };
  }
  if (!(httpStatus >= 200 && httpStatus < 300)) {
    const detail = readText(payload.error) ?? readText(payload.message);
    return {
      kind: "error",
      message: `Capture failed · HTTP ${httpStatus}${detail ? ` · ${detail}` : ""}`
    };
  }
  return { kind: "error", message: "Capture failed · unexpected response from n8n" };
}

// The body is always `{}`: the HUD never sends an item identity, so this can only ever be an
// unpaired inspection. Network failures and timeouts are thrown for the caller to report.
export async function requestCapture({ fetchImpl = fetch, url, timeoutMs = CAPTURE_TIMEOUT_MS }) {
  if (typeof url !== "string" || !url.trim()) {
    throw new TypeError("Capture URL is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal
    });

    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      body = null;
    }
    return describeCaptureOutcome(response.status, body);
  } finally {
    clearTimeout(timeout);
  }
}
