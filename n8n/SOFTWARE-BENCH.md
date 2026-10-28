# Saved-picture software integration

This profile connects real n8n, the actual controller C++ core running on the PC,
Supabase Database/Storage, the HTTP/WebSocket relay, and the existing browser HUD.
Saved pictures replace the camera. The default model responses are **controlled
test responses**, visibly labelled in the page; they prove orchestration and
failure handling, not AI accuracy or physical sorting.

## Prepare and start

1. Install Node 22+, Docker Desktop, a Python environment with Pillow, and the
   compiler required by `360ControlUnit/test/host/build-adapter.ps1`.
2. Run `npm ci --prefix detection-relay` and build the controller adapter with
   `360ControlUnit/test/host/build-adapter.ps1`.
3. Configure ignored `n8n/runtime.local.json` from `runtime.example.json`, with
   the Supabase origin, backend credential ID/name and public test snapshot
   bucket. Preserve the existing-table fields documented in `README.md`, then
   apply `sql/002-idempotent-inspections.sql`. This function preserves historical
   rows and atomically reuses the inspection ID for a repeated physical item.
4. Copy `software-bench.example.json` to ignored `software-bench.local.json`.
   Set Python and a backend-key file **outside the repository**. Never use a
   publishable key for these backend writes. Never commit the key or local config.
5. From the repository root, run `n8n/scripts/start-software-bench.ps1`.
   Wait for `Software test ready` in `.runtime/software-bench/supervisor.log`.

Open <http://127.0.0.1:8104/> to select a controlled response and inspect an item.
Open <http://127.0.0.1:8104/hud/> to see the saved picture and live overlay.
The dedicated n8n editor/webhooks use <http://localhost:5680/>; a new volume may
require the owner to complete editor account setup. Webhooks work independently.

The supervisor publishes exactly the three CN360 workflows after unpublishing
other workflows **in its dedicated copy**. It waits for all three webhook/workflow
registrations, rather than trusting the early HTTP readiness response alone.
The original n8n container and `n8n_data` are left alone. Test runtime state uses
`cn360-software-n8n` / `cn360_software_n8n_data` and is preserved across restarts.
Temporary plaintext credential import is outside the repository and is redacted
after import. The resulting n8n credential store is encrypted by n8n.

The relay listens on 8081; picture/controller transport uses 8104; the explicitly
controlled model uses 8105. Docker reaches the host with `host.docker.internal`.
These are development services for a trusted local network, not a deployment
with public access. Ambient inspection is opt-in; health polling remains enabled.

Stop only this profile with `n8n/scripts/stop-software-bench.ps1`. It checks the
owned container/volume and process command line, retaining data and the original
installation. Logs, generated imports and process identities are under `.runtime/`.

## Verify

After startup completes, run `node n8n/scripts/accept-software-bench.mjs`.
It writes a dated report under `.runtime/issue17-acceptance/` and checks actual
cloud rows, snapshot bytes, controller counters and relay deliveries. Run it
separately from the isolated stress suite to avoid competing test runtimes.

The isolated fault/stress suite uses real disposable n8n with recording service
boundaries, and never proves cloud or hardware delivery:

```powershell
node n8n/scripts/static-inspection.mjs --mode fixtures --credential-store --stress-rounds 10 --python C:/path/to/python.exe
```

`python n8n/scripts/test-idempotency.py` checks the SQL function against a
disposable PostgreSQL 17 container, including 20 concurrent callers, rollback,
legacy duplicate preservation, permissions and distinct observations.

Only test completion observers retry HTTP delivery. Their receiver deduplicates
execution ID plus completion kind so an observer retry cannot substitute for a
missing execution. Control/model requests retain their original bounded policy.
Health transition state advances only after a confirmed log insert. An uncertain
write is retried on a later poll and can yield an extra log if the original write
committed but its acknowledgement was lost; transitions are not silently dropped.

## Actual AI results

See the [fresh native-model gallery](../docs/evidence/real-model-gallery-2026-10-28/README.md).
It overlays actual returned boxes against dataset defect-mask rectangles.
Those diagnostic predictions show false positives and a missed defect; model
accuracy is not accepted. The longer diagnostic timeout does not approve the
production deadline. Native-model execution can be selected with
`modelProfile: "native"` and local `modelLibrary`, `modelPath`, `cudaPath` and
`modelDevice` settings, but successful warm-up and deadline compliance must be
measured independently before use.

The relay source was incorporated from `origin/add/issue-7` at `e0a193e`
(including `1a91a27` and `a119d85`). Its inclusion supports #17 integration;
it does not change the status of #7. Physical timing/late verdict proof (#24),
Pico/line acceptance and model quality (#25) remain separate acceptance work.
