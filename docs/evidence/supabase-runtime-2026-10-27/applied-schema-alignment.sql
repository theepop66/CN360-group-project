-- CN360 n8n schema alignment. Run in the Supabase SQL Editor.
-- Adds nullable fields used by the current workflows.
-- Preserves existing rows, legacy columns, primary/foreign keys and RLS policies.
-- No bucket or public-access policy is created by this script.
BEGIN;

ALTER TABLE public.inspection_results
  ADD COLUMN IF NOT EXISTS inspection_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_target text,
  ADD COLUMN IF NOT EXISTS model_instruction text,
  ADD COLUMN IF NOT EXISTS camera_session text,
  ADD COLUMN IF NOT EXISTS frame_sequence bigint,
  ADD COLUMN IF NOT EXISTS frame_width integer,
  ADD COLUMN IF NOT EXISTS frame_height integer,
  ADD COLUMN IF NOT EXISTS box_count integer,
  ADD COLUMN IF NOT EXISTS defect_coverage double precision,
  ADD COLUMN IF NOT EXISTS coverage_threshold double precision,
  ADD COLUMN IF NOT EXISTS verdict text,
  ADD COLUMN IF NOT EXISTS prompt_verified boolean,
  ADD COLUMN IF NOT EXISTS frame_url text,
  ADD COLUMN IF NOT EXISTS controller_session text,
  ADD COLUMN IF NOT EXISTS item_id text;

ALTER TABLE public.control_actions
  ADD COLUMN IF NOT EXISTS esp32_accepted boolean,
  ADD COLUMN IF NOT EXISTS esp32_status text,
  ADD COLUMN IF NOT EXISTS esp32_http_status integer,
  ADD COLUMN IF NOT EXISTS esp32_error text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS controller_session text,
  ADD COLUMN IF NOT EXISTS item_id text,
  ADD COLUMN IF NOT EXISTS control_outcome text,
  ADD COLUMN IF NOT EXISTS control_reason text,
  ADD COLUMN IF NOT EXISTS ack_controller_session text,
  ADD COLUMN IF NOT EXISTS ack_item_id text;

ALTER TABLE public.prompt_history
  ADD COLUMN IF NOT EXISTS changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_target text,
  ADD COLUMN IF NOT EXISTS model_instruction text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS model_http_status integer,
  ADD COLUMN IF NOT EXISTS model_error text;

ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS logged_at timestamptz,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS component text,
  ADD COLUMN IF NOT EXISTS details jsonb;

GRANT SELECT, INSERT ON TABLE public.inspection_results, public.control_actions,
  public.prompt_history, public.system_logs TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
