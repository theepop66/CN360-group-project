import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAllWorkflows, serializeWorkflows } from "./lib/workflow-definitions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, "workflows");

export function writeWorkflows(outputDir = OUTPUT) {
  const files = serializeWorkflows(buildAllWorkflows());
  mkdirSync(outputDir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(join(outputDir, file), contents, "utf8");
  }
  return Object.keys(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = writeWorkflows();
  for (const file of written) {
    console.log(`Wrote workflows/${file}`);
  }
  console.log("n8n import: Workflows -> Import from File");
}
