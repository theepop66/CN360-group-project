# CN360 Supabase persistence

Versioned schema, safe development seed and real database/API checks for #26.
The workflow column contract comes from `n8n/lib/inspection-records.mjs`.

## Apply

Run `node supabase/build-migration-bundle.mjs` from the repository root, then
run **all of `supabase/apply-runtime.sql`** in the project's Supabase SQL Editor.
The generated bundle contains migrations in order, with transactions, no seed
and no credentials. It can be rerun. Inspect and back up an existing project
before applying schema changes.

The Supabase CLI files support `supabase start` / `supabase db reset` for a local
project and `supabase link` / `supabase db push` for a hosted project. If an older
version of these migrations is already recorded remotely, inspect migration
history and include the earlier compatibility migration (`--include-all`) when
upgrading. Direct SQL Editor execution does not update the CLI migration ledger.
The CLI stack was not used for the evidence here; the tested SQL runner below
uses PostgreSQL 17, and the hosted smoke test checks actual Supabase APIs.

| Migration | Purpose |
| --- | --- |
| `20261019000000_existing_table_alignment.sql` | Add missing workflow fields to pre-existing tables; skip on a blank database |
| `20261020000000_inspection_schema.sql` | Create the four canonical tables, indexes, FK, RLS and backend table/sequence grants |
| `20261020000100_snapshot_bucket.sql` | Create public `inspection-snapshots`, JPEG only, 5 MiB |
| `20261028000100_runtime_constraints.sql` | Enforce new-write contracts while retaining historical legacy rows and retry receipts |
| `20261028000200_idempotent_inspections.sql` | Atomically reuse a paired item's inspection ID |

Existing legacy columns, including unused confidence fields, are retained.
Fresh canonical tables have no confidence column. Neither workflow decisions nor
new audit mappings use confidence. Compatibility checks use `NOT VALID`: old
rows are preserved, and future inserts/updates must satisfy the checks. They do
not claim that old data was validated or repaired. Mismatched legacy column
types are not silently converted; investigate any migration error.

## Records and access

- Inspection results record target/instruction, frame context, coverage,
  threshold, verdict and optional controller session/item identity. A pass must
  have readable coverage below a threshold, both in [0,1]. Missing-frame rejects
  may have null geometry/coverage. Item IDs remain opaque text.
- Control actions retain individual request receipts. Five racing attempts can
  reference one inspection; `inspection_id` is indexed, **not unique**. Its FK
  prevents deleting the parent while a control receipt exists. If the inspection
  write fails, a receipt may have a null inspection ID.
- Prompt history is an audit trail, never the model's runtime prompt cache.
- System logs record outcomes and health transitions.

RLS is enabled and table privileges are revoked from `anon`/`authenticated`.
The backend role gets SELECT/INSERT and sequence usage, plus EXECUTE on the
inspection RPC. It receives no new table-delete grant. Existing project policies
and unrelated tables are not removed. Configure n8n's native **Supabase API**
credential so both `apikey` and `Authorization` are supplied; see
`n8n/README.md`. Keys stay outside Git and the HUD.

The public bucket allows anyone with an exact snapshot URL to view that image.
The migrations add no anonymous object listing/upload policy. Review existing
project-wide storage policies too. Private snapshots would require coordinated
signed-URL changes in the workflow and HUD, not just flipping the bucket flag.
The existing `cn360-test-snapshots` dataset-test bucket is separate and retained.

## Reproduce checks without hardware

```powershell
python supabase/test-migrations.py
node --test n8n/test/schema-contract.test.mjs
```

The SQL runner uses a disposable, network-isolated PostgreSQL 17 container. It
tests a blank public schema, repeat application, the real workflow row builders,
seed data, FK/coverage/geometry checks, role denial, concurrent RPC retries,
multiple receipts, and a legacy upgrade that preserves invalid historical rows.
Supabase-owned roles and Storage catalog tables are bootstrap fixtures in that
runner; it does not imitate Supabase's HTTP API. Reports go under ignored
`n8n/.runtime/issue26/`.

For actual PostgREST and Storage, use a backend key file outside the repository:

```powershell
node supabase/smoke-test.mjs --url https://PROJECT.supabase.co --key-file C:/private/backend-key.txt
```

Set `SUPABASE_ANON_KEY` locally to enable public-role checks. The runner uses
the actual row builders and inspection RPC, reads all four tables back, checks
the FK and retry receipts, verifies a publicly fetched JPEG byte-for-byte and
checks anonymous table/list/upload denial. It can create the named test bucket
if absent. Use `--bucket` for another bucket with the same migration settings.
Keys are redacted from output. Test rows and the snapshot are **retained**,
labelled by the run ID, so no delete permission is assumed. This is a dev-project
acceptance check, not production traffic.

`seed.sql` contains fictional development examples and is never bundled into a
hosted migration. Its demonstration snapshot URL has no uploaded image; the
hosted smoke test, rather than the seed, proves a working Storage URL.
