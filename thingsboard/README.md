# CN360 ThingsBoard software integration

ThingsBoard is the local supervisor dashboard. The existing n8n workflow owns
inspection decisions, the ESP32 owns item deadlines, Supabase owns the cloud
audit history, and the Pico HUD owns the image overlay. No machine controls
were added to ThingsBoard.

## What runs

```text
saved image / Pi -> n8n -> vision service -> inspection decision
                                           -> item-bound controller response
                                           -> HTTP inspection response
                                           -> local monitoring journal -> ThingsBoard
                                           -> existing Supabase / relay / Pico path
```

Monitoring runs after the HTTP inspection response, before cloud storage. A
ThingsBoard outage cannot delay the verdict or the webhook response. The local
bridge returns HTTP 202 only after its SQLite transaction commits, then forwards
events asynchronously over the ThingsBoard HTTP telemetry API.

| Service | Local address |
| --- | --- |
| ThingsBoard CE 4.3.1.8 | http://127.0.0.1:9090 |
| Monitoring bridge health | http://127.0.0.1:8106/health |
| Saved-image software test | http://127.0.0.1:8104/ |
| Existing HUD | http://127.0.0.1:8104/hud/ |
| Software-profile n8n | http://localhost:5680 |

The ThingsBoard database has no published host port. ThingsBoard is bound to
this PC's loopback interface. Docker reaches the bridge at
`http://host.docker.internal:8106`. The bridge and existing software test services
are intended for the trusted local development network. No cloud hosting, paid
edition, MQTT broker or extra firmware connection is required.

## Start the offline demonstration

Requirements: Docker Desktop running, Node 24+, Python with Pillow, and the
existing controller host adapter built using
`360ControlUnit/test/host/build-adapter.ps1`. Docker images must be downloaded
once while online. The demo uses the existing `n8n-backup:latest` image; its
presence is a prerequisite of the repository's software profile.

From the repository root:

```powershell
./thingsboard/scripts/start-demo.ps1
```

On first run, the script creates a private database password, initializes a
dedicated Docker Compose project and database volume, provisions the device,
dashboard, alarms and accounts, and starts the bridge. Initialization can take
several minutes. It copies Python configuration from the existing software
profile; alternatively set `CN360_TEST_PYTHON` to a Python executable with
Pillow, or create `thingsboard/software-offline.local.json` from the example.

Wait for `Software test ready` in
`n8n/.runtime/software-bench/supervisor.log`. Open the saved-image test page,
select **Pass example**, **Reject example**, **Model error** or **Model timeout**,
and select **Inspect a test item**. Open ThingsBoard alongside it.

Login details and the exact dashboard link are in ignored
`thingsboard/accounts.local.json`. Use the **viewer** account for viewing and
alarm acknowledgement. The administrator account is for dashboard maintenance.
The dashboard has no configuration or machine-control widgets.

The offline profile uses a saved image, controlled model responses and the real
controller C++ core on the PC. Cloud audit nodes are explicitly disabled and
labelled on both the test page and dashboard. Inspection monitoring remains in
the local journal. It proves software integration and failure handling, not
vision accuracy, actual Supabase delivery, or physical sorting. It preserves
the online runtime configuration and does not require a Supabase credential.

If another software profile is already running, stop it before switching:

```powershell
./n8n/scripts/stop-software-bench.ps1
./thingsboard/scripts/start-demo.ps1
```

To stop the demo and monitoring while retaining all data:

```powershell
./n8n/scripts/stop-software-bench.ps1
./thingsboard/scripts/stop.ps1
```

## Use the existing online software profile

Start only monitoring using `./thingsboard/scripts/start.ps1`. Add
`"telemetryBaseUrl": "http://host.docker.internal:8106"` to the ignored
`n8n/software-bench.local.json`, then start the existing software profile with
`./n8n/scripts/start-software-bench.ps1`. Its actual Supabase Database/Storage,
relay and HUD paths stay enabled. `offline` defaults to false.

For a deployed camera/controller workflow, add the same optional
`telemetryBaseUrl` to `n8n/runtime.local.json`, set `monitoringProfile` to a label
such as `camera-inspection`, and run the normal workflow configurator/import
process. Generated workflow templates keep monitoring disabled until explicitly
configured. Existing installations are not silently activated or rewritten.

Edit `thingsboard/runtime.local.json` to point health probes at the actual
model, Pi, relay and n8n endpoints before changing to physical deployment. The
default probes correspond to the saved-image profile.

## Dashboard and event semantics

- Normal results appear within **5 seconds**, verified against actual
  ThingsBoard reads. Component health is checked every **10 seconds**. A banner
  marks monitoring as stale after **25 seconds** without a bridge heartbeat.
