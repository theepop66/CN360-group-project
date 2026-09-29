# Spec: n8n Inspection Orchestration Suite

## Problem Statement

The CN360 quality-control system is a set of islands. The Raspberry Pi captures frames, the ESP32 senses items, the Pico 4 HUD accepts operator prompts and draws overlays, and the local vision model can detect open-vocabulary targets — but **nothing connects them**. There is no n8n workflow in the repository at all. Without it, an operator typing `"scratch"` into the HUD sees nothing happen: no frame is ever captured on demand, the model is never asked a question, the ESP32 never receives a verdict, the operator never sees a bounding box, and no inspection is ever recorded.

The gap is not just "missing automation". The original plan assumed a confidence score and a hosted NVIDIA LocateAnything endpoint. Both assumptions are wrong for the system as built, and discovering that late is expensive:

- The model reports **`confidence: 0.0` for every detection**, hardcoded. Any confidence-threshold design is a no-op that silently passes everything.
- The model is a **local, CPU-only, 5.83 GB** process that **reloads the whole model on every request** and takes seconds per image. The ESP32's verdict window is **3000 ms**. The naive design cannot possibly meet it.
- The HUD's detection channel points at `ws://n8n-gateway.local:8081/detections`, a **placeholder**. Stock n8n cannot broadcast to WebSockets at all, so the overlay can never work end-to-end without a bridge that does not exist.
- The Pi's `/capture` returns **frame identity in HTTP response headers** (`X-Camera-Session`, `X-Frame-Sequence`, `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height`), and the HUD's ordering logic depends on that identity. Any orchestration step that drops those headers breaks duplicate suppression and overlay mapping.

Operators need the closed loop to actually close: set a target once, then have every item on the line inspected, sorted, recorded, and drawn — with a hard safety guarantee that an item is never allowed through because the software was slow or broken.

## Solution

Ship a set of importable n8n workflows that close the loop between the four existing components, without modifying any of them.

Three workflows, split by concern so each can be reasoned about and restarted independently:

1. **Inspection loop** — triggered by the ESP32 (an item arrived), manually, or on a schedule. Pulls a frame from the Pi, asks the vision model to locate the operator's target, converts detections into a decision, sends a **fail-safe verdict** to the ESP32, records the result in Supabase, and broadcasts the result to the HUD.
2. **Prompt capture** — triggered when the operator submits a new Inspection Target from the HUD. Translates the operator's short phrase into the model's required instruction, commits it to the model server, and records the change for audit.
3. **Health watchdog** — polls the model server and the Pi on an interval and records degradation, so a stalled model is noticed before it silently rejects a production run.

Three design decisions carry the weight:

- **Replace confidence with Defect Coverage.** Since the model reports no usable score, the pass/reject decision is made on the *fraction of the frame* covered by detection boxes. Every box the model returns is still shown to the operator; the threshold only decides sorting, never visibility.
- **Fail closed, always.** If the model is slow, unreachable, or returns nonsense, the item is rejected — not passed. A quality-control system that fails open when its brain is unavailable is a safety hazard, not a feature. The Verdict Window is the hard deadline, and it is enforced by a timeout well inside it.
- **Never lose frame identity.** Frame context from the Pi's response headers is threaded through the model call, the database write, the control-action record, and the HUD broadcast.

## User Stories

