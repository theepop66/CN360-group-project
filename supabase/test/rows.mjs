import { buildInspectionRow, buildControlActionRow, buildPromptHistoryRow, buildSystemLogRow } from "../../n8n/lib/inspection-records.mjs";
const itemContext = { controller_session: "migration-test", item_id: "18446744073709551615" };
const now = "2026-10-28T00:00:00Z";
const rows = {
  inspection_results: buildInspectionRow({ verdict: "pass", coverage: 0.001, coverageThreshold: 0.005, boxCount: 1, promptVerified: true }, {
    inspectedAt: now, inspectionTarget: "scratch", modelInstruction: "Locate all the instances that matches the following description: scratch.",
    frameContext: { sessionId: "camera-test", sequence: 1, width: 640, height: 480 }, itemContext }),
  control_actions: buildControlActionRow({ inspectionId: 1, action: "pass", esp32Accepted: true, esp32Status: "accepted", esp32HttpStatus: 200,
    requestedAt: now, itemContext, controlOutcome: "accepted", controlReason: "accepted", acknowledgedControllerSession: itemContext.controller_session, acknowledgedItemId: itemContext.item_id }),
  prompt_history: buildPromptHistoryRow({ changedAt: now, inspectionTarget: "scratch", modelInstruction: "Locate all the instances that matches the following description: scratch.", source: "migration-test", modelHttpStatus: 200 }),
  system_logs: buildSystemLogRow({ loggedAt: now, severity: "info", component: "migration-test", message: "test", details: { test: true } })
};
if (process.argv.includes("--observational")) {
  rows.inspection_results = buildInspectionRow({ verdict: "reject", boxCount: 0, coverage: null, coverageThreshold: 0.005 }, { inspectedAt: now });
  rows.control_actions = buildControlActionRow({ inspectionId: 1, action: null, requestedAt: now, controlOutcome: "not_requested", controlReason: "unpaired_observation" });
}
console.log(JSON.stringify(rows));
