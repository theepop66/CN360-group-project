-- Existing deployments may have the original four tables. Add workflow fields
-- before the baseline creates its indexes. Blank projects skip this step.
-- Legacy columns, rows, IDs and foreign keys are preserved.
do $$ begin
if to_regclass('public.inspection_results') is not null then
  alter table public.inspection_results
    add column if not exists inspection_at timestamptz,
    add column if not exists inspection_target text,
    add column if not exists model_instruction text,
    add column if not exists camera_session text,
    add column if not exists frame_sequence bigint,
    add column if not exists frame_width integer,
    add column if not exists frame_height integer,
    add column if not exists box_count integer,
    add column if not exists defect_coverage double precision,
    add column if not exists coverage_threshold double precision,
    add column if not exists verdict text,
    add column if not exists prompt_verified boolean,
    add column if not exists frame_url text,
    add column if not exists controller_session text,
    add column if not exists item_id text;
end if;
if to_regclass('public.control_actions') is not null then
  alter table public.control_actions
    add column if not exists inspection_id bigint,
    add column if not exists action text,
    add column if not exists esp32_accepted boolean,
    add column if not exists esp32_status text,
    add column if not exists esp32_http_status integer,
    add column if not exists esp32_error text,
    add column if not exists requested_at timestamptz,
    add column if not exists controller_session text,
    add column if not exists item_id text,
    add column if not exists control_outcome text,
    add column if not exists control_reason text,
    add column if not exists ack_controller_session text,
    add column if not exists ack_item_id text;
end if;
if to_regclass('public.prompt_history') is not null then
  alter table public.prompt_history
    add column if not exists changed_at timestamptz,
    add column if not exists inspection_target text,
    add column if not exists model_instruction text,
    add column if not exists source text,
    add column if not exists model_http_status integer,
    add column if not exists model_error text;
end if;
if to_regclass('public.system_logs') is not null then
  alter table public.system_logs
    add column if not exists logged_at timestamptz,
    add column if not exists severity text,
    add column if not exists component text,
    add column if not exists message text,
    add column if not exists details jsonb;
end if;
end $$;