1. As a production operator, I want the line to inspect items automatically as they arrive, so that I do not have to trigger every check by hand.
2. As a production operator, I want to walk up to the Pico 4 HUD and type a new Inspection Target such as `"mold"`, so that the system immediately starts hunting for that defect without a retraining cycle.
3. As a production operator, I want to see bounding boxes drawn on the live video feed, so that I can visually confirm what the camera and the model are looking at.
4. As a production operator, I want the boxes to be drawn at the correct position and size, so that I can trust the overlay corresponds to the real object.
5. As a production operator, I want the overlay to update to the newest frame and never jump backwards, so that I can rely on what I am seeing at any moment.
6. As a production operator, I want good items to pass and defective items to be rejected automatically, so that the line runs without my constant attention.
7. As a production operator, I want defective items pushed onto the reject path, so that they do not reach the customer.
8. As a production operator, I want a broken or slow system to **reject rather than pass**, so that defective items are never let through by accident.
9. As a production operator, I want to know immediately when the vision service is not responding, so that a line stoppage is not a mystery.
10. As a quality engineer, I want every inspection recorded with the target, the model instruction, and the decision, so that I can audit what the line was actually checking.
11. As a quality engineer, I want the captured frame stored alongside each result, so that a disputed verdict can be re-examined after the fact.
12. As a quality engineer, I want to know the Defect Coverage number for each inspection, so that I can see how much of the item the model believes is defective.
13. As a quality engineer, I want to change the Coverage Threshold without editing code or re-importing the workflow, so that tuning is not blocked on a developer.
14. As a quality engineer, I want a history of every Inspection Target change, so that I can reconstruct what the line was looking for at any past moment.
15. As a quality engineer, I want to know when the model answered a **different** question than the one I set, so that a stale-prompt race condition cannot quietly corrupt my results.
16. As a team lead, I want to be able to trigger a one-off inspection by hand, so that I can test the loop end-to-end without feeding the line.
17. As a team lead, I want an ambient periodic inspection, so that a stopped belt or a dead sensor is detected even when no item event arrives.
18. As a team lead, I want each control action recorded with whether the ESP32 accepted it, so that I can tell a software decision apart from a hardware failure.
19. As a team lead, I want the n8n host address to be a single configurable placeholder, so that staging and demo environments do not need code changes.
20. As a team lead, I want database credentials kept out of the committed workflow file, so that secrets are not leaked to the repository.
21. As a team lead, I want the n8n server hostname corrected from an unusable default, so that a fresh install actually boots.
22. As a team lead, I want the workflows committed to the repository, so that the orchestration layer is versioned and reviewable like every other module.
23. As a team lead, I want a setup document listing every placeholder the team must fill in, so that onboarding a new member does not require reverse-engineering JSON.
24. As a team lead, I want a shared glossary of the project's terms, so that "prompt", "target", and "instruction" are not three words for one thing.
25. As a maintainer, I want the model server URL to be a placeholder rather than a bind address, so that the workflow is not wired to `0.0.0.0` and silently broken.
26. As a maintainer, I want the model request to carry the instruction explicitly on every call, so that a mid-flight prompt change cannot cause a wrong-question inspection.
27. As a maintainer, I want the model's own reported prompt echoed back and compared, so that drift between intent and execution is recorded rather than guessed at.
28. As a maintainer, I want the whole loop to be idempotent per item, so that a retried or duplicated event does not double-reject a good item.
29. As a maintainer, I want the verdict sent to the ESP32 before the slow writes happen, so that persistence latency can never cost us the Verdict Window.
30. As a maintainer, I want a dedicated workflow for prompt capture, so that a prompt change is not tangled up with the inspection path and cannot break it.
31. As a maintainer, I want a dedicated watchdog workflow, so that monitoring failures are isolated from inspection failures.
32. As a maintainer, I want every non-happy path to still produce a HUD message, so that the operator sees "reject, reason: model timeout" rather than a frozen overlay.
33. As a maintainer, I want a shared definition of Defect Coverage, so that the verdict logic is testable outside n8n.
34. As a maintainer, I want the model timeout to be a configured value rather than a magic number buried in a node, so that it can be retuned when the model is made faster.
35. As a maintainer, I want a fail-safe branch that works even when the frame capture itself fails, so that a dead Pi still results in a reject rather than a silent pass.
36. As a maintainer, I want the frame snapshot uploaded before the HUD broadcast references it, so that the operator's link to the evidence is never dangling.
37. As a security reviewer, I want the Supabase access token supplied through n8n credentials rather than embedded in expressions, so that the workflow file is safe to commit.
38. As a security reviewer, I want no API keys or tokens anywhere in the committed JSON, so that the repository stays safe to share.
39. As the ESP32 owner, I want a verdict delivered within the Verdict Window in every code path, so that the firmware's auto-pass fallback never fires.
40. As the ESP32 owner, I want a valid `pass`/`reject` action value, so that the firmware's state machine accepts the response.
41. As the ESP32 owner, I want the item event to be handled idempotently, so that a repeated webhook delivery does not physically double-actuate the reject mechanism.
42. As the Pi owner, I want my capture headers forwarded untouched into the payload, so that HUD ordering keeps working across Pi restarts.
43. As the Pi owner, I want to keep pull-based capture rather than push, so that the Pi does not need to know n8n exists.
44. As the HUD owner, I want a payload shape my existing parser accepts without modification, so that the overlay works with zero HUD code changes.
45. As the HUD owner, I want pixel coordinates plus frame dimensions, so that my `object-fit` mapping can scale boxes correctly.
46. As the HUD owner, I want the payload tagged as pixel-space explicitly, so that the parser does not guess and mis-scale.
47. As the HUD owner, I want session and sequence carried in the broadcast, so that stale frames are discarded rather than drawn.
48. As the HUD owner, I want a per-detection status, so that pass and reject frames are visually distinguishable.
49. As the model owner, I want a clear statement that `confidence` is unusable, so that nobody rebuilds a threshold on top of a hardcoded zero.
50. As the model owner, I want the model's answer validated before it is trusted, so that a malformed response cannot become a silent pass.
51. As the model owner, I want the exact instruction template documented, so that grammar stays consistent across team members' experiments.
52. As the model owner, I want a per-detection status, so that pass and reject frames are visually distinguishable.
53. As a reviewer, I want the workflow JSON to be committed without credentials, so that the code is reviewable.
54. As a reviewer, I want the assumed database schema to be flagged as an assumption, so that we do not mistake a guess for a contract.
55. As a reviewer, I want the known model-latency limitation documented in the spec, so that the fail-safe branch reads as a deliberate design choice rather than a bug.

