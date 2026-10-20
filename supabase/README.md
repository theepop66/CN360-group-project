# CN360 Supabase schema

The database the n8n workflows write to. Everything the project needs from
Supabase is in this folder, so an empty project can be rebuilt from Git.

| File | What it does |
| :--- | :--- |
| `migrations/20261020000000_inspection_schema.sql` | The four tables, their constraints and indexes, and row-level security |
| `migrations/20261020000100_snapshot_bucket.sql` | The `inspection-snapshots` storage bucket |
| `seed.sql` | Fake development rows. No secrets. |
| `smoke-test.mjs` | Live insert and read check against a real project |
| `config.toml` | Supabase CLI settings for a local stack |

Every migration can be run more than once without failing or changing the result.

## Apply it

Local stack (needs Docker):

```sh
supabase start
supabase db reset      # runs migrations/ and then seed.sql on an empty database
```

Hosted project:

```sh
supabase link --project-ref <project-ref>
supabase db push       # migrations only; the seed is never pushed to a hosted project
```

Without the CLI, paste the migrations into the SQL editor in file-name order.

## Tables

| Table | Written by | One row per |
| :--- | :--- | :--- |
| `inspection_results` | Inspection Loop | Inspection, with its Defect Coverage, Coverage Threshold and Verdict |
| `control_actions` | Inspection Loop | Verdict POSTed to the ESP32, linked to its Inspection |
| `prompt_history` | Prompt Capture | Committed change of Inspection Target. This is an audit trail, not the runtime prompt cache. |
| `system_logs` | All three | Outcome, outage or suppression |

The column names are the keys built in `n8n/lib/inspection-records.mjs`.
`n8n/test/schema-contract.test.mjs` reads these migrations and fails if the two
disagree. If you rename a column, add a new migration and change the builder in
the same change.

There is no confidence column. The model reports `0.0` for every box, so the
decision uses Defect Coverage (see `n8n/README.md`).

The database also enforces the fail-closed rules, so a bug in a workflow cannot
store an impossible row:

- `verdict` and `action` are `pass` or `reject`.
- A `pass` needs a non-null Defect Coverage that is below a non-null Coverage
  Threshold. Both values must be in [0, 1]. A `reject` may have neither,
  which is what a model timeout produces.
- `control_actions.inspection_id` is unique, so each Inspection has at most one
  Control Action. It may be null, because the workflow still records the action
  when the Inspection insert failed.
- An Inspection that has a Control Action cannot be deleted (`on delete restrict`).

## Access

Row-level security is on for all four tables, and there are no policies.
`anon` and `authenticated` have every privilege revoked. Only the service role
can read or write. The service role is used by n8n alone, through the
`CN360 Supabase service role` Custom Auth credential, which sends both `apikey`
and `Authorization` (setup steps are in `n8n/README.md`). The key is never in Git,
in a workflow file or on the HUD.

## Snapshots

`inspection-snapshots` is a **public** bucket. It accepts `image/jpeg` only, up
to 5 MB per file. This is deliberate. The workflow stores
`/storage/v1/object/public/inspection-snapshots/<session>-<sequence>.jpg` as
`frame_url` and sends it to the HUD as `snapshotUrl`. The HUD loads that URL
with no key, and it has no way to hold one safely.

Public means anyone who has a URL can read that one image. Nobody can list the
bucket or write to it without the service role, because `storage.objects` has
no policies. If snapshots ever have to be private, the workflow must create
signed URLs instead and the HUD must accept URLs that expire. Making the bucket
private alone would break every snapshot the HUD shows.

## Smoke test

This needs Node 18 or later and has no dependencies:

```sh
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
SUPABASE_ANON_KEY=<anon key> \
node supabase/smoke-test.mjs
```

`SUPABASE_ANON_KEY` is optional. When it is set, the test also checks that
`anon` cannot read or write.

The smoke test does the following:

1. Uploads a JPEG the way `upload-snapshot` does, then fetches the public URL
   with no key.
2. Inserts an Inspection through `buildInspectionRow` and checks that the
   returned id is present.
3. Inserts a Control Action anchored to that id, then checks that a Control
   Action with an unknown id is refused (`409`, `23503`).
4. Inserts a `prompt_history` row and a `system_logs` row, and reads both back.
5. Deletes everything it created.

Keys are never printed, and any key that appears in the output is replaced
with `<redacted>`, so the output can be pasted into an issue as evidence.
Run it against a dev project or a local stack (`SUPABASE_URL=http://127.0.0.1:54321`).
