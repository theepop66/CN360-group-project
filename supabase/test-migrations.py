"""Real PostgreSQL tests for blank installs and non-destructive legacy upgrades.

Supabase-owned roles/storage tables are bootstrap fixtures, not a Storage API.
The separate hosted smoke test proves actual HTTP Storage/PostgREST behavior.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time
from typing import Any


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    output = root / "n8n/.runtime/issue26"
    output.mkdir(parents=True, exist_ok=True)
    name = f"cn360-schema-{os.getpid()}"
    results: list[dict[str, Any]] = []

    def command(args: list[str], data: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, input=data, text=True, capture_output=True, check=check)

    def sql(query: str, database: str = "postgres", check: bool = True) -> subprocess.CompletedProcess[str]:
        return command(["docker", "exec", "-i", name, "psql", "-U", "postgres", "-d", database, "-qAt", "-v", "ON_ERROR_STOP=1"], query, check)

    def passed(case: str, **detail: object) -> None:
        results.append({"id": case, "passed": True, **detail})
        print("PASS " + case, flush=True)

    command(["docker", "run", "--rm", "-d", "--name", name, "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"])
    try:
        for _ in range(120):
            if command(["docker", "exec", name, "pg_isready", "-U", "postgres"], check=False).returncode == 0:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Disposable PostgreSQL did not start")
        sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;")
        bootstrap = """
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bucket_id text REFERENCES storage.buckets(id), name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
GRANT ALL ON storage.objects TO anon,authenticated,service_role;
"""
        bundle = (root / "supabase/apply-runtime.sql").read_text(encoding="utf-8")
        sql(bootstrap + bundle)
        sql(bundle)
        assert sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public';").stdout.strip() == "4"
        passed("blank-database-and-repeatable-migrations")
        rows: dict[str, dict[str, Any]] = json.loads(command(["node", str(root / "supabase/test/rows.mjs")]).stdout)

        def insert(table: str, row: dict[str, Any]) -> str:
            columns = ",".join(row)
            body = json.dumps(row).replace("'", "''")
            return f"INSERT INTO public.{table} ({columns}) SELECT {columns} FROM jsonb_populate_record(NULL::public.{table},'{body}'::jsonb) RETURNING id;"

        def rpc(row: dict[str, Any]) -> str:
            return "SELECT id,was_inserted FROM public.cn360_record_inspection('" + json.dumps(row).replace("'", "''") + "'::jsonb);"

        prefix = "SET ROLE service_role;"
        first = sql(prefix + rpc(rows["inspection_results"])).stdout.strip()
        inspection_id = int(first.split("|")[0])
        assert first.endswith("|t")
        for table, row in rows.items():
            if table == "inspection_results":
                continue
            if table == "control_actions":
                row["inspection_id"] = inspection_id
            assert int(sql(prefix + insert(table, row)).stdout.strip()) > 0
            assert sql(prefix + f"SELECT count(*) FROM public.{table};").stdout.strip() == "1"
        passed("actual-row-builders-insert-and-read-all-four-tables")
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            answers = list(pool.map(lambda _: sql(prefix + rpc(rows["inspection_results"])).stdout.strip(), range(5)))
        assert all(answer == f"{inspection_id}|f" for answer in answers)
        for _ in range(4):
            sql(prefix + insert("control_actions", rows["control_actions"]))
        assert sql(prefix + "SELECT count(*) FROM control_actions;").stdout.strip() == "5"
        passed("one-item-one-inspection-with-five-separate-control-receipts")
        invalid = {**rows["inspection_results"], "item_id": "invalid-pass", "defect_coverage": 0.6, "coverage_threshold": 0.5}
        assert sql(prefix + rpc(invalid), check=False).returncode != 0
        invalid["item_id"] = "invalid-geometry"
        invalid.update(verdict="reject", frame_width=-1)
        assert sql(prefix + rpc(invalid), check=False).returncode != 0
        passed("invalid-pass-and-frame-geometry-refused")
        orphan = {**rows["control_actions"], "inspection_id": -1}
        assert sql(prefix + insert("control_actions", orphan), check=False).returncode != 0
        assert sql(f"DELETE FROM inspection_results WHERE id={inspection_id};", check=False).returncode != 0
        passed("foreign-key-and-parent-delete-protection")
        for role in ["anon", "authenticated"]:
            for table in rows:
                assert sql(f"SET ROLE {role}; SELECT * FROM public.{table};", check=False).returncode != 0
            assert sql(f"SET ROLE {role};" + rpc(rows["inspection_results"]), check=False).returncode != 0
        assert sql(prefix + "DELETE FROM system_logs;", check=False).returncode != 0
        passed("public-roles-denied-and-backend-audit-role-append-only")
        sql((root / "supabase/seed.sql").read_text(encoding="utf-8"))
        assert sql("SELECT count(*) FROM inspection_results;").stdout.strip() == "3"
        passed("development-seed-loads-with-real-constraints")
        observations: dict[str, dict[str, Any]] = json.loads(command(["node", str(root / "supabase/test/rows.mjs"), "--observational"]).stdout)
        observed_id = int(sql(prefix + rpc(observations["inspection_results"])).stdout.strip().split("|")[0])
        observations["control_actions"]["inspection_id"] = observed_id
        sql(prefix + insert("control_actions", observations["control_actions"]))
        assert sql(f"SELECT action IS NULL,control_outcome FROM control_actions WHERE inspection_id={observed_id};").stdout.strip() == "t|not_requested"
        passed("unpaired-observations-retain-null-action-without-actuation")
        bucket = sql("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='inspection-snapshots';").stdout.strip()
        assert bucket == "t|5242880|{image/jpeg}"
        sql("INSERT INTO storage.objects(bucket_id,name) VALUES ('inspection-snapshots','test.jpg');")
        assert sql("SET ROLE anon; SELECT count(*) FROM storage.objects;").stdout.strip() == "0"
        assert sql("SET ROLE anon; INSERT INTO storage.objects(bucket_id,name) VALUES ('inspection-snapshots','forbidden.jpg');", check=False).returncode != 0
        passed("public-jpeg-bucket-without-anonymous-object-access-policy")
        sql("CREATE DATABASE legacy;")
        sql(bootstrap + """
