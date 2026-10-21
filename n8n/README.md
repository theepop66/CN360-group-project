# CN360 n8n Workflows

Importable n8n workflows that close the inspection loop between the Pi capture
service, the local vision model, the ESP32 actuator and the Pico 4 HUD. Nothing
outside this folder is modified: the workflows adapt to the contracts the other
components already expose.

| File | Workflow | Job |
| :--- | :--- | :--- |
| `workflows/01-inspection-loop.json` | Inspection Loop | Capture a frame, ask the model, decide, tell the ESP32, record, broadcast |
| `workflows/02-prompt-capture.json` | Prompt Capture | Turn an operator's Inspection Target into a Model Instruction and commit it |
| `workflows/03-health-watchdog.json` | Health Watchdog | Report model-server and capture-service outages once per state change |

## Import

1. n8n: **Workflows เน€เธยเธขยเนโฌย Import from File**, import all three JSON files.
2. Leave them **inactive** until the placeholders below are filled.
3. Fill in the placeholders (Ctrl+H in the n8n editor finds them quickly).

## Placeholders

Every environment-specific value is a named placeholder. A test fails if one
goes missing, so this list cannot drift away from the workflows.

| Placeholder | Replace with | Notes |
| :--- | :--- | :--- |
| `REPLACE_MODEL_HOST:8000` | The PC running the model server | **Not `0.0.0.0`** เน€เธยเนยเธเนโฌย that is a bind address, not a connectable target. Use the LAN IP, `127.0.0.1`, or `host.docker.internal` if n8n runs in Docker. |
| `REPLACE_PI_HOST:8000` | The Raspberry Pi | Must be reachable from the n8n host. |
| `REPLACE_ESP32_HOST` | The ESP32 | Its static IP on the line. |
| `REPLACE_RELAY_HOST:8081` | The detection relay | Runs on the n8n machine: `localhost:8081`, or `host.docker.internal:8081` when n8n is in Docker. See [`detection-relay/`](../detection-relay/README.md). |
| `REPLACE_RELAY_INGEST_TOKEN` | The relay ingest token | Empty by default, which leaves the check off. If set, it must equal the relay's `RELAY_INGEST_TOKEN` and use only `A-Z a-z 0-9 . _ ~ -`. |
| `REPLACE_SUPABASE_HOST` | `<project-ref>.supabase.co` | Hostname only; the workflow already includes `https://`. |
| `REPLACE_SUPABASE_SERVICE_ROLE_KEY` | The service-role key | Prefer an n8n HTTP Header Auth credential instead of pasting it here. |
| `REPLACE_SNAPSHOT_BUCKET` | A **public** bucket name | Create the bucket first; the stored `frame_url` points at `/storage/v1/object/public/...`. |
| `REPLACE_COVERAGE_THRESHOLD` | e.g. `0.005` | Or set an n8n variable named `COVERAGE_THRESHOLD`. |
| `REPLACE_MODEL_TIMEOUT_MS` | `1200` | Must fit the Verdict Window budget. The workflow refuses a value it cannot fit rather than trusting it. |

### Secrets and n8n credentials

Supabase is reached with the service-role key as a header placeholder
(`REPLACE_SUPABASE_SERVICE_ROLE_KEY`), not an n8n credential-store reference.
That is a deliberate, documented deviation from the spec: the HTTP Request node
needs *two* headers (`apikey` and `Authorization: Bearer`) and a credential
supplies one, so a naive header-auth credential would half-configure the node.
Replace the placeholder in place, or rework the Supabase nodes onto credentials
together. Do not paste a key into this file.

## The Verdict Window budget

The ESP32 auto-passes 3000 ms after it asks for a verdict, so every stage before
the verdict POST is budgeted and the stages are checked as a whole:

| Stage | Timeout |
| :--- | :--- |
| `fetch-current-prompt` | 250 ms |
| `capture-frame` | 800 ms |
| `upload-snapshot` | 300 ms |
| `detect-defects` | `REPLACE_MODEL_TIMEOUT_MS` (default 1200 ms) |
| `post-verdict` | 250 ms |

That is 2800 ms of work inside the ESP32's 3000 ms Verdict Window.

`verify-verdict-budget` runs before the model call. If the configured model
timeout cannot leave headroom inside the window, the Verdict is forced to
**reject** with reason `invalid_verdict_budget`. The boxes the model returned are
still recorded and drawn; only the physical path is forced.

