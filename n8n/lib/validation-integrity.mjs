import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function frozenImagePath(folder, picture) {
  if (typeof picture.servedFile !== "string") throw new Error("Legacy protocol has no frozen run-local image; use a new output directory for a new run");
  const root = resolve(folder); const path = resolve(root, picture.servedFile);
  if (!path.startsWith(root + sep)) throw new Error("Frozen image path leaves the run directory");
  return path;
}

export async function verifyFrozenInputs(folder, frozen) {
  const errors = [];
  for (const picture of frozen.cases) {
    try {
      if (sha256(readFileSync(frozenImagePath(folder, picture))) !== picture.servedSha256) errors.push(picture.id + ": frozen input hash mismatch");
    } catch { errors.push(picture.id + ": frozen input unavailable"); }
  }
  return errors;
}

export function productionDiscrepancies(row, frozen, compared) {
  const errors = [...(row.acquisitionFailures ?? []), ...compared];
  const picture = frozen.cases.find(candidate => candidate.id === row.caseId);
  if (!picture || row.snapshotSha256 !== picture.servedSha256) errors.push("Stored snapshot hash differs from the frozen input");
  return [...new Set(errors)];
}
