# CN360 n8n Workflows

Importable n8n workflows that close the inspection loop between the Pi capture
service, the local vision model, the ESP32 actuator and the Pico 4 HUD. The controller, workflow and resident service share the item-bound contract
defined in [local ticket 07](../.scratch/locate-anything-n8n/issues/07-item-verdict-deadline-safety.md).

| File | Workflow | Job |
| :--- | :--- | :--- |
| `workflows/01-inspection-loop.json` | Inspection Loop | Capture a frame, ask the model, decide, tell the ESP32, record, broadcast |
| `workflows/02-prompt-capture.json` | Prompt Capture | Turn an operator's Inspection Target into a Model Instruction and commit it |
| `workflows/03-health-watchdog.json` | Health Watchdog | Report model-server and capture-service outages once per state change |

## Import

For saved-picture testing with the PC controller and real cloud/relay services,
use the [software integration profile](SOFTWARE-BENCH.md).

1. Create/select an n8n **Supabase API** credential and copy `runtime.example.json`
   to `runtime.local.json`. Fill service origins, bucket and credential ID.
2. Run `node configure.mjs` from this folder. Import the three generated files
   from `workflows-local/` into n8n using **Import from File**.
3. Keep them **inactive** until service connectivity and schema mappings are
   verified. The committed `workflows/` files are templates, not configured imports.

## Placeholders

Every environment-specific value is a named placeholder. A test fails if one
goes missing, so this list cannot drift away from the workflows.

| Placeholder | Replace with | Notes |
| :--- | :--- | :--- |
| `REPLACE_MODEL_HOST:8000` | The PC running the model server | **Not `0.0.0.0`** เน€เธยเนยเธเนโฌย that is a bind address, not a connectable target. Use the LAN IP, `127.0.0.1`, or `host.docker.internal` if n8n runs in Docker. |
| `REPLACE_PI_HOST:8000` | The Raspberry Pi | Must be reachable from the n8n host. |
| `REPLACE_ESP32_HOST` | The ESP32 | Its static IP on the line. |
| `REPLACE_RELAY_HOST:8081` | The detection relay | See "The HUD overlay is not done yet". |
| `REPLACE_SUPABASE_HOST` | `<project-ref>.supabase.co` | Hostname only; the workflow already includes `https://`. |
| `REPLACE_SUPABASE_SERVICE_ROLE_KEY` | Removed by stored-credential configuration | Use the native Supabase API credential below; do not paste a key into the template. |
| `REPLACE_SNAPSHOT_BUCKET` | A **public** bucket name | Create the bucket first; the stored `frame_url` points at `/storage/v1/object/public/...`. |
| `REPLACE_COVERAGE_THRESHOLD` | e.g. `0.005` | Or set an n8n variable named `COVERAGE_THRESHOLD`. |
| `REPLACE_MODEL_TIMEOUT_MS` | `1200` | Must fit the Verdict Window budget. The workflow refuses a value it cannot fit rather than trusting it. |

### Secrets and n8n credentials

Use n8n's built-in **Supabase API** credential. It supplies both `apikey`
and `Authorization: Bearer` on HTTP Request nodes, including Storage uploads.
Create or select a credential in n8n with the project origin and service-role
key, then set `supabaseCredentialId` and optionally `supabaseCredentialName`
in `runtime.local.json`. The credential's project origin must match
`supabaseBaseUrl`. The ID can be read from the credential editor URL; importing
into a different n8n instance requires selecting that instance's credential.

`node configure.mjs` attaches the credential reference to all seven persistence
and snapshot nodes, removes inline authentication headers, and generates
inactive workflows without the key. It leaves `Content-Type`, `Prefer` and
Storage's `x-upsert` headers intact. Credentials stay in n8n's encrypted store.
An invalid credential ID stops configuration; it never falls back to an inline
key. A supplied legacy environment key is ignored when an ID is configured.

For existing automation only, omitting `supabaseCredentialId` retains the legacy
`CN360_SUPABASE_SERVICE_ROLE_KEY` environment option. Those generated exports
contain the key and must stay local. The example configuration uses the stored
credential path. Committed templates still contain inert header placeholders;
configure them before import rather than putting a real key into the templates.

## The Verdict Window budget

The controller rejects at its local 3000 ms expiry. Every stage before the
Verdict POST is budgeted to leave headroom for an evaluated decision:

