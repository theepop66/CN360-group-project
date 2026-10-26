// Talks to the 360ControlUnit ESP32 firmware (360ControlUnit/src/main.cpp):
// Verdicts require the active controller session/item and an identity-bound receipt.
// Mirrors the request/timeout pattern in js/prompt.js.

function deriveControlUrl(servoUrl, endpoint) {
  const parsed = new URL(servoUrl);
  parsed.pathname = parsed.pathname.replace(/\/[^/]*\/?$/, "/" + endpoint);
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

function deriveVerdictUrl(servoUrl) { return deriveControlUrl(servoUrl, "verdict"); }

async function postJson({ fetchImpl = fetch, url, body, method = "POST", timeoutMs = 8000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Control unit returned HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function setMode({ fetchImpl, url, mode, timeoutMs }) {
  if (mode !== "auto" && mode !== "manual") {
    throw new TypeError('mode must be "auto" or "manual".');
  }
  return postJson({ fetchImpl, url, body: { mode }, timeoutMs });
}

export async function setServoAngle({ fetchImpl, url, angle, timeoutMs }) {
  const value = Number(angle);
  if (!Number.isInteger(value) || value < 0 || value > 180) {
    throw new TypeError("angle must be an integer between 0 and 180.");
  }
  return postJson({ fetchImpl, url, body: { angle: value }, timeoutMs });
}

export function runSweep({ fetchImpl, url, timeoutMs }) {
  return postJson({ fetchImpl, url, body: { sweep: true }, timeoutMs });
}

// The firmware exposes /verdict on the same host as /servo but the HUD only
// has one configured URL for the control unit's servo endpoint, so the
// verdict endpoint is derived from it rather than adding a third config
// field the acceptance criteria didn't ask for.
export async function sendVerdict({ fetchImpl, servoUrl, action, timeoutMs, item }) {
  if (action !== "reject" && action !== "pass") {
    throw new TypeError('action must be "reject" or "pass".');
  }
  const active = item ?? await postJson({ fetchImpl, url: deriveControlUrl(servoUrl, "status"), method: "GET", timeoutMs });
  const valid = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  if ((!item && active.state !== "awaiting_verdict") || !valid(active.controller_session) || !valid(active.item_id)) {
    throw new Error("No active item is available for this Verdict.");
  }
  const identity = { controller_session: active.controller_session, item_id: active.item_id };
  const result = await postJson({ fetchImpl, url: deriveVerdictUrl(servoUrl), body: { action, ...identity }, timeoutMs });
  if (typeof result?.accepted !== "boolean" || result.controller_session !== identity.controller_session || result.item_id !== identity.item_id) {
    return { ...result, accepted: null, status: "delivery_unknown", reason: "unverified_acknowledgement" };
  }
  return result;
}

export { deriveVerdictUrl };
