# Issue #26 database acceptance

The original migration PR #28 is reconciled with current n8n behavior. The native
Supabase credential, item identity, post-verdict persistence, inspection RPC and
health-state fixes from main are preserved. No physical hardware is involved.

| Check | Result | Evidence |
| --- | --- | --- |
| n8n unit/contracts, including schema and denial classifiers | 228/228 | [output](unit-tests.log) |
| Real PostgreSQL 17 blank install and legacy upgrade | 11/11 | [report](migration-report.json) |
| Actual hosted Supabase API checks after SQL rollout | 22/22 | [report](hosted-report.json) |
| Strict Python typing | Pass | `supabase/test-migrations.py` |
| Standards / spec review | No remaining findings | Regressions described below |

The operator confirmed execution of the tested `supabase/apply-runtime.sql` in
the existing project's SQL Editor. Hosted checks subsequently verified the new
check constraints reject an invalid pass and invalid frame geometry (`23514`),
and observations retain a null control action with `not_requested`.

The hosted run also confirms the real workflow row builders can insert/read all
four tables; the RPC returns a generated inspection ID and reuses it under five
concurrent retries; five control receipts reference that ID; an unknown parent
ID is refused by the FK (`23503`); and the public snapshot read matches uploaded
JPEG bytes. Anonymous reads/writes/listing/upload are denied using permission
evidence, not by treating any HTTP failure as proof. Run-labelled test rows and
the snapshot are retained for audit, without assuming delete privileges.

The PostgreSQL runner uses a network-isolated disposable container and a blank
public application schema. Supabase-owned roles and Storage catalog tables are
bootstrap fixtures; that test does not claim to emulate Supabase HTTP Storage.
Actual HTTP behavior is verified separately against the hosted project above.
The runner tests repeated application, real row builders, development seed,
concurrent retries, nullable unpaired actions, role/constraint/FK behavior, and
an older schema retaining its rows, IDs, legacy columns and invalid historical
data. `NOT VALID` checks enforce new writes without rewriting old records.

Review caught two acceptance gaps before release: the old schema disallowed
unpaired `action:null`, and an anonymous-write test could fail for missing
timestamp rather than permissions. Both are fixed with regressions. The denial
classifiers reject data-validation errors, invalid keys and service outages as
permission evidence. Canonical tables use coverage, never confidence; legacy
confidence columns are preserved but unused by workflow mappings.

Schema, grants, indexes, FK, snapshot configuration and atomic RPC can now be
rebuilt from the versioned migrations and safe seed. The generated operator
bundle and standalone RPC are held to the migration sources by contract tests.
See [setup and reproduction](../../../../supabase/README.md). #24/#25 physical,
native-model timing and complete-system acceptance remain separate.