| Stage | Timeout |
| :--- | :--- |
| `fetch-current-prompt` | 250 ms |
| `capture-frame` | 800 ms |
| `detect-defects` | `REPLACE_MODEL_TIMEOUT_MS` (default 1200 ms) |
| `post-verdict` | 250 ms |

That is 2500 ms of configured work inside the ESP32's 3000 ms Verdict Window.

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

The snapshot upload runs **after the Verdict attempt and webhook response**.
`restore-snapshot` explicitly retrieves the binary from `read-frame-context`;
HTTP result nodes cannot substitute the saved capture. Upload has its own
3000 ms timeout and storage failure cannot delay inference or physical dispatch.
Configured sums do not prove elapsed-time or physical acceptance.

## Item identity and repeat frames

An automatic `item-detected` event must carry opaque string fields
`controller_session`, `item_id`, and the integer `verdict_window_ms` (3000 in
this prototype). Missing, malformed or partial identity returns HTTP 400 before
capture/inference. Keep the controller-issued values throughout the workflow.
The Verdict body is `{action, controller_session, item_id}`.

An unpaired `inspect-now` or scheduled request evaluates the image without a
physical command. A paired manual request uses the original active item/window;
it cannot restart that window. The controller checks identity and expiry on
receipt even when its timer task has not yet processed expiry.

Duplicate audit suppression uses the physical item pair for paired requests;
different physical items sharing a frame remain distinct. Observational image
checks retain Frame Context deduplication. Paired retries still reach the
controller, which independently prevents repeated actuation. Suppression is
logged with item identity and control outcome.

The webhook includes `item` and `control` beside its evaluation `status/result`.
`controlOutcome` is `accepted`, `ignored`, `delivery_unknown`, or `not_requested`.
Acceptance requires a successful HTTP response with a boolean `accepted` and
matching echoed session/item. An old reply containing only `accepted: true`
cannot confirm control. A successful evaluated pass may have ignored or unknown
control delivery; do not present it as confirmed physical passing.

## Two fixes outside this folder

Both are one-line changes in member-owned files, and until they are made the
HUD cannot reach n8n at all:

- The ESP32 firmware secrets advertise `n8n.local:5678`, which does not resolve.
- The HUD config points at the same unusable host.

## Required Supabase schema

These mappings were initially assumptions. On 27 October 2026 the selected
project's four existing tables were inspected, missing nullable fields were
added, and actual n8n writes were verified. The migration preserves legacy
columns and existing primary/foreign keys. Other deployments must reconcile
the mappings against their own schema before activation; the SQL does not
create a complete database from scratch.

The applied access/schema SQL and live verification are in the
[Supabase runtime report](../docs/evidence/supabase-runtime-2026-10-27/README.md).
Apply [002-idempotent-inspections.sql](sql/002-idempotent-inspections.sql) after
that compatibility migration. Inspection inserts now call
`/rest/v1/rpc/cn360_record_inspection`; the backend role requires execute access
to this function as well as the existing table/sequence access.
The required workflow fields are:

- `inspection_results` เน€เธยเนยเธเนโฌย `inspection_at`, `inspection_target`,
  `model_instruction`, `camera_session`, `frame_sequence`, `frame_width`,
  `frame_height`, `box_count`, `defect_coverage`, `coverage_threshold`,
  `verdict`, `prompt_verified`, `frame_url`, `controller_session`, `item_id`
- `control_actions` เน€เธยเนยเธเนโฌย `inspection_id`, `action`, `esp32_accepted`,
  `esp32_status`, `esp32_http_status`, `esp32_error`, `requested_at`,
  `controller_session`, `item_id`, `control_outcome`, `control_reason`,
  `ack_controller_session`, `ack_item_id`
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
unrenderable boxes, or capture fails, the workflow requests **reject** for a
paired physical item. The controller independently rejects on local expiry.
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
model timeout. The revised controller prevents timeout auto-pass and stale-item commands.
Automatic sorting still requires measured production timing and a demonstrated
physical reject/hold arrangement; the default firmware disables admission.

## HUD delivery

Stock n8n cannot broadcast to a WebSocket, so the workflow POSTs to a relay's
HTTP ingest (`/detections`) and that relay fans out to
the configured relay's WebSocket `/detections`. The
[detection relay](../detection-relay/README.md) supplies this bridge and is
included in the software test profile. Hardware HUD configuration still needs
the reachable host address rather than the old placeholder.

