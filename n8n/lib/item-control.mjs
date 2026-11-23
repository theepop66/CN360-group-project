import { readEsp32Outcome } from "./inspection-records.mjs";

// Strings survive JSON/JavaScript without losing 64-bit controller counters.
export function parsePhysicalItem(source, incoming) {
  const hasIdentity = incoming.controller_session !== undefined || incoming.item_id !== undefined;
  if (!hasIdentity && source !== "item_detected") return { item: null, error: null };
  const validToken = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  const window = incoming.verdict_window_ms;
  if (!validToken(incoming.controller_session) || !validToken(incoming.item_id) ||
      !Number.isInteger(window) || window <= 0 || window > 3000) {
    return { item: null, error: "invalid_item_context" };
  }
  return { item: { controller_session: incoming.controller_session, item_id: incoming.item_id, verdict_window_ms: window }, error: null };
}

export function readControlReceipt(json, item) {
  const raw = readEsp32Outcome(json);
  const body = json?.body ?? json;
  const outcome = { ...raw, controllerSession: item?.controller_session ?? null, itemId: item?.item_id ?? null,
    acknowledgedControllerSession: typeof body?.controller_session === "string" ? body.controller_session : null,
    acknowledgedItemId: typeof body?.item_id === "string" ? body.item_id : null };
  if (!item) return { ...outcome, esp32Accepted: null, controlOutcome: "not_requested", controlReason: "observational" };
  const matches = body?.controller_session === item.controller_session && body?.item_id === item.item_id;
  const successfulHttp = raw.esp32HttpStatus >= 200 && raw.esp32HttpStatus < 300;
  if (!matches || !successfulHttp || raw.esp32Accepted === null || raw.esp32Error) {
    return { ...outcome, esp32Accepted: null, controlOutcome: "delivery_unknown", controlReason: raw.esp32Error || "unverified_acknowledgement" };
  }
  return { ...outcome, controlOutcome: raw.esp32Accepted ? "accepted" : "ignored", controlReason: body.reason ?? body.status ?? "unspecified" };
}

// Physical-item records must not be suppressed because a camera reused a frame.
// The controller alone enforces actuation idempotency; this key only affects audit/HUD.
export function inspectionDedupContext(frame, item) {
  return item ? { sessionId: JSON.stringify([item.controller_session, item.item_id]), sequence: 0 } : frame;
}
