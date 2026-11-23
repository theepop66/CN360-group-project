-- CN360 n8n backend access only. Run in the Supabase SQL Editor.
-- Does not grant access to anon/authenticated or change RLS policies.
-- Schema/column compatibility and Storage bucket setup remain separate.
BEGIN;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT ON TABLE
  public.inspection_results,
  public.control_actions,
  public.prompt_history,
  public.system_logs
TO service_role;

-- Support sequence-generated IDs, if present, only on these four tables.
DO $$
DECLARE
  table_name text;
  sequence_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inspection_results', 'control_actions', 'prompt_history', 'system_logs'
  ] LOOP
    sequence_name := pg_get_serial_sequence(format('public.%I', table_name), 'id');
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE %s TO service_role', sequence_name);
    END IF;
  END LOOP;
END;
$$;
COMMIT;
