-- CN360 persistence contract: the four tables the n8n workflows write.
--
-- Column names are the contract with n8n/lib/inspection-records.mjs and the
-- PostgREST HTTP nodes in n8n/lib/workflow-definitions.mjs. PostgREST rejects a
-- body key with no matching column, so a rename must land in all three places;
-- n8n/test/schema-contract.test.mjs fails if they drift.
--
-- Vocabulary follows CONTEXT.md. There is deliberately no confidence column:
-- the model hardcodes confidence 0.0, so the pass/reject signal is Defect
-- Coverage against the Coverage Threshold.

-- Inspection Result: one row per Inspection. The id is what PostgREST hands back
-- under `Prefer: return=representation`, and the Control Action is anchored to it.
create table if not exists public.inspection_results (
  id                 bigint generated always as identity primary key,
  inspection_at      timestamptz not null default now(),
  inspection_target  text,
  model_instruction  text,
  -- Frame Context. Null when the capture itself failed, which is a reject.
  camera_session     text check (camera_session is null or char_length(camera_session) > 0),
  frame_sequence     bigint check (frame_sequence is null or frame_sequence >= 0),
  frame_width        integer check (frame_width is null or frame_width > 0),
  frame_height       integer check (frame_height is null or frame_height > 0),
  box_count          integer not null default 0 check (box_count >= 0),
  -- Both null on a fail-closed reject (model timeout, unreadable threshold...).
  defect_coverage    double precision check (defect_coverage is null or defect_coverage between 0 and 1),
  coverage_threshold double precision check (coverage_threshold is null or coverage_threshold between 0 and 1),
  verdict            text not null check (verdict in ('pass', 'reject')),
  prompt_verified    boolean,
  frame_url          text,

  -- The system fails closed: a pass is only ever a readable coverage below a
  -- readable threshold. Anything else reaching the table is a logic fault.
  constraint inspection_results_pass_is_below_threshold check (
    verdict <> 'pass'
    or (
      defect_coverage is not null
      and coverage_threshold is not null
      and defect_coverage < coverage_threshold
    )
  )
);

create index if not exists inspection_results_inspection_at_idx
  on public.inspection_results (inspection_at desc);
create index if not exists inspection_results_verdict_idx
  on public.inspection_results (verdict, inspection_at desc);
-- Not unique: two Inspections may legitimately read the same latest frame
-- outside one Verdict Window. Indexed for tracing a frame across tables.
create index if not exists inspection_results_frame_idx
  on public.inspection_results (camera_session, frame_sequence);

-- Control Action: what was asked of the ESP32 and what it answered.
create table if not exists public.control_actions (
  id                bigint generated always as identity primary key,
  -- Nullable on purpose: if the inspection insert failed, the board still moved,
  -- and losing that record would hide a physical action. Restrict, not cascade:
  -- an audit row must not disappear with its parent.
  inspection_id     bigint references public.inspection_results (id) on delete restrict,
  action            text not null check (action in ('pass', 'reject')),
  esp32_accepted    boolean,
  esp32_status      text,
  esp32_http_status smallint check (esp32_http_status is null or esp32_http_status between 100 and 599),
  esp32_error       text,
  requested_at      timestamptz not null default now(),

  -- One Inspection, one Control Action. Also serves as the FK index.
  constraint control_actions_inspection_id_key unique (inspection_id)
);

create index if not exists control_actions_requested_at_idx
  on public.control_actions (requested_at desc);

-- Prompt History: an audit trail of Inspection Target changes. It is never read
-- to decide what to send; the model server's global prompt is the runtime
-- source of truth.
create table if not exists public.prompt_history (
  id                bigint generated always as identity primary key,
  changed_at        timestamptz not null default now(),
  inspection_target text not null check (char_length(inspection_target) > 0),
  model_instruction text not null check (char_length(model_instruction) > 0),
  source            text not null check (char_length(source) > 0),
  model_http_status smallint check (model_http_status is null or model_http_status between 100 and 599),
  model_error       text
);

create index if not exists prompt_history_changed_at_idx
  on public.prompt_history (changed_at desc);

-- System Logs: inspection outcomes, duplicate suppression, health transitions.
create table if not exists public.system_logs (
  id        bigint generated always as identity primary key,
  logged_at timestamptz not null default now(),
  severity  text not null check (severity in ('info', 'warn', 'error')),
  component text not null check (char_length(component) > 0),
  message   text not null check (char_length(message) > 0),
  details   jsonb
);

create index if not exists system_logs_logged_at_idx
  on public.system_logs (logged_at desc);
create index if not exists system_logs_component_idx
  on public.system_logs (component, logged_at desc);
-- Warnings and errors are what an operator goes looking for.
create index if not exists system_logs_problems_idx
  on public.system_logs (logged_at desc) where severity <> 'info';

-- Only n8n writes these tables, with the service role, which bypasses RLS.
-- RLS with no policies closes them to the anon and authenticated roles, so a
-- key shipped to the HUD could never read or rewrite the audit trail.
alter table public.inspection_results enable row level security;
alter table public.control_actions    enable row level security;
alter table public.prompt_history     enable row level security;
alter table public.system_logs        enable row level security;

revoke all on table
  public.inspection_results,
  public.control_actions,
  public.prompt_history,
  public.system_logs
from anon, authenticated;
