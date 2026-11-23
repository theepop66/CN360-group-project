-- Run after the existing-table compatibility migration. No rows are deleted,
-- rewritten or merged. Existing duplicate test records remain historical data.
BEGIN;
CREATE INDEX IF NOT EXISTS cn360_item_inspection_lookup
  ON public.inspection_results (controller_session, item_id, id)
  WHERE controller_session IS NOT NULL AND item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cn360_record_inspection(inspection jsonb)
RETURNS TABLE(id bigint, was_inserted boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requested public.inspection_results;
  recorded_id bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'cn360_record_inspection requires READ COMMITTED isolation';
  END IF;
  SELECT * INTO requested FROM jsonb_populate_record(NULL::public.inspection_results, inspection);
  IF (requested.controller_session IS NULL) <> (requested.item_id IS NULL) THEN
    RAISE EXCEPTION 'Both controller_session and item_id are required' USING ERRCODE = '22023';
  END IF;
  IF requested.controller_session IS NOT NULL THEN
    IF requested.controller_session !~ '^[A-Za-z0-9_-]{1,64}$' OR requested.item_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
      RAISE EXCEPTION 'Invalid physical item identity' USING ERRCODE = '22023';
    END IF;
    -- The transaction lock serializes concurrent callers for the same item.
    -- A hash collision only serializes unrelated items; the full pair is still
    -- compared below. The lock is released on commit or rollback.
    PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(requested.controller_session, requested.item_id)::text, 0));
    SELECT existing.id INTO recorded_id FROM public.inspection_results AS existing
      WHERE existing.controller_session = requested.controller_session AND existing.item_id = requested.item_id
      ORDER BY existing.id LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT recorded_id, false;
      RETURN;
    END IF;
  END IF;
  INSERT INTO public.inspection_results AS inserted
    (inspection_at, inspection_target, model_instruction, camera_session, frame_sequence,
     frame_width, frame_height, box_count, defect_coverage, coverage_threshold, verdict,
     prompt_verified, frame_url, controller_session, item_id)
  VALUES
    (requested.inspection_at, requested.inspection_target, requested.model_instruction,
     requested.camera_session, requested.frame_sequence, requested.frame_width,
     requested.frame_height, requested.box_count, requested.defect_coverage,
     requested.coverage_threshold, requested.verdict, requested.prompt_verified,
     requested.frame_url, requested.controller_session, requested.item_id)
  RETURNING inserted.id INTO recorded_id;
  RETURN QUERY SELECT recorded_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.cn360_record_inspection(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cn360_record_inspection(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