- Coverage is a fraction of frame area, displayed as a percentage. Missing
  coverage displays **Unavailable**, never a fabricated zero.
- Processing time is trigger to controller response (or observation completion),
  excluding cloud writes and dashboard forwarding.
- A forced reject due to model/capture failure increments both reject and
  failure counters. Reject rate includes failure fallback and is labelled.
- Counts represent unique inspections in this local journal, not measured
  physical throughput. Observations and item-bound inspections have separate
  underlying counters. Controller acceptance never confirms physical sorting.
- Physical-item identity is the full controller-session/item pair. Observation
  identity includes workflow, execution ID and request time, so a new n8n
  installation reusing execution IDs does not suppress new observations.
- Repeated delivery reuses the same event timestamp and absolute counters.
  It cannot inflate counts. Same-millisecond events receive distinct storage
  timestamps; their actual inspection time remains in `inspection_at`.
- **Inspection failure** and **Service unavailable** are native ThingsBoard
  alarm rules. The operator can acknowledge alarms. The rules clear alarms
  when a successful inspection or healthy service check arrives. Stale bridge
  data is indicated by the dashboard banner, independently of alarm delivery.

## Recovery and limits

When ThingsBoard is stopped or unreachable, the bridge keeps accepting and
journaling inspection events and retries publication each second. Data and
deduplication identities survive bridge restarts. Counters are transactionally
stored with the pending event. Do not delete `.runtime/events.sqlite` if its
history and counts are needed.

The journal retains delivered events as well. The single-node ThingsBoard
installation uses its in-memory queue to fit this development PC. An HTTP
telemetry acknowledgement is queue acceptance, not proof of a committed
ThingsBoard database write. After an abrupt platform failure or a dashboard
rebuild, replay the retained journal with:

```powershell
node thingsboard/scripts/replay.mjs
```

The original timestamps and counters are reused, so replay is idempotent. Keep
the bridge running to drain replayed events. Back up the journal and the
`cn360-monitoring_postgres-data` Docker volume together for this installation.
No retention policy or deletion is automatic in this prototype.

The bridge itself must be running to journal events. n8n retries delivery three
times with a one-second timeout, after the verdict response. If all attempts
fail, the monitoring request error remains in the n8n execution; the original
inspection/Supabase/HUD path continues. This does not promise lossless capture
while the bridge or its disk is unavailable. Health samples show current status;
offline heartbeat samples are not accumulated into an unbounded backlog.

## Verify

```powershell
npm test --prefix thingsboard
npm test --prefix n8n
node thingsboard/scripts/accept.mjs
```

The acceptance script uses real ThingsBoard, real n8n and the real local bridge.
It substitutes the camera, model, controller, Supabase and relay boundaries with
the repository's explicitly controlled test services. It verifies pass/reject,
model error/timeout, missing-coverage display, the operator's alarm access, a
real ThingsBoard shutdown and restart, replay, counts, and normal visibility
within five seconds. It creates a disposable n8n instance on port 5684 and a
fixture on 8112, then stops them. Logs and reports are under ignored
`thingsboard/.runtime/acceptance/`. The test needs a Python path in the existing
software config or `CN360_TEST_PYTHON`.

Recorded integration evidence is in
[`docs/evidence/thingsboard-software-2026-11-03/README.md`](../docs/evidence/thingsboard-software-2026-11-03/README.md).

Implementation references:
[official Docker installation](https://thingsboard.io/docs/installation/docker/),
[HTTP telemetry and timestamped replay](https://thingsboard.io/docs/reference/http-api/telemetry/),
[alarm rule API implementation](https://github.com/thingsboard/thingsboard/blob/master/application/src/main/java/org/thingsboard/server/controller/AlarmRuleController.java).

## Native LocateAnything profile and measured readiness

The actual q8/CUDA0 model can now run with saved-image selection and the real
controller core on the PC:

```powershell
./n8n/scripts/stop-software-bench.ps1
./thingsboard/scripts/start-native.ps1 -LocateAnythingPath D:\CN360\locate-anything.cpp
```

The launcher validates model paths and genuine model readiness. Select a
labelled picture/target pair at the existing test page; its target is committed
before capture changes. `-Offline` explicitly disables cloud audit; default
online mode verifies the current cloud configuration. Native requests retain
the existing deadline. Startup and worker recovery can take time, and readiness
is reported rather than substituted with a controlled response.

The [3 November native assessment](../docs/evidence/native-model-software-2026-11-03/README.md)
records 45 real diagnostic predictions, three production-budget inspections and
ten cross-service/failure cases. **Quality and production timing failed the
agreed sample-level gates.** The native integration works, but physical
integration remains gated. The dashboard displays this readiness result
separately from its latest Inspection Verdict. The longer diagnostic allowance
does not change or approve production timing.
