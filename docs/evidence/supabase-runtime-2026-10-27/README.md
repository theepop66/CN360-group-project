# Supabase runtime integration — 27 October 2026

Real Supabase database and Storage integration now works through actual n8n.
This is partial #17 runtime evidence: the broader fixture runs still show
intermittent unfinished executions, and real relay/device deployment is pending.
No GitHub issue was edited or closed.

## Completed setup

- The operator saved the backend key locally; it was imported into n8n's
  encrypted credential store. Seven HTTP nodes across the three CN360 workflows
  reference it. No key value is included in the repository or this report.
- The operator applied [backend access grants](applied-access-grants.sql), then
  [36 nullable workflow columns](applied-schema-alignment.sql) via SQL Editor.
  All four table access probes returned HTTP 200 afterward. Existing columns,
  primary/foreign keys, data and RLS policies were preserved. The scripts assume
  the four pre-existing tables; they are not a fresh-project schema migration.
- The [actual schema](actual-schema.json) contains the required workflow fields.
  Actual inserts verified generated IDs and inspection/control relationships.
- Created the public `cn360-test-snapshots` bucket for dataset test pictures,
  accepting JPEG/PNG uploads up to 10 MiB. It is not a camera deployment.
- Updated all three installed CN360 workflows to the current source graphs,
  preserving IDs and keeping them inactive. Their model origin, Supabase
  origin, stored credential, threshold, timeout and test bucket are configured.
  Device/relay origins remain unresolved. The original n8n container stays
  stopped because it also contains an unrelated active automation.
- [Installed verification](installed-verification.json) confirms the source graph
  matches, inactive status, unchanged other workflows and unchanged credentials.

## Verification results

| Profile | Result | Meaning |
| --- | --- | --- |
| Full n8n unit/contract suite | 208/208 passed | Source logic and generated graphs |
| Real n8n + real Supabase | 8/8 passed | Actual DB/Storage integration with fixture devices/model |
| Controlled suite, first run | 37/38 passed | `model-delay-1250` did not finish |
| Controlled suite, repeat | 37/38 passed | `concurrent-5` did not finish |
| 550 ms delayed snapshot case | Passed in both controlled runs | Successful slower upload retains DB/HUD snapshot URL |

The eight live cases comprise pass, reject, model error, prompt update, initial
health, outage, repeated outage without duplicate logs, and recovery. Three
inspection records have corresponding control records and actual snapshot URLs;
downloading each URL returned bytes identical to the served 900 x 900 JPEG.
Prompt History and health transition rows were read back from the actual tables.

Only n8n and Supabase were real in this profile. Capture, model, controller and
relay endpoints were recording fixtures. The normal bottle image was used with
synthetic model responses to verify branches; this is not defect-detection
accuracy evidence. HUD messages were accepted by the real parser, not delivered
to a headset. Controller acknowledgements came from a fixture, not physical
hardware or the C++ controller core. Production inference and timing remain
separate #24/#25 work.

Test rows are retained for inspection. Their controller sessions start with
`cn360-test-1793085580575` (initial failures) or
`cn360-test-1793085749156` (successful live run). They are test records, not
production item results. A separate direct diagnostic JPEG is also retained
in the test bucket. No existing records were deleted or rewritten.

## Upload timeout fix and remaining failures

The initial live run wrote the database rows but produced no snapshot URLs.
The workflow allowed only 300 ms for uploads. A direct 243,330-byte JPEG upload
succeeded in about 532 ms, demonstrating that the allowance was too short for
this cloud path. The snapshot timeout is now 3000 ms. Upload remains after the
verdict attempt and webhook response; controller/model deadlines are unchanged.
The subsequent live run passed all eight cases, including snapshot byte checks.

The initial live run also had one 250 ms controller-fixture acknowledgement
timeout, recorded as `delivery_unknown`. The successful run confirmed matching
acknowledgements. This does not establish physical timing reliability.

Both broader controlled runs are preserved. In the first, the 1250 ms delayed
model case returned `model_timeout`, with control delivery unknown, but never
reached its completion callback. In the repeat, all delayed model cases passed,
but the five-request burst did not reach completion. Its responses included
model timeouts and reject requests. No root cause is asserted from these runs.
The transport/completion behavior needs further investigation before #17 can be
closed; these failures were not hidden by relaxing deadlines or assertions.

## Evidence

- [Successful live report](live-supabase-passed.json) and [n8n log](live-n8n.log)
- [Initial live failures](live-initial-failures.json)
- [First controlled run](controlled-initial-failure.json) and [log](controlled-initial.log)
- [Controlled repeat](controlled-repeat-failure.json) and [log](controlled-repeat.log)
- [Full unit test output](unit-tests.log)
- [Live runner source](live-runner-source.txt): environment-specific reproduction
  script; it reads the backend key locally and never includes its value
- [Verification manifest](verification.json) and [code review](review.md)

Logs normalize trailing whitespace. Original runtime outputs and encrypted n8n
backups remain outside the repository. Credential import files are excluded.

## Remaining for #17

1. Diagnose the unfinished timeout/concurrency executions on this n8n runtime.
2. Supply the actual device/relay addresses, or the agreed test-picture capture
   endpoint while camera deployment remains deferred.
3. Verify delivery through the actual relay and finish the selected deployed
   runtime checks. Physical movement/timing and headset acceptance remain #24/#25.

The live database integration blocker is resolved for the tested project.
Full migration ownership and broader database acceptance under #26 remain
separate from these existing-table compatibility scripts.
