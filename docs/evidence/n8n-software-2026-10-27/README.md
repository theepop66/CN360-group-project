# #17 software integration — 27 October 2026

The n8n software deliverable is complete for isolated runtime testing. Live
installation, actual Supabase compatibility and physical acceptance are pending;
this report does not close GitHub #17, #24 or #25.

## Delivered

- The configurator attaches native `supabaseApi` credential references to all
  seven database/storage HTTP Request nodes across the three workflows.
- Stored-credential exports contain no service key or inline auth headers.
  Invalid references fail configuration; an ID takes precedence over a supplied
  legacy key. The existing environment-key option remains for compatibility.
- The setup example and import guide use stored credentials by default. The
  historical spec's credential-placeholder exception is superseded.
- The real n8n runner imports a fake test credential into a disposable database,
  then publishes only temporary test workflows. Every fixture database/storage
  write requires both `apikey` and `Authorization: Bearer` before any side effect.
- Prompt normalization/failure/blank-input cases check audit behavior as well
  as the public response. The report records the authentication profile and
  checked resource paths without recording keys.

## Verification

| Check | Result |
| --- | --- |
| Full n8n unit/contract suite | 208 passed, 0 failed, 0 skipped |
| Real n8n controlled scenarios | 37 passed, 0 failed |
| Database/storage authentication | 144 requests checked, 0 invalid |
| Credential configuration | All 7 nodes reference the stored credential |
| Negative auth checks | Missing either header returns 401 before writes/uploads |

The runtime cases cover coverage boundaries, bad model/capture responses,
identity-bound events, repeated frames, concurrent requests, storage/database/
relay outages, prompt updates and health transitions. Successful fail-safe cases
can return an inspection error: passing the contract does not mean AI inference
succeeded. The model, capture, controller, database, storage and relay endpoints
in this run are recording fixtures; only n8n is the actual installed software.
HUD payloads are checked with the project's actual parser. No Pico delivery,
physical actuation or production inference latency is claimed.

The runner used Node 24.15.0 and n8n 2.6.4. Image ID, commands and artifact
hashes are in [verification.json](verification.json). Raw artifacts:
[report.json](report.json), [test workflow export](workflows.json),
[n8n log](n8n.log). Credential import files are intentionally excluded. The log copy normalizes
trailing whitespace; the original remains in ignored runtime output.
The log includes test-startup warnings; all recorded case executions completed
successfully. The disposable container was removed after the run.

## Deployment checks still pending

1. Select a reachable Supabase project and verify the actual tables, columns,
   foreign keys and snapshot bucket. Both previously saved project addresses
   failed DNS lookup during the prior runtime investigation. Migration ownership
   remains #26; fixture row tests cannot verify a deployed schema.
2. Provide the actual relay (#7) and service addresses, then generate configured
   inactive workflows using the chosen credential ID. Verify those addresses from
   inside the n8n container before activation.
3. Back up and update the three installed CN360 workflows, preserving their IDs.
   The installed copies were stale, inactive and had placeholders. Their original
   n8n container remains stopped; it also contains an unrelated active workflow,
   so this work does not start it or alter its workflows/credentials.
4. Collect real Supabase/Storage writes and relay/Pico receipt evidence. Keep
   camera deployment deferred while test pictures are used. Hardware timing and
   physical sorting remain #24/#25 work.

Source readiness and runtime acceptance are tracked separately. No live project
was selected arbitrarily, no real service key was exported into this repository,
and no GitHub issue was changed.