The payload itself is verified: the tests feed it to the HUD's real
`parseDetectionPayload` and assert a box round-trips to the same pixel
coordinates. The software acceptance additionally observes real relay messages;
physical Pico acceptance remains separate.

## Duplicate suppression, and its limit

Paired inspections suppress duplicate records by controller session and item ID;
observational inspections use camera session and frame sequence. A repeated
paired event still reaches the controller, whose identity/deadline checks prevent
repeated actuation. A duplicate audit row retains the original item context.

The fast workflow cache is per n8n instance. Durable paired inspection ownership
is enforced by `cn360_record_inspection` in PostgreSQL, serializing concurrent
callers for the same full item pair and returning the original inspection ID.
Racing attempts retain their own control receipts against that ID while only the
inserting execution broadcasts the HUD result. Historical duplicates are not
rewritten. Observational checks retain the workflow cache behavior.
The controller remains the backstop against double actuation.

## Development

```sh
npm test     # unit/contract tests; no running n8n instance required
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

### Still-picture acceptance tests

The camera can be substituted without changing the normal pull-ingestion
workflow. See [the test plan](../docs/testing/static-image-inspection-test-plan.md).
The test runner starts a separate, disposable n8n container and HTTP capture,
storage, database, relay and verdict recorders. It never sends real actuator
commands or modifies the existing n8n instance at port 5678. Docker must be
running, and the configured test image must already be installed locally.

From the repository root, with a Python interpreter containing Pillow:

```powershell
node n8n/scripts/static-inspection.mjs --python <python-executable>
```

This runs controlled webhook tests, including exact coverage boundaries,
multipart upload, prompt updates, failure cases, duplicates, concurrent triggers
and health transitions. It uses the current repository workflows. Optional
`--workflow-export <json-file>` records a read-only inventory/hash of the
existing CN360 workflows and highlights older response/prompt contracts; it
does not import or activate that export. Keep original exports local since
they may contain credentials.

Defaults are fixture port 8102 and isolated n8n port 5682. Use `--fixture-port`
and `--n8n-port` for independent simultaneous runs. Use `--output` for a fresh
evidence directory; the default is ignored under `n8n/.runtime/`. Existing
dated evidence files are never overwritten by default. `--docker` and `--image`
select the executable and installed n8n image. Runtime callback completion is
followed by checking actual execution completion in the owned SQLite database.

For the already-installed resident model, run the managed evaluation with its
Python environment and explicit local library/weight paths:

```powershell
<model-python> n8n/scripts/model-inspection-run.py --library <native-library> --weights <gguf-file> --cuda-root <cuda-directory> --output <fresh-evidence-directory>
```

It measures first predictions after three separate starts with the 1100 ms
service deadline. When those fail, it labels production warm testing as blocked
and uses a separate 120-second diagnostic service to assess detection. n8n's
1200 ms HTTP timeout is unchanged. The diagnostic profile cannot approve the
production model deadline. Direct-model PNG/JPEG comparisons precede 150
sequential n8n attempts (15 picture/target cases, 10 repetitions each). Errors
and timeout observations remain in the report; successful-only percentiles are
explicitly labelled. Port 8002 must be free; only model processes started by
the command are stopped. A startup limit can be set with `--startup-timeout`;
this does not alter inference deadlines.

The diagnostic proxy drains a late upstream response after n8n expires, so its
warm repetitions do not measure the production service's disconnect/restart
behavior. Real-model bursts of two and five requests additionally check the
observable `model_busy` response. Concurrent-burst timings are kept separate
from sequential percentiles.

Original picture dimensions are preserved by default. `--max-side 448` selects
an explicit resized comparison profile and records served/original geometry
and image hashes. That profile evaluates served JPEGs directly before n8n;
it does not claim to measure the original-resolution pictures. For a model
service managed elsewhere, use the Node runner's `--mode real --model-url`
options (or `--mode diagnostic` for an intentionally relaxed service).

The actual controller state machine has a separate virtual-time acceptance probe:

```powershell
powershell -NoProfile -File n8n/scripts/run-controller-probe.ps1
```

Exit 1 means a desired timeout/stale-verdict requirement failed; compiler failure
is reported separately. It does not change or flash firmware. The probe reports
2900/3000/3100 ms boundaries and stale pass/reject verdicts for A during B.

Package a visual result report after a run:

```powershell
<python-executable> n8n/scripts/summarize-inspection.py --fixtures <controlled-report.json> --model <managed-output-directory> --controller <controller-result.json> --output <report-directory>
```

The HTML contains model-box/ground-truth review overlays and descriptive
bounding-rectangle IoU. A box around a whole product is not proof of correct
defect localization. Contract assertions passing while an inspection returns
`error` means fail-safe handling worked, not that AI evaluation succeeded.
Real Supabase, relay/Pico, sensor and physical-action acceptance remain separate.

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
   already matches Docker Desktop. Every URL value is a complete origin; do
   not add a second `https://`.
