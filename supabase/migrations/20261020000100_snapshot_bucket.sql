-- Snapshot bucket for captured frames.
--
-- The inspection loop uploads to /storage/v1/object/inspection-snapshots/<name>
-- with the service role, and stores (and broadcasts to the HUD) the URL
-- /storage/v1/object/public/inspection-snapshots/<name>. The HUD loads that URL
-- with no key, so the bucket must be public. Public means readable by exact
-- object URL only: with no policies on storage.objects, anon cannot upload,
-- overwrite, delete or list.
--
-- If this ever moves to signed URLs, the workflow's build-snapshot-url node and
-- the HUD's snapshotUrl consumer must change with it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-snapshots', 'inspection-snapshots', true, 5242880, array['image/jpeg'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