A model timeout that cannot be read at all (left as the placeholder, zero, or
nonsense) falls back to the shipped 1200 ms default rather than disabling the
check. That substitution is reported as `readable: false` on the budget and lands
in the outcome log, so a deployment that lost its configuration is visible instead
of silent.

`REPLACE_COVERAGE_THRESHOLD` works the same way but with one difference: an
unconfigured placeholder takes the documented **0.5%** default, while a value
that *was* set but cannot be read fails closed with `invalid_threshold`. A
threshold is never guessed at, because it decides pass or reject.

The snapshot upload is **serialised ahead of the model call** rather than fanned
out beside it, and it is paid for in that budget. n8n HTTP nodes do not pass
binary along, so a parallel upload would need a merge to re-join the branches.
Serialising costs 300 ms and cannot hang. The Verdict itself is still sent before
any write.

## Repeat frames

A repeat of the same `camera-session` + `frame-sequence` inside the Verdict
Window still gets a verdict POSTed to the ESP32 เนโฌโ€ only its database record and
HUD broadcast are suppressed, and the suppression is logged to `system_logs` as
`duplicate frame suppressed`.

This is deliberate. The ESP32 auto-passes whatever physically arrived if nothing
arrives within 3000 ms, so *silently dropping* a duplicate event would let that
fallback pass a real item. Re-posting is safe: the firmware's `acceptVerdict`
returns 0 for any verdict once it has left `AwaitVerdict`, so the repeat is
answered `accepted: false, status: "ignored"` and the machinery does not move
twice. The `esp32_status` on the suppression log is the evidence for that.

## Two fixes outside this folder

Both are one-line changes in member-owned files, and until they are made the
HUD cannot reach n8n at all:

- The ESP32 firmware secrets advertise `n8n.local:5678`, which does not resolve.
- The HUD config points at the same unusable host.

## Assumed Supabase schema

**The real column names are not known yet.** These mappings are an assumption.
Reconcile them before the first production run เน€เธยเนยเธเนโฌย the names live in one place
(the `inspection_results` / `control_actions` / `prompt_history` /
`system_logs` HTTP nodes) so the fix is mechanical.

- `inspection_results` เน€เธยเนยเธเนโฌย `inspection_at`, `inspection_target`,
  `model_instruction`, `camera_session`, `frame_sequence`, `frame_width`,
  `frame_height`, `box_count`, `defect_coverage`, `coverage_threshold`,
  `verdict`, `prompt_verified`, `frame_url`
- `control_actions` เน€เธยเนยเธเนโฌย `inspection_id`, `action`, `esp32_accepted`,
  `esp32_status`, `requested_at`
- `prompt_history` เน€เธยเนยเธเนโฌย `changed_at`, `inspection_target`, `model_instruction`,
  `source`, `model_http_status`
- `system_logs` เน€เธยเนยเธเนโฌย `logged_at`, `severity`, `component`, `message`, `details`

## Why there is no confidence threshold

The model returns `confidence: 0.0` for every detection เน€เธยเนยเธเนโฌย it is not a real
score. The original plan's confidence filter would have silently passed every
item while appearing to filter. The pass/reject decision is **Defect Coverage**
instead: the summed area of the returned boxes over the frame area, thresholded
(default 0.5% of the frame).

Every box the model returns is still drawn on the HUD whatever the verdict. The
threshold picks the physical path; it never decides what the operator can see.

## The system fails closed

If the model times out, is unreachable, returns an error status, returns
unrenderable boxes, or the frame capture itself fails, the item is **rejected**.
So is a coverage figure or threshold that cannot be read, and so is a Verdict
Window budget that cannot be honoured. A quality-control line that lets items
through when its brain is unavailable is a safety hazard.

Every failure is classified into a named reason by `classifyModelOutcome` and
recorded in the `system_logs` outcome row, together with the Defect Coverage,
the coverage threshold, the prompt comparison and whether the ESP32 accepted the
verdict. A mid-flight prompt change shows up there as `promptMismatch: true`
rather than being silently applied.

**The model budget is still a deployment constraint.** The legacy model adapter
reloads the q8 weights per request. The project now includes a resident adapter
in `model-service/`, but its measured runtime must still satisfy the 1200 ms
model timeout. A workflow-level forced reject does not fix the ESP32's existing
3000 ms auto-pass fallback; automatic sorting remains dependent on issue #24.

## The HUD overlay relay

Stock n8n cannot broadcast to a WebSocket, so `broadcast-hud` POSTs the HUD
payload to the [detection relay](../detection-relay/README.md) at
`POST /detections`, and the relay fans it out to every HUD connected to
`ws://<n8n machine>:8081/detections`. The relay runs on the same machine as
n8n. The broadcast is fire-and-forget: a relay that is down or slow never
delays or changes a verdict.

