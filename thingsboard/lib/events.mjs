// Translate the existing workflow envelope once at the monitoring boundary.
// Coverage is a frame-area fraction. A missing measurement is never zero.
export function inspectionEvent(input) {
  const { decision, frameContext = {}, itemContext, esp32 = {} } = input ?? {};
  if (!decision || !["pass", "reject"].includes(decision.verdict)) throw new Error("Invalid inspection verdict");
  const ts = Date.parse(input.controlCompletedAt ?? input.decidedAt);
  const started = Date.parse(input.requestedAt);
  if (!Number.isFinite(ts) || !Number.isFinite(started) || ts < started) throw new Error("Invalid inspection timing");
  const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  if (itemContext && (!validId(itemContext.controller_session) || !validId(itemContext.item_id))) throw new Error("Invalid item identity");
  if (!itemContext && (typeof input.executionId !== "string" || !input.executionId || input.executionId.length > 128)) throw new Error("Missing observation execution identity");
  const id = itemContext
    ? JSON.stringify(["item", itemContext.controller_session, itemContext.item_id])
    : JSON.stringify(["observation", input.workflowId ?? "cn360-inspection", input.executionId, input.requestedAt]);
  const evaluated = ["defect_detected", "no_defect_detected"].includes(decision.reason);
  const failures = [];
  if (!evaluated) failures.push(decision.reason ?? "unknown_inspection_failure");
  if (decision.promptMismatch) failures.push("prompt_mismatch");
  if (input.modelPromptMissing) failures.push("model_prompt_missing");
  if (itemContext && esp32.controlOutcome !== "accepted") failures.push("control_" + (esp32.controlOutcome ?? "delivery_unknown"));
  for (const [key, value] of [["coverage", decision.coverage], ["coverageThreshold", decision.coverageThreshold]]) {
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error("Invalid " + key);
  }
  const coverageAvailable = typeof decision.coverage === "number" && Number.isFinite(decision.coverage);
  return { id, ts, values: {
    event_id: id,
    inspection_at: input.decidedAt,
    inspection_target: String(input.inspectionTarget ?? ""),
    verdict: decision.verdict,
    verdict_reason: String(decision.reason ?? "unknown"),
    processing_ms: ts - started,
    coverage_available: coverageAvailable,
    defect_coverage_display: coverageAvailable ? (decision.coverage * 100).toFixed(3) + "%" : "Unavailable",
    ...(coverageAvailable ? { defect_coverage: decision.coverage, defect_coverage_percent: decision.coverage * 100 } : {}),
    ...(Number.isFinite(decision.coverageThreshold) ? { coverage_threshold: decision.coverageThreshold } : {}),
    box_count: decision.boxCount ?? 0,
    inspection_failed: failures.length > 0,
    failure_reason: failures.join(", ") || "none",
    item_bound: Boolean(itemContext),
    controller_session: itemContext?.controller_session ?? "",
    item_id: itemContext?.item_id ?? "",
    camera_session: String(frameContext.sessionId ?? ""),
    frame_sequence: frameContext.sequence ?? -1,
    control_outcome: esp32.controlOutcome ?? "not_requested",
    physical_sorting_confirmed: false,
    profile: String(input.monitoringProfile ?? "inspection"),
    source: String(input.source ?? "unknown")
  } };
}