## Implementation Decisions

### Deliverable shape

- Three separate, independently importable n8n workflow definitions are produced, named for the Inspection loop, the Prompt capture workflow, and the Health watchdog workflow. Separation is deliberate: a failure in monitoring or prompt capture must not take the inspection loop offline.
- The n8n layer is the **only** thing that changes. ESP32 firmware, Pi service, HUD, and the vision model are untouched.
- Every environment-specific value (hostnames, ports, tokens, thresholds) is a **named placeholder** in the workflow definitions, documented in a single setup document. Two zero-value fixes ship alongside: the n8n server name advertised in firmware secrets and in the HUD config, both of which currently point at an unresolvable default.

### The Inspection loop

- Three triggers feed one path: the ESP32 item-detected webhook, a manual `inspect-now` webhook, and a schedule trigger for ambient polling. They converge immediately so there is exactly one inspection implementation.
- The workflow **pulls** a frame from the Pi rather than receiving a pushed image. The Pi stays ignorant of n8n, and a dropped push cannot lose an item.
- Frame context is captured from the Pi's **response headers**, not its body: `X-Camera-Session`, `X-Frame-Sequence`, `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height`. Headers are the Pi's documented identity channel; bodies contain only pixels.
- This frame context is carried as a single object through every downstream step, so no branch has to re-derive it.

### Prompt handling