The `X-CN360-Relay-Token` header carries `relayIngestToken`. It is empty by
default and the relay ignores it unless `RELAY_INGEST_TOKEN` is set there.

The payload is verified end to end: the tests feed it to the HUD's real
`parseDetectionPayload`, and `detection-relay/test/contract.test.mjs` sends it
through a running relay, asserting a box round-trips to the same pixel
coordinates and frame identity.

## Duplicate suppression, and its limit

The item-detected webhook body carries no item identity, so a redelivery cannot
be deduplicated by content. The loop instead recognises a second verdict for the
same `camera session + frame sequence` within one Verdict Window, using n8n
static data. The duplicate is still sent to the ESP32 โ€” see **Repeat frames**
above โ€” and only its database record and HUD broadcast are suppressed. That
covers webhook redelivery and a schedule/item race on the same frame.

It is **per n8n instance and does not survive a restart**. The ESP32 state
machine remains the real backstop against double actuation.

## Development

```sh
npm test     # 193 tests, no network, no n8n instance required
npm run build  # regenerates workflows/*.json from lib/
```

The decision logic lives in `lib/inspection-logic.mjs` and
`lib/inspection-records.mjs` as plain functions. n8n Code nodes cannot import
from the filesystem, so `build.mjs` inlines them into every Code node. The
workflow tests fail if a committed file stops matching a fresh build, so the
tested logic and the shipped logic cannot drift.

After changing anything in `lib/` or in the graph definitions, run
`npm run build` and commit the regenerated JSON.

## Local resident model and compact results

The project-owned [resident model service](../model-service/README.md) preserves
the Detection/prompt HTTP contract without generating annotated images.
Model URLs now use HTTP to match that service. The inspected local n8n instance
runs in Docker: its model origin is `http://host.docker.internal:8000`.
The model multipart field is **`file`**; the n8n binary property remains `image`.

`POST /webhook/inspect-now` and `POST /webhook/item-detected` use Respond to
Webhook mode. They return a compact result after the verdict POST, before
database writes and relay delivery. Successful evaluation returns
`status: success` with `result: pass` or `result: reject` according to coverage.
Evaluation failures return `status: error`, `result: error`, and `reason`, while
the internal Control Action remains reject. A pass can still have small boxes:
it means below the threshold, not proof that there are no Detections. All boxes
and Frame Context remain available to the record and HUD paths.

This result describes the inspection decision; inspect Control Action records
separately to confirm the ESP32 accepted it. Database or relay failure after the
response does not retrospectively change that inspection result.

Prompt Capture reads the HTTP Webhook `body.prompt` and checks the model's
update status and echoed instruction before reporting success. Blank input is
HTTP 400, and a failed model update is HTTP 502. The response is sent before the
Prompt History write; history still records the attempt on either model branch.

For reproducible local configuration:

1. Copy `runtime.example.json` to `runtime.local.json` and fill the actual Pi,
   ESP32, relay, Supabase origin and snapshot bucket. The model origin example
   already matches Docker Desktop. Leave `relayIngestToken` empty unless the
   relay sets `RELAY_INGEST_TOKEN`. Every URL value is a complete origin; do
   not add a second `https://`.
2. Set `CN360_SUPABASE_SERVICE_ROLE_KEY` only in the local environment.
3. Run `node configure.mjs`. It validates origins and the Verdict Window budget,
   refuses unresolved configuration, and writes inactive exports to the ignored
   `workflows-local/` directory. These exports contain local credentials; use
   the clean `workflows/` files for shared commits.
4. Import the configured exports into n8n after the other service requirements
   are satisfied. Test-mode URLs use `/webhook-test/` and require a listening
   test execution; production `/webhook/` URLs require published active workflows.

`node scripts/runtime-smoke.mjs <fixture-image>` runs the shipped graphs in
disposable containers using the locally available `n8n-backup:latest` image.
Set `CN360_DOCKER` to the Docker executable if it is not on PATH. It exercises
HTTP fixture capture/model/storage/relay/actuator services and prompt updates,
not real hardware. CLI executions replace the manual trigger only in temporary
copies; they are not evidence of a live production webhook or database schema.
It also starts a disposable server with a fresh SQLite database to verify the
real public inspection and prompt webhooks. Only temporary workflow copies are
published in that server; it is stopped and removed after the test. No workflows
are imported into the user's running n8n instance.
