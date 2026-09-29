// Talks to the 360ControlUnit ESP32 firmware (360ControlUnit/src/main.cpp):
// POST /mode {mode}, POST /servo {angle|sweep}, POST /verdict {action}.
// Mirrors the request/timeout pattern in js/prompt.js.

function deriveVerdictUrl(servoUrl) {
  const parsed = new URL(servoUrl);
  parsed.pathname = parsed.pathname.replace(/\/[^/]*\/?$/, "/verdict");
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

async function postJson({ fetchImpl = fetch, url, body, timeoutMs = 8000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
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
export async function sendVerdict({ fetchImpl, servoUrl, action, timeoutMs }) {
  if (action !== "reject" && action !== "pass") {
    throw new TypeError('action must be "reject" or "pass".');
  }
  return postJson({ fetchImpl, url: deriveVerdictUrl(servoUrl), body: { action }, timeoutMs });
}

export { deriveVerdictUrl };