- The **Inspection Target** is the operator's short phrase. The **Model Instruction** is the full sentence handed to the model. They are distinct domain terms and are stored in separate columns.
- The Model Instruction is built by a single canonical template wrapping the Inspection Target, ending with a terminating period: *`Locate all the instances that matches the following description: {target}.`* The exact grammar is part of the contract and must not be paraphrased per-node — trailing punctuation and the "matches" phrasing are load-bearing for model behaviour.
- The target is trimmed and trailing sentence punctuation is stripped before templating, so `mold`, `mold.`, and `mold ` all yield the same instruction.
- **The model server's global prompt is the runtime source of truth.** The database `prompt_history` table is an **audit trail**, not a cache, and is never read to decide what to send.
- The instruction is passed **explicitly on every model call**, not merely set once, so a prompt change mid-inspection cannot cause a wrong-question verdict.
- The model's echoed `prompt_used` is compared against the instruction that was sent. Agreement is recorded as a boolean; disagreement is recorded and surfaced as a warning rather than silently accepted.

### Decision logic: Defect Coverage

- The model reports `confidence: 0.0` for every detection, hardcoded. **Confidence is not a usable signal and is discarded everywhere** — not stored, not broadcast, not thresholded.
- **Defect Coverage** replaces it: the summed area of all returned detection boxes divided by the total frame area, clamped to `[0, 1]`.
  - Box area is `(x2 - x1) * (y2 - y1)` in the model's **pixel** coordinate space.
  - Frame area is `frame_width * frame_height`, taken from the Pi's capture headers.
  - Overlapping boxes are summed as-is. The coverage figure is a *relative* signal — one box overlapping another must not be allowed to push the figure above 1.0, so the clamp is the correctness guarantee, not a cosmetic guard.
- The decision is `reject` when Defect Coverage is **at or above** the Coverage Threshold, otherwise `pass`. The threshold defaults to `0.005` (0.5% of the frame) — a conservative starting point for "this much of the item is suspect", intended to be tuned by the quality engineer.
- **Every box the model returns is sent to the HUD, regardless of the verdict.** The threshold selects which physical path the item takes; it never decides what the operator can see. Suppressing a box because it is "under threshold" would leave the operator looking at an empty overlay on a rejected item.
- Coordinate handling: the model returns pixel coordinates for the uploaded image, which is the same image the Pi captured. The frame dimensions from the Pi headers are therefore the correct denominator **and** the correct overlay scale, with no rescaling step.

### Fail-safe behaviour

- The model call has a **2000 ms timeout**, deliberately inside the ESP32's 3000 ms Verdict Window, leaving headroom for the verdict POST itself.
- **The system fails closed.** A model timeout, connection refusal, non-2xx response, malformed JSON, absent status field, or invalid box geometry all produce `reject` — never a silent `pass`.
- If the **frame capture itself** fails, the workflow still sends `reject`. A dead Pi must not become a pass-through.
- The Verdict Window's 3000 ms auto-pass fallback in firmware is treated as a **bug that this workflow exists to prevent firing**. That is the justification for the fail-safe branch, and it should be read as such.
- Side effects are ordered **verdict → persistence → snapshot → broadcast**. The hardware decision is made first; the slow, non-critical work happens afterwards so persistence latency can never cost the Verdict Window.
- The model server currently reloads a 5.83 GB model per request on CPU and cannot meet 2000 ms. The fail-safe branch is therefore the *expected* path today. The workflow is correct for a fast server; the latency itself is tracked separately and is called out in Further Notes so nobody mistakes it for a workflow bug.

### Persistence

- Supabase is accessed through **PostgREST (HTTP nodes), not the n8n Supabase node**. PostgREST keeps table and column names visible as plain strings in the workflow JSON, so the mapping is reviewable and editable without opening the node's internals. It also avoids depending on a community node's version.
- Four tables are written:
  - **Inspection results** — one row per inspection: timestamp, Inspection Target, Model Instruction, camera session, frame sequence, frame dimensions, box count, Defect Coverage, Coverage Threshold, verdict, prompt-verified flag, frame URL.
  - **Control actions** — one row per verdict sent: which inspection it belongs to, the action, whether the ESP32 accepted it, the HTTP status, and when it was requested.
  - **Prompt history** — one row per Inspection Target change: what changed, the resulting instruction, its source, and the model server's HTTP status.
  - **System logs** — health-watchdog and error-path entries: severity, component, message, details.