2. Create/select the n8n Supabase API credential and fill its ID in the local
   configuration (see above). Keep the service key inside n8n credentials.
3. Run `node configure.mjs`. It validates origins and the Verdict Window budget,
   refuses unresolved configuration, and writes inactive exports to the ignored
   `workflows-local/` directory. Stored-credential exports contain a reference,
   not the key; keep environment-specific exports local.
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

## Ticket 07 integrated picture tests

Build the host adapter from the repository root, then run the disposable n8n suite:

```powershell
./360ControlUnit/test/host/build-adapter.ps1
node n8n/scripts/item-deadline-inspection.mjs --python <python-with-Pillow>
```

The suite executes the actual controller core via a thin HTTP fixture adapter.
It covers timely pass/reject, exact expiry before a timer tick, old item/session,
duplicates, same-frame/different-item records, observational and paired manual
requests, invalid input, storage failure, model failure and missing/legacy replies.
Its controller clock is virtual; its timing is not sensor/servo bench evidence.
Default output is ignored under `n8n/.runtime/item-deadline/`.

`--real-model-url http://127.0.0.1:8002` also runs production-profile requests
against a separately owned ready service, propagating client disconnects to that
service. Diagnostic late-response draining remains explicitly separate.
The installed localhost:5678 workflows are not changed by these tests.

Coordinate the new nullable identity/outcome columns with persistence issue #26.
Fixture row checks do not establish an applied real database migration. Firmware
and workflows must be updated together: action-only clients and unverified old
acknowledgements fail closed. See [the controller guide](../360ControlUnit/README.md)
for disabled-by-default admission and the physical bench gate.

## Software integration evidence for #17

Run all three workflows through real n8n with a stored, fake Supabase credential:

```powershell
node n8n/scripts/static-inspection.mjs --mode fixtures --credential-store --python <python-with-Pillow>
```

Run from the repository root with Docker Desktop running. This uses a disposable
n8n database on port 5682 and a recording HTTP fixture on port 8102, publishes
only temporary test workflows, and removes its container afterward. It verifies
both authentication headers on every database/storage write, prompt audits,
health transitions, inspection records, snapshots and HUD payloads. The report
records the authentication profile, checked request count and resource paths.
No live service credentials or original n8n workflows are used.

See [27 October software integration evidence](../docs/evidence/n8n-software-2026-10-27/README.md)
for the result and the live deployment checks still pending. The relay (#7) and
schema migration (#26) remain external dependencies. These fixture checks cannot
establish actual Supabase schema compatibility or delivery to a Pico headset.

## Live Supabase verification — 27 October 2026

The selected project's backend credential is stored in n8n. All three installed
CN360 workflows now use the current repository graphs and the configured test
snapshot bucket, retaining their original workflow IDs and remaining inactive.
Unrelated workflows and credentials were preserved. Device/relay origins still
need configuration; this does not activate a line.

A separate disposable n8n instance verified real inspection/control foreign keys,
prompt history, health transitions, and public snapshot URLs with byte-for-byte
image checks. Capture, inference, controller and relay endpoints were fixtures;
no production-model latency, physical sorting or Pico delivery is implied. The
public `cn360-test-snapshots` bucket is for the dataset test pictures.

Cloud snapshots now have a separate 3000 ms upload timeout after the control
attempt and webhook response. The 300 ms timeout failed real uploads; a direct
243 KB diagnostic upload took about 532 ms. Model/controller deadlines are
unchanged. The controlled suite includes a 550 ms upload regression case.
See the [live evidence](../docs/evidence/supabase-runtime-2026-10-27/README.md)
for both initial failures and subsequent results. Real relay/Pico integration
and device configuration remain pending for #17/#25.
