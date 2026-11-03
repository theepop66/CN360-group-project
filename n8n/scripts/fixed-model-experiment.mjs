import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { command } from "../lib/inspection-test-runtime.mjs";
import { assertNativePortAvailable, nativeEnvironment, waitForNativeModel } from "../lib/native-profile.mjs";
import { buildModelInstruction } from "../lib/inspection-records.mjs";
import { scorePrediction, summarizeQuality, timingSummary } from "../lib/model-validation.mjs";
import { selectCandidate, qualifyCondition, boxParity } from "../lib/model-experiment.mjs";
import { SoftwareValidationClient, loadValidationConfiguration, jsonRequest, waitUntil } from "../lib/software-validation-client.mjs";
import { validationGallery } from "../lib/validation-gallery.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { phase: { type: "string" }, output: { type: "string" },
  settings: { type: "string", default: join(root, "thingsboard/software-native.local.json") },
  source: { type: "string", default: "D:/CN360/locate-anything.cpp" } } });
if (!["develop", "parity", "evaluate", "production", "finalize"].includes(values.phase) || !values.output) {
  throw new Error("Provide --phase develop|parity|evaluate|production|finalize and --output prepared-directory");
}
const output = resolve(values.output);
const read = name => JSON.parse(readFileSync(join(output, name), "utf8"));
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fileHash = async path => { const hash = createHash("sha256"); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest("hex"); };
const inputs = read("inputs.json"); const plan = inputs.plan;
const inputsSha256 = digest(readFileSync(join(output, "inputs.json")));
const settings = JSON.parse(readFileSync(values.settings, "utf8"));
const imagesFor = (condition, split) => inputs.images.filter(image => image.split === split && image.category === condition.category &&
  ["good", condition.label].includes(image.label));
const caseId = (condition, image) => condition.id + "/" + image.id;
const variants = Object.keys(plan.crops).flatMap(crop => ["original", "clear"].map(prompt => ({ id: crop + "-" + prompt, crop, prompt })));
const targetFor = (condition, variant) => variant.prompt === "original" ? condition.originalTarget : condition.clearTarget;
const fresh = name => { if (existsSync(join(output, name))) throw new Error(name + " already exists; frozen experiments cannot be retuned or overwritten"); };
const currentModel = { modelSha256: await fileHash(settings.modelPath), librarySha256: await fileHash(settings.modelLibrary),
  backend: settings.modelDevice, mode: "hybrid", threads: 6, imageMaxSide: plan.imageMaxSide,
  sourceRevision: (await command("git", ["-C", values.source, "rev-parse", "HEAD"])).trim() };
if (values.phase !== "develop") assert.deepEqual(currentModel, read("model.json"), "The frozen model/runtime changed");
const developmentHashes = new Set(inputs.images.filter(image => image.split === "development").map(image => image.originalSha256));
assert.ok(inputs.images.filter(image => image.split === "heldout").every(image => !developmentHashes.has(image.originalSha256)), "Image leakage across splits");

