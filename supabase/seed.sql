-- Development seed. No secrets: every value here is fake and safe to commit.
-- Applied by `supabase db reset` after the migrations.
--
-- One passing Inspection, one fail-closed reject, the prompt change that set
-- the target, and the logs the workflows would have written alongside them.

insert into public.prompt_history
  (changed_at, inspection_target, model_instruction, source, model_http_status, model_error)
values
  ('2026-10-20T08:00:00Z', 'mold',
   'Locate all the instances that matches the following description: mold.',
   'hud', 200, null);

with passed as (
  insert into public.inspection_results
    (inspection_at, inspection_target, model_instruction, camera_session, frame_sequence,
     frame_width, frame_height, box_count, defect_coverage, coverage_threshold, verdict,
     prompt_verified, frame_url)
  values
    ('2026-10-20T08:01:00Z', 'mold',
     'Locate all the instances that matches the following description: mold.',
     'seed-session', 1, 1280, 720, 1, 0.0012, 0.005, 'pass', true,
     'http://127.0.0.1:54321/storage/v1/object/public/inspection-snapshots/seed-session-1.jpg')
  returning id
)
insert into public.control_actions
  (inspection_id, action, esp32_accepted, esp32_status, esp32_http_status, esp32_error, requested_at)
select id, 'pass', true, 'accepted', 200, null, '2026-10-20T08:01:00Z' from passed;

-- A model timeout: no coverage, no threshold read, rejected anyway.
with timed_out as (
  insert into public.inspection_results
    (inspection_at, inspection_target, model_instruction, camera_session, frame_sequence,
     frame_width, frame_height, box_count, defect_coverage, coverage_threshold, verdict,
     prompt_verified, frame_url)
  values
    ('2026-10-20T08:02:00Z', 'mold',
     'Locate all the instances that matches the following description: mold.',
     'seed-session', 2, 1280, 720, 0, null, null, 'reject', null, null)
  returning id
)
insert into public.control_actions
  (inspection_id, action, esp32_accepted, esp32_status, esp32_http_status, esp32_error, requested_at)
select id, 'reject', true, 'accepted', 200, null, '2026-10-20T08:02:00Z' from timed_out;

insert into public.system_logs (logged_at, severity, component, message, details)
values
  ('2026-10-20T08:01:00Z', 'info', 'inspection-loop', 'inspection passed',
   '{"verdict": "pass", "reason": null, "defectCoverage": 0.0012, "coverageThreshold": 0.005, "boxCount": 1, "cameraSession": "seed-session", "frameSequence": 1}'),
  ('2026-10-20T08:02:00Z', 'warn', 'inspection-loop', 'inspection rejected',
   '{"verdict": "reject", "reason": "model_timeout", "defectCoverage": null, "coverageThreshold": null, "boxCount": 0, "cameraSession": "seed-session", "frameSequence": 2}'),
  ('2026-10-20T08:03:00Z', 'error', 'model-server', 'model-server is not responding',
   '{"healthy": false}');