- The actual Supabase column names and types are **not known yet**. The mappings are written against a documented **assumed schema** and every assumption is flagged as such in the setup document, so nobody mistakes a guess for a contract. These are the first thing to reconcile when the real schema is available.
- A row written to Inspection results is the anchor: the frame URL and the control action both reference it, so results can be joined back to evidence and to the hardware response.

### Snapshots

- The captured frame is uploaded to Supabase Storage, and the resulting URL is stored on the inspection result.
- The upload happens **after** the verdict and **before** the broadcast, so the URL the operator is given is never dangling.

### HUD broadcast

- The broadcast targets the detection relay, which stock n8n cannot provide. **n8n cannot open or maintain a WebSocket to the HUD**; the workflow POSTs to a relay's HTTP ingest, and the relay fans out to the WebSocket. The relay is a prerequisite owned by a separate issue, not by this work. The exact relay ingest path was proposed as `/detections` and needs confirmation from the relay owner.
- The payload is shaped to be accepted by the HUD's **existing** `parseDetectionPayload` with no HUD changes:
  - `type: "detections"` — distinct from the reserved heartbeat/ping/connected types, which the parser discards.
  - `coordinateSpace: "pixel"` — explicit, so the parser does not infer normalization from coordinate magnitude and mis-scale the overlay.
  - `frame` object carrying `width` and `height` — **required**: the parser throws on pixel-space boxes without positive frame dimensions.
  - `frame.sessionId`, `frame.sequence`, `frame.id`, and a timestamp — the parser's ordering and duplicate-suppression logic depends on these.
  - `detections` array; each entry uses `box` with pixel `[x1, y1, x2, y2]`, plus `label` and `status`. The parser accepts `box` directly.
  - **No `confidence` field.** It is a hardcoded zero and would be a lie in the payload.
- The payload shape is taken from the parser, not invented: the parser's exact key preferences (`detections`/`boxes`, `frame` vs top-level dimensions, `box` vs `bbox`, the reserved `type` values, and the positive-dimensions requirement for pixel boxes) define the contract.
- Non-happy paths broadcast too, so the operator sees *why* an item was rejected rather than a frozen overlay.

### Health watchdog

- Polls the model server's health endpoint and the Pi's capture endpoint on a fixed interval.
- Records state transitions to System logs rather than logging on every poll, so the log stays readable.
- Feeds directly into the Operational Reality check below.

### Operational Reality check

- Before a production run, n8n verifies it can actually reach the model server: a plain `0.0.0.0` is a **bind address, not a connectable target**. Using it in a workflow produces a connection error that looks like a dead server. The setup document states this explicitly and requires a real LAN IP, `127.0.0.1`, or `host.docker.internal` depending on deployment.
- Credentials live in n8n's credential store, referenced by name from the workflow. **No token is committed to the repository.**

## Testing Decisions

### What makes a good test here

Test **external behaviour** — the JSON that crosses a boundary and the decision that boundary produces. Specifically: the shape and content of the Supabase rows, the ESP32 verdict body, and the HUD broadcast payload; plus the pass/reject outcome given a coverage figure. A test that asserts on n8n node internals, node positions, or connection graph structure is an implementation detail and will break on any legitimate refactor — do not write those.

### The seam: decision logic as a pure function

The one seam that carries all the risk is the **decision logic**: frame context + Model Instruction + model response → verdict + rows + broadcast payload. This is where the correctness actually lives — the coordinate math, the clamp, the fail-safe branching, the prompt-drift detection.

That logic is extracted into a **small standalone JavaScript module with no n8n dependency**, and it is the *only* new test seam. The n8n Code nodes that use it are thin wrappers. This is the highest seam available that does not require standing up an n8n instance and a full hardware mock, and it matches how the rest of this project already tests.