async function nativeSession(profile, action) {
  await assertNativePortAvailable(8002);
  const warmup = resolve(output, inputs.images.find(image => image.split === "development").views.full.file);
  const log = openSync(join(output, values.phase + "-model.log"), "w");
  const child = spawn(settings.python, ["-m", "cn360_model"], { cwd: join(root, "model-service"), windowsHide: true,
    env: { ...nativeEnvironment(settings, warmup, { profile, port: 8002 }), PYTHONPATH: join(root, "model-service") }, stdio: ["ignore", log, log] });
  closeSync(log);
  try {
    const health = await waitForNativeModel("http://127.0.0.1:8002", settings.modelDevice, { child });
    await action(health, child);
  } finally {
    if (child.pid && child.exitCode === null) await command("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
  }
}

async function predict(condition, image, variant, threshold, repetition, bounded = false) {
  // A failed decode restarts the isolated worker. Wait for genuine warm-up so
  // later cases measure the model rather than a cascade of readiness errors.
  await waitForNativeModel("http://127.0.0.1:8002", settings.modelDevice);
  const view = image.views[variant.crop]; const bytes = readFileSync(resolve(output, view.file));
  assert.equal(digest(bytes), view.sha256, "Prepared input changed");
  const target = targetFor(condition, variant); const instruction = buildModelInstruction(target);
  const body = new FormData(); body.append("file", new Blob([bytes], { type: "image/jpeg" }), "frame.jpg"); body.append("prompt", instruction);
  const started = performance.now(); let response; let httpStatus;
  try {
    const result = await fetch("http://127.0.0.1:8002/predict", { method: "POST", body, signal: AbortSignal.timeout(bounded ? 1200 : 125000) });
    httpStatus = result.status; response = await result.json();
  } catch (error) { httpStatus = 0; response = { status: "error", reason: error.name === "TimeoutError" ? "model_timeout" : "model_unreachable" }; }
  const elapsedMs = performance.now() - started;
  const geometryValid = response.status !== "success" || (response.frame_width === view.width && response.frame_height === view.height && response.backend === currentModel.backend);
  const scored = scorePrediction({ id: caseId(condition, image), width: view.width, height: view.height, target, hasDefect: image.hasDefect }, { httpStatus, body: response }, threshold);
  if (!geometryValid) { scored.actual = "error"; scored.reason = "experiment_geometry_or_backend_mismatch"; }
  return { ...scored, conditionId: condition.id, imageId: image.id, split: image.split, variant: variant.id, crop: variant.crop,
    target, instruction, repetition, originalSha256: image.originalSha256, inputSha256: view.sha256, servedFile: view.file,
    width: view.width, height: view.height, threshold, elapsedMs, httpStatus, response,
    error: scored.actual === "error" ? scored.reason : null, geometryValid };
}

function selection() {
  const chosen = read("selection.json");
  assert.equal(chosen.inputsSha256, inputsSha256, "Input protocol changed after selection");
  assert.equal(chosen.developmentSha256, digest(readFileSync(join(output, "development.json"))), "Development evidence changed after selection");
  return chosen;
}

if (values.phase === "develop") {
  fresh("development.json"); fresh("selection.json"); fresh("model.json");
  assert.equal(inputs.planSha256, digest(readFileSync(join(root, "n8n/inspection-experiment.json"))), "Prepared candidate plan differs from the declared plan");
  write("model.json", currentModel);
  await command("powershell.exe", ["-NoProfile", "-File", join(root, "n8n/scripts/stop-software-bench.ps1")]);
  const report = { startedAt: new Date().toISOString(), inputsSha256, samples: [], scope: "Development-only selection; existing previously examined images; unchanged model; diagnostic allowance 120 s" };
  await nativeSession("diagnostic", async health => {
    report.health = health;
    for (const condition of plan.conditions) for (const variant of variants) for (const image of imagesFor(condition, "development")) {
      const row = await predict(condition, image, variant, 0.005, 1); report.samples.push(row); write("development.json", report);
      console.log(`${condition.id} ${variant.id} ${image.label}: ${row.actual}, ${(100 * row.coverage).toFixed(3)}%, ${row.elapsedMs.toFixed(0)} ms`);
    }
  });
  report.finishedAt = new Date().toISOString(); write("development.json", report);
  await command(settings.python, ["-m", "cn360_model.experiment_images", "--score", join(output, "development.json"), "--inputs", join(output, "inputs.json")], { cwd: join(root, "model-service") });
  const measured = read("development.json");
  const rules = plan.conditions.map(condition => {
    const fit = selectCandidate(measured.samples.filter(row => row.conditionId === condition.id));
    const variant = variants.find(candidate => candidate.id === fit.variant);
    const image = imagesFor(condition, "development")[0];
    return { id: condition.id, variant, target: targetFor(condition, variant), instruction: buildModelInstruction(targetFor(condition, variant)),
      preparationProfile: condition.id + "/" + variant.crop, width: image.views[variant.crop].width, height: image.views[variant.crop].height,
      threshold: fit.threshold, development: fit, automaticApproval: false };
  });
  write("selection.json", { lockedAt: new Date().toISOString(), inputsSha256, developmentSha256: digest(readFileSync(join(output, "development.json"))),
    scope: "Settings selected from development images only, before any held-out model request", rules });
  console.log("Selection locked. Held-out images have not been submitted to the model.");
}

if (values.phase === "parity") {
  fresh("parity.json"); selection();
  const development = read("development.json");
  const probes = ["bottle-broken-large", "hazelnut-hole", "capsule-crack"].map(id => development.samples.find(row => row.conditionId === id && row.variant === "full-original" && row.expected === (id === "bottle-broken-large" ? "pass" : "reject")));
  const report = { comparedAt: new Date().toISOString(), scope: "Installed upstream C++ CLI versus checked resident adapter, identical q8/hybrid/input/prompt. Not NVIDIA Python parity.", probes: [] };
  const executable = resolve(settings.modelLibrary, "../upstream-cli/locate-anything-cli.exe");
  for (const probe of probes) {
    const stdout = await command(executable, ["detect", "--model", settings.modelPath, "--input", resolve(output, probe.servedFile),
      "--prompt", probe.instruction, "--mode", "hybrid", "--threads", "6"], { env: { ...process.env, LA_DEVICE: settings.modelDevice,
        Path: resolve(settings.cudaPath, "bin") + ";" + (process.env.Path ?? process.env.PATH ?? "") } });
    const first = stdout.indexOf("{"); const last = stdout.lastIndexOf("}");
    const parsed = JSON.parse(stdout.slice(first, last + 1));
    const reference = parsed.detections.map(row => ({ label: row.label, box: row.box }));
    report.probes.push({ caseId: probe.caseId, inputSha256: probe.inputSha256, instruction: probe.instruction, actual: probe.detections, reference, ...boxParity(probe.detections, reference) });
    write("parity.json", report); console.log(`CLI parity ${probe.caseId}: ${report.probes.at(-1).passed}`);
  }
  report.passed = report.probes.length === 3 && report.probes.every(row => row.passed);
  write("parity.json", report);
}

if (values.phase === "evaluate") {
  fresh("heldout.json"); const chosen = selection();
  const report = { startedAt: new Date().toISOString(), selectionSha256: digest(readFileSync(join(output, "selection.json"))), inputsSha256,
    scope: "Previously unsubmitted held-out originals; frozen settings; baseline once and selected condition three times; diagnostic 120 s, not production qualification", samples: [], baseline: [] };
  await nativeSession("diagnostic", async health => {
    report.health = health;
    for (const condition of plan.conditions) {
      const rule = chosen.rules.find(row => row.id === condition.id);
      for (const image of imagesFor(condition, "heldout")) {
        report.baseline.push(await predict(condition, image, variants.find(row => row.id === "full-original"), 0.005, 1));
        for (let repetition = 1; repetition <= plan.repetitions; repetition++) {
          const row = await predict(condition, image, rule.variant, rule.threshold, repetition); report.samples.push(row);
          write("heldout.json", report); console.log(`${condition.id} heldout ${image.label}/${image.id.slice(-3)} ${repetition}: ${row.actual}, ${row.elapsedMs.toFixed(0)} ms`);
        }
      }
    }
  });
  report.finishedAt = new Date().toISOString(); report.quality = summarizeQuality(report.samples); report.baselineQuality = summarizeQuality(report.baseline);
  report.timing = timingSummary(report.samples.map(row => row.elapsedMs)); write("heldout.json", report);
  await command(settings.python, ["-m", "cn360_model.experiment_images", "--score", join(output, "heldout.json"), "--inputs", join(output, "inputs.json")], { cwd: join(root, "model-service") });
}

async function inputIntegrity() {
  for (const image of inputs.images) for (const view of Object.values(image.views)) {
    if (digest(readFileSync(resolve(output, view.file))) !== view.sha256) return false;
  }
  return true;
}

function assessedRules(production) {
  const chosen = selection(); const heldout = read("heldout.json");
  assert.equal(heldout.selectionSha256, digest(readFileSync(join(output, "selection.json"))), "Selection changed after evaluation");
  assert.equal(heldout.inputsSha256, inputsSha256);
  const parityPassed = read("parity.json").passed === true;
  return chosen.rules.map(rule => {
    const condition = plan.conditions.find(row => row.id === rule.id);
    const rows = heldout.samples.filter(row => row.conditionId === rule.id).map(row => {
      const image = inputs.images.find(image => image.id === row.imageId && image.split === "heldout");
      const view = image?.views[rule.variant.crop];
      const scored = image && view ? scorePrediction({ id: caseId(condition, image), target: rule.target, width: view.width, height: view.height, hasDefect: image.hasDefect },
        { httpStatus: row.httpStatus, body: row.response }, rule.threshold) : { actual: "error", expected: "invalid" };
      return { ...row, ...scored, originalSha256: image?.originalSha256,
        integrityValid: Boolean(image && row.originalSha256 === image.originalSha256 && view && row.crop === rule.variant.crop && row.variant === rule.variant.id &&
          row.inputSha256 === view.sha256 && row.instruction === rule.instruction && row.response?.frame_width === view.width && row.response?.frame_height === view.height &&
          row.response?.backend === currentModel.backend && row.boxesWithinFrame !== false) };
    });
    return { ...rule, ...qualifyCondition(rows, {
      expectedCaseIds: imagesFor(condition, "heldout").map(image => caseId(condition, image)), repetitions: plan.repetitions,
      integrityPassed: rows.every(row => row.integrityValid),
      parityPassed, productionPassed: production?.conditions?.find(row => row.id === rule.id)?.passed }) };
  });
}

function benchCases(rules) {
  return plan.conditions.flatMap(condition => {
    const rule = rules.find(candidate => candidate.id === condition.id);
    return [...imagesFor(condition, "development"), ...imagesFor(condition, "heldout")].map(image => ({
      id: caseId(condition, image), target: rule.target, hasDefect: image.hasDefect, inspectionProfile: rule.preparationProfile,
      ...image.views[rule.variant.crop], originalSha256: image.originalSha256 }));
  });
}

if (values.phase === "production") {
  fresh("production-qualification.json"); const report = { startedAt: new Date().toISOString(), conditions: [],
    scope: "Real native service, n8n public item workflow, actual PC controller, HUD, cloud audit and ThingsBoard. All candidate decisions remain review/reject during qualification. Fail fast per condition." };
  const rules = assessedRules();
  const eligible = rules.filter(rule => rule.qualification.quality && rule.qualification.parity && rule.qualification.integrity);
  report.eligibleConditions = eligible.map(rule => rule.id);
  if (!eligible.length) report.skippedReason = "Every condition failed held-out quality or integrity/parity; no production qualification or automatic approval is allowed";
  if (eligible.length) {
    write("candidate-policy.json", { version: 1, enabled: true, model: currentModel, rules: rules.map(rule => ({ ...rule, automaticApproval: false })) });
    write("bench-cases.json", benchCases(rules));
    write("qualification-settings.local.json", { ...settings, ambient: false, offline: false, experimentRun: output,
      inspectionPolicyFile: join(output, "candidate-policy.json"), initialPictureId: benchCases(rules)[0].id });
    const log = openSync(join(output, "production-workflow.log"), "w");
    const supervisor = spawn(process.execPath, [join(root, "n8n/scripts/software-bench.mjs"), "--config", join(output, "qualification-settings.local.json")],
      { cwd: root, windowsHide: true, stdio: ["ignore", log, log] }); closeSync(log);
    const client = new SoftwareValidationClient(loadValidationConfiguration(root));
    try {
      await waitUntil(async () => {
        if (supervisor.exitCode !== null) throw new Error("Qualification profile exited; inspect production-workflow.log");
        const readiness = await fetch("http://127.0.0.1:5680/healthz/readiness").catch(() => null);
        return readiness?.ok && (await jsonRequest("http://127.0.0.1:8104/model/health")).body.status === "ok";
      }, 250000, "native workflow readiness");
      await client.connect();
      for (const rule of eligible) {
        const condition = plan.conditions.find(row => row.id === rule.id); const result = { id: rule.id, samples: [], passed: false };
        report.conditions.push(result); let failed = false;
        for (const image of imagesFor(condition, "heldout")) {
          for (let repetition = 1; repetition <= plan.repetitions; repetition++) {
            await waitForNativeModel("http://127.0.0.1:8000", settings.modelDevice);
            await waitUntil(async () => (await jsonRequest("http://127.0.0.1:8104/status")).body.admission_ready);
            assert.equal((await jsonRequest("http://127.0.0.1:8104/bench/picture", { id: caseId(condition, image) })).httpStatus, 200);
            const started = performance.now(); const response = await jsonRequest("http://127.0.0.1:8104/bench/item", {});
            const receiptMs = performance.now() - started; const item = response.body.item;
            const telemetry = await client.telemetryFor(item); const visibleAfterMs = performance.now() - started;
            const records = await client.recordsFor(item); const execution = await client.executionFor(item);
            const snapshot = await fetch(records.inspection.frame_url); const snapshotSha256 = digest(Buffer.from(await snapshot.arrayBuffer()));
            const row = { caseId: caseId(condition, image), repetition, expected: image.hasDefect ? "reject" : "pass", receiptMs, visibleAfterMs,
              modelMs: execution.modelMs, response: response.body, execution, telemetry, ...records, snapshotSha256 };
            failed = response.body.inspection.result !== "review" || execution.decision.modelVerdict !== row.expected ||
              execution.modelMs > 1200 || !Number.isFinite(execution.modelMs) || receiptMs >= 3000 || visibleAfterMs > 5000 ||
              execution.control.controlOutcome !== "accepted" || telemetry.review_required !== "true" || records.hud.reviewRequired !== true ||
              execution.decision.promptVerified !== true || snapshotSha256 !== image.views[rule.variant.crop].sha256;
            row.passed = !failed; result.samples.push(row); write("production-qualification.json", report);
            console.log(`${rule.id} bounded workflow: ${row.passed}; model ${row.modelMs} ms, response ${receiptMs.toFixed(0)} ms`);
            if (failed) break;
          }
          if (failed) break;
        }
        result.passed = !failed && result.samples.length === 4 * plan.repetitions;
        write("production-qualification.json", report);
      }
    } finally {
      client.close(); await command("powershell.exe", ["-NoProfile", "-File", join(root, "n8n/scripts/stop-software-bench.ps1")]);
    }
  }
  report.finishedAt = new Date().toISOString(); write("production-qualification.json", report);
}

if (values.phase === "finalize") {
  fresh("policy.json");
  assert.equal(await inputIntegrity(), true, "Prepared image bytes changed");
  const production = existsSync(join(output, "production-qualification.json")) ? read("production-qualification.json") : null;
  const rules = assessedRules(production);
  const policy = { version: 1, enabled: true, assessedAt: new Date().toISOString(), inputsSha256,
    selectionSha256: digest(readFileSync(join(output, "selection.json"))), model: currentModel,
    scope: "Saved-image software only; per-defect conditions, not complete-product or physical approval", rules };
  write("policy.json", policy);
  write("bench-cases.json", benchCases(rules));
  const heldout = read("heldout.json");
  write("summary.json", { assessedAt: policy.assessedAt, scope: policy.scope, unchangedModel: currentModel,
    developmentPredictions: read("development.json").samples.length, heldoutQuality: heldout.quality,
    baselineHeldoutQuality: heldout.baselineQuality, heldoutTiming: heldout.timing,
    automaticConditions: rules.filter(rule => rule.automaticApproval).map(rule => rule.id),
    reviewConditions: rules.filter(rule => !rule.automaticApproval).map(rule => rule.id),
    parity: read("parity.json"), physicalSortingAccepted: false });
  const pictures = benchCases(rules).filter(row => row.id.endsWith("010") || row.id.endsWith("011")).map(row => ({
    id: row.id, target: row.target, width: row.width, height: row.height,
    threshold: rules.find(rule => rule.preparationProfile === row.inspectionProfile)?.threshold,
    profile: row.inspectionProfile, dataUri: "data:image/jpeg;base64," + readFileSync(resolve(output, row.file)).toString("base64") }));
  writeFileSync(join(output, "gallery.html"), validationGallery({ summary: { quality: heldout.quality, criteria: { diagnosticRepetitions: plan.repetitions },
    gates: { quality: rules.every(rule => rule.qualification.quality) ? "passed" : "failed", productionTiming: rules.every(rule => rule.qualification.production) ? "passed" : "unverified" },
    readyForPhysicalIntegration: false }, pictures, samples: heldout.samples,
    coverageDescription: "Each condition uses its development-selected coverage threshold, crop and description. All native boxes are shown; no confidence filtering.",
    scopeDescription: "24 previously unsubmitted held-out original images, shared across 32 image/defect conditions with three repeats each. No held-out tuning. This small test is not a production-accuracy estimate. Every condition currently requires human review." }));
  console.log(JSON.stringify(read("summary.json"), null, 2));
}