CREATE TABLE public.inspection_results(id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), result text, confidence double precision, verdict text, defect_coverage double precision);
CREATE TABLE public.control_actions(id bigserial PRIMARY KEY, inspection_id bigint UNIQUE REFERENCES public.inspection_results(id), action text, response_messege text);
CREATE TABLE public.prompt_history(id bigserial PRIMARY KEY, prompt_text text);
CREATE TABLE public.system_logs(id bigserial PRIMARY KEY, message text);
INSERT INTO inspection_results(result,confidence,verdict,defect_coverage) VALUES ('legacy',0,'pass',3);
INSERT INTO control_actions(inspection_id,action,response_messege) VALUES (1,'pass','legacy receipt');
""", "legacy")
        sql(bundle, "legacy")
        sql(bundle, "legacy")
        assert sql("SELECT result,confidence,defect_coverage FROM inspection_results WHERE id=1;", "legacy").stdout.strip() == "legacy|0|3"
        assert sql("SELECT response_messege FROM control_actions WHERE id=1;", "legacy").stdout.strip() == "legacy receipt"
        passed("legacy-upgrade-preserves-rows-columns-ids-and-historical-invalid-data")
        sql(prefix + insert("control_actions", {**rows["control_actions"], "inspection_id": 1}), "legacy")
        assert sql("SELECT count(*) FROM control_actions WHERE inspection_id=1;", "legacy").stdout.strip() == "2"
        assert sql(prefix + rpc(invalid), "legacy", check=False).returncode != 0
        passed("legacy-upgrade-allows-retry-receipts-and-enforces-new-writes")
    finally:
        command(["docker", "stop", "--timeout", "2", name], check=False)
        (output / "migration-report.json").write_text(json.dumps({"database": "postgres:17-alpine", "scope": "Real SQL; Supabase roles/storage bootstrap only. Hosted smoke proves HTTP APIs separately.", "cases": results}, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()