Rationale for one seam, not several: the project already has strong, consistent unit-test prior art — `node:test` + `node:assert/strict` with dependency injection (`fetchImpl` in the HUD's prompt module tests). Extending that same pattern keeps the whole JS side of the project on one test runner and one idiom. Spreading coverage across three unrelated harnesses would cost more than it buys.

### What gets tested

**Defect Coverage math (pure, no I/O):**
- a single box covering exactly the Coverage Threshold rejects; just below passes
- the threshold boundary is inclusive at or above
- a full-frame box yields 1.0; overlapping boxes summing past frame area clamp to 1.0 and never exceed it
- zero boxes yields 0.0 and passes
- a zero or negative frame dimension is handled without dividing by zero or returning `NaN`
- degenerate boxes (zero width, zero height, inverted corners) do not inflate coverage

**Fail-safe branching (pure, given a simulated model outcome):**
- timeout → `reject`
- connection error → `reject`
- non-2xx → `reject`
- malformed JSON / missing status → `reject`
- invalid box geometry → `reject`
- frame-capture failure → `reject` (and a verdict is still emitted)
- every fail-safe case still produces a broadcast explaining the reason

**Prompt templating (pure):**
- a bare target yields the exact canonical instruction
- `mold`, `mold.`, and `mold` (trailing space) all yield the identical instruction
- a target containing punctuation is templated without doubling the terminator
- an empty or whitespace-only target is rejected before any model call

**Prompt-drift detection (pure):**
- matching `prompt_used` → verified true
- mismatched `prompt_used` → verified false, and the mismatch is recorded rather than dropped

**HUD payload shape — the highest-value test in the suite:**
- The payload the broadcast step produces is fed straight into the HUD's **real, already-tested `parseDetectionPayload`** and asserted to parse.
- Boxes come back with pixel (not normalized) coordinates, and the returned source dimensions equal the Pi capture dimensions.
- Round-tripping a box through the parser yields the coordinates sent — this is the test that actually proves the overlay will line up.
- The reserved heartbeat/ping/connected types are not used.
- A payload with pixel boxes but missing frame dimensions is impossible by construction.
- `confidence` is absent.
- This closes the loop against a consumer that already exists and already has tests, and it means the payload contract is verified against the parser rather than against our assumptions about it.

**Supabase row shape (pure, snapshot-compared):**
- one inspection row per inspection, containing the target, the instruction, the coverage figure, the threshold, the verdict, and the frame identity
- one control-action row per verdict, carrying the ESP32 accept flag and status
- the frame URL appears on the inspection row, and the control action references the inspection

**Workflow definition sanity (structural, deliberately shallow):**
- each workflow file is valid JSON and parses
- no committed string matches a credential pattern — a direct guard on the "no secrets in the repo" decision
- every placeholder the setup document promises to document actually appears in the workflow files, so the two cannot drift apart

### Prior art

- **HUD (`pico-webapp` and `PICOmyAPP`)**: `node:test` + `node:assert/strict`, dependency injection via `fetchImpl`, `node --test` as the `test` script. The payload-shape test above is modelled directly on the existing prompt tests, and the existing `overlay.test.js` shows the parsing side.
- **Pi service (`raspberry-pi-streaming`)**: pytest with a fake camera injected, and explicit assertions on the `X-Camera-Session` / `X-Frame-Sequence` / `X-Captured-At` / `X-Frame-Width` / `X-Frame-Height` headers. Our tests assert those same five values survive into the payload.
- **ESP32 (`360ControlUnit`)**: host-side C++ tests for the state machine, run by a PowerShell script. The verdict window's 3000 ms figure comes from here.

## Out of Scope

- **The WebSocket relay / gateway.** Stock n8n cannot broadcast to WebSockets, and the bridge that would is owned by a separate issue. This spec defines what n8n sends and where; it does not build the relay. The HUD overlay stays non-functional until that lands.
- **Any change to ESP32 firmware, the Pi service, the HUD, or the vision model.** The workflows adapt to their existing contracts; the contracts are not revised.
- **Fixing the model's latency.** The per-request reload of a 5.83 GB model on CPU is a real problem, and the fail-safe branch is a consequence of it — but making inference fast enough is model-server work.
- **Using model confidence for any decision.** Not a deferral: the value is hardcoded to `0.0` and will not become usable without model changes that are out of scope.
- **Supabase table or column creation.** This spec writes rows against an assumed schema. It does not own the schema, and does not know the real column names yet.
- **Building a dashboard, alerting, or reporting** on the recorded inspection data.
- **Authentication or authorization on the workflows.** Webhooks are assumed to be on a trusted LAN. Adding auth is a separate hardening decision.
- **Committing credentials, secrets, or the resolved n8n server address.** Placeholders only.
- **Tuning the Coverage Threshold to a production-validated value.** The default is a starting point, not a measured one.

## Further Notes

**Supersedes a core assumption in the existing n8n issue.** The open issue for n8n orchestration calls for "confidence-threshold logic" and assumes a hosted NVIDIA LocateAnything API. Both are wrong for the system as built: confidence is a hardcoded `0.0`, and the model is local and CPU-only. Implementing that issue as written would produce a workflow that always passes every item while looking like it was filtering. This spec should replace that requirement, and Defect Coverage is the substitute.

**The fail-safe branch will be the common path until the model is fixed.** The vision server reloads a 5.83 GB model per request and cannot currently meet the 2000 ms timeout. Expect near-total rejection on a production line — which is safe, and is exactly what fail-closed means, but it is a line-stopping condition and should be treated as one. Worth stating plainly: the workflow being correct does not make the system usable until model latency is addressed.

**Frame identity is load-bearing for the HUD.** The Pi's README states it directly: copy the capture headers into the HUD payload "so ordering still works after the Pi process restarts and its sequence resets." Dropping session or sequence silently reintroduces stale-frame flicker, and no test would catch it except the round-trip payload test above.

**The assumed schema is the biggest open risk in the persistence layer.** Every column name here is a guess pending the real schema. Reconcile before the first production run; the workflow JSON is the single place these names live, so the fix is mechanical.

**A note on the n8n host address.** The ESP32 firmware secrets and the HUD config both advertise an n8n hostname that does not resolve. Two zero-value changes fix it. They are one-line edits in member-owned files and are called out rather than made.

## Implementation Notes (from the spec synthesis)

_Published alongside the spec for the implementer; the state of the world at spec time._

- **Tracker setup is incomplete.** `/setup-matt-pocock-skills` was never run for this repository: there is no `.github/` directory, no agent config, no label vocabulary, and no `CONTEXT.md`. The `ready-for-agent` label referenced by this spec's publishing step does not exist. GitHub Issues is the de facto tracker — the `gh` CLI is authenticated, issues are enabled, and nine open issues already follow a consistent `[PRIORITY] Title` convention. Recommend running the setup skill before the next spec is published.
- **The publishing account has read-only access.** The authenticated account has `pull` but not `push` or `admin` on this repository, so the `ready-for-agent` label could not be created and the spec could not be opened as an issue by the agent. The spec is committed to the repository instead; opening the issue requires an account with write access.
- **The n8n target hostname needs correcting in two member-owned files** (ESP32 firmware secrets, HUD config) before any workflow will reach the HUD.
- **Vision model endpoint is `0.0.0.0:8000`** — a bind address. A workflow pointed at it will fail to connect in a way that looks like a server outage.
- **The model server exposes** `POST /predict` (multipart image, optional prompt), `GET /set_prompt`, `GET /get_prompt`, and `GET /health`. Response detections are `{"label", "box": [x1,y1,x2,y2], "confidence"}` in pixel coordinates of the uploaded image.
- **Frame headers confirmed at the source** in the Pi service and its route tests: `X-Camera-Session`, `X-Frame-Sequence`, `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height`.
- **The HUD payload contract was read from the parser, not assumed** — see the `parseDetectionPayload` key preferences and the positive-dimensions requirement for pixel boxes, both reflected in the Implementation Decisions.
