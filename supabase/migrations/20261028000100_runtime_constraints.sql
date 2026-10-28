-- New writes obey the current contract; NOT VALID preserves legacy rows without
-- pretending historical data was validated. Do not delete or rewrite history.
alter table public.control_actions drop constraint if exists control_actions_inspection_id_key;
alter table public.control_actions alter column action drop not null;
do $$ begin
if not exists (select 1 from pg_constraint where conrelid='public.inspection_results'::regclass and conname='cn360_inspection_contract') then
  alter table public.inspection_results add constraint cn360_inspection_contract check (
    (frame_sequence is null or frame_sequence >= 0) and
    (frame_width is null or frame_width > 0) and
    (frame_height is null or frame_height > 0) and
    (box_count is null or box_count >= 0) and
    (defect_coverage is null or defect_coverage between 0 and 1) and
    (coverage_threshold is null or coverage_threshold between 0 and 1) and
    (verdict is null or verdict in ('pass','reject')) and
    (verdict is distinct from 'pass' or (defect_coverage is not null and coverage_threshold is not null and defect_coverage < coverage_threshold)) and
    ((controller_session is null and item_id is null) or
     (controller_session is not null and item_id is not null and controller_session ~ '^[A-Za-z0-9_-]{1,64}$' and item_id ~ '^[A-Za-z0-9_-]{1,64}$'))
  ) not valid;
end if;
if not exists (select 1 from pg_constraint where conrelid='public.control_actions'::regclass and conname='cn360_control_contract') then
  alter table public.control_actions add constraint cn360_control_contract check (
    (action is null or action in ('pass','reject')) and
    (esp32_http_status is null or esp32_http_status between 100 and 599) and
    (control_outcome is null or control_outcome in ('accepted','ignored','delivery_unknown','not_requested'))
  ) not valid;
end if;
if not exists (select 1 from pg_constraint where conrelid='public.control_actions'::regclass and contype='f'
    and confrelid='public.inspection_results'::regclass
    and conkey=array[(select attnum from pg_attribute where attrelid='public.control_actions'::regclass and attname='inspection_id')]::smallint[]) then
  alter table public.control_actions add constraint cn360_control_inspection_fk foreign key (inspection_id)
    references public.inspection_results(id) on delete restrict not valid;
end if;
if not exists (select 1 from pg_constraint where conrelid='public.system_logs'::regclass and conname='cn360_log_severity') then
  alter table public.system_logs add constraint cn360_log_severity check (severity is null or severity in ('info','warn','error')) not valid;
end if;
end $$;
notify pgrst, 'reload schema';
