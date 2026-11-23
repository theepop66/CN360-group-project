import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import { verifyFrozenInputs, productionDiscrepancies } from "../lib/validation-integrity.mjs";
import { assessReadiness } from "../lib/model-validation.mjs";

test("wrong snapshot bytes remain a failure when the cross-service comparison succeeds", () => {
  const failures = productionDiscrepancies({ caseId: "case", snapshotSha256: "wrong", acquisitionFailures: ["captured image mismatch"] },
    { cases: [{ id: "case", servedSha256: "expected" }] }, []);
  assert.ok(failures.some(message => message.includes("snapshot")));
  assert.ok(failures.includes("captured image mismatch"));
});

test("frozen inputs are checked against actual bytes rather than cached metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cn360-frozen-"));
  try {
    const path = join(directory, "frame.jpg"); writeFileSync(path, "original image bytes");
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    const frozen = { cases: [{ id: "case", servedFile: "frame.jpg", servedSha256: sha, width: 448, height: 448 }] };
    assert.deepEqual(await verifyFrozenInputs(directory, frozen), []);
    writeFileSync(path, "different image bytes");
    assert.ok((await verifyFrozenInputs(directory, frozen)).some(message => message.includes("hash")));
  } finally {
    const target = realpathSync(directory);
    assert.ok(target.startsWith(realpathSync(tmpdir()) + sep + "cn360-frozen-")); rmSync(target, { recursive: true, force: true });
  }
});

test("slow dashboards or missing recovery/fallback evidence cannot pass readiness", () => {
  const criteria = { maxMissedDefects: 0, maxFalseRejects: 0, maxErrors: 0, modelBudgetMs: 1200, verdictWindowMs: 3000,
    dashboardVisibilityMs: 5000, healthIntervalMs: 10000, minimumDiagnosticAttempts: 1, minimumProductionAttempts: 1 };
  const base = { quality: { attempts: 1, missedDefects: 0, falseRejects: 0, errors: 0 },
    production: [{ result: "pass", modelMs: 800, receiptMs: 1000, controlOutcome: "accepted", visibleAfterMs: 60000 }], consistencyPassed: true,
    integrityVerified: true, fallbackVerified: true, recoveryVerified: true, healthPollingVerified: true };
  assert.equal(assessReadiness(base, criteria).gates.monitoring, "failed");
  const missing = assessReadiness({ ...base, production: [{ ...base.production[0], visibleAfterMs: 1000 }], fallbackVerified: undefined, recoveryVerified: undefined }, criteria);
  assert.equal(missing.gates.failureFallback, "unverified"); assert.equal(missing.gates.monitoringRecovery, "unverified");
  assert.equal(missing.readyForPhysicalIntegration, false);
  const passed = assessReadiness({ ...base, production: [{ ...base.production[0], visibleAfterMs: 1000 }] }, criteria);
  assert.equal(passed.readyForPhysicalIntegration, true);
  const unknownResult = assessReadiness({ ...base, production: [{ ...base.production[0], result: undefined, visibleAfterMs: 1000 }] }, criteria);
  assert.equal(unknownResult.gates.productionTiming, "failed");
});
