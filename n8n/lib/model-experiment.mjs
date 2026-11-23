import { timingSummary } from "./model-validation.mjs";

function countsAt(samples, threshold) {
  const errors = samples.filter(row => !Number.isFinite(row.coverage) || row.error || row.promptMismatch).length;
  const missedDefects = samples.filter(row => Number.isFinite(row.coverage) && row.expected === "reject" && row.coverage < threshold).length;
  const falseRejects = samples.filter(row => Number.isFinite(row.coverage) && row.expected === "pass" && row.coverage >= threshold).length;
  return { threshold, errors, missedDefects, falseRejects };
}

function compareFit(a, b) {
  return a.errors - b.errors || a.missedDefects - b.missedDefects || a.falseRejects - b.falseRejects ||
    Math.abs(a.threshold - 0.005) - Math.abs(b.threshold - 0.005);
}

export function tuneThreshold(samples) {
  const coverage = [...new Set(samples.map(row => row.coverage).filter(Number.isFinite))].sort((a, b) => a - b);
  const thresholds = [0.005, ...coverage, ...coverage.map((value, index) => (value + (coverage[index + 1] ?? 1)) / 2)];
  return thresholds.map(threshold => countsAt(samples, threshold)).sort(compareFit)[0];
}

export function selectCandidate(samples) {
  if (!samples.length || samples.some(row => row.split !== "development")) throw new Error("Selection accepts development samples only");
  return [...Map.groupBy(samples, row => row.variant)].map(([variant, rows]) => ({ variant, ...tuneThreshold(rows),
    timing: timingSummary(rows.map(row => row.elapsedMs)) })).sort((a, b) => compareFit(a, b) ||
      (a.timing.p95Ms ?? Infinity) - (b.timing.p95Ms ?? Infinity) || a.variant.localeCompare(b.variant))[0];
}

export function qualifyCondition(samples, { expectedCaseIds, repetitions, parityPassed, integrityPassed, productionPassed } = {}) {
  const expected = new Set(expectedCaseIds ?? []);
  const complete = expected.size >= 4 && samples.length === expected.size * repetitions && [...expected].every(id => {
    const rows = samples.filter(row => row.caseId === id);
    return rows.length === repetitions && new Set(rows.map(row => row.repetition)).size === repetitions &&
      rows.every(row => Number.isInteger(row.repetition) && row.repetition >= 1 && row.repetition <= repetitions);
  }) && samples.every(row => expected.has(row.caseId));
  const classHashes = outcome => new Set(samples.filter(row => row.expected === outcome).map(row => row.originalSha256).filter(Boolean));
  const good = classHashes("pass"); const defective = classHashes("reject");
  const distinct = good.size >= 2 && defective.size >= 2 && [...good].every(hash => !defective.has(hash));
  const quality = complete && distinct && samples.every(row => row.actual === row.expected && !row.error && !row.promptMismatch);
  const qualification = { quality, integrity: integrityPassed === true, parity: parityPassed === true, production: productionPassed === true };
  return { qualification, automaticApproval: Object.values(qualification).every(Boolean), complete, distinct,
    timing: timingSummary(samples.map(row => row.elapsedMs)),
    missedDefects: samples.filter(row => row.expected === "reject" && row.actual === "pass").length,
    falseRejects: samples.filter(row => row.expected === "pass" && row.actual === "reject").length,
    errors: samples.filter(row => !["pass", "reject"].includes(row.actual)).length };
}

export function boxParity(actual, reference, tolerance = 0.02) {
  const canonical = boxes => boxes.map(row => ({ label: row.label, box: row.box })).sort((a, b) =>
    a.label.localeCompare(b.label) || a.box[0] - b.box[0] || a.box[1] - b.box[1] || a.box[2] - b.box[2] || a.box[3] - b.box[3]);
  const a = canonical(actual); const b = canonical(reference);
  const passed = a.length === b.length && a.every((row, i) => row.label === b[i].label && row.box.length === 4 &&
    row.box.every((value, j) => Number.isFinite(value) && Math.abs(value - b[i].box[j]) <= tolerance));
  return { passed, tolerancePixels: tolerance, actualCount: a.length, referenceCount: b.length };
}
