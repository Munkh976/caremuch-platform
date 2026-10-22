-- Hotfix stand-in (PGlite only): log_event exactly as on DEV (Oct 21), with DEV's grants (PUBLIC, anon, authenticated).
CREATE OR REPLACE FUNCTION public.log_event(_agency_id uuid, _event_type text, _actor_type text DEFAULT 'system'::text, _actor_id uuid DEFAULT NULL::uuid, _subject_type text DEFAULT 'unknown'::text, _subject_id uuid DEFAULT NULL::uuid, _payload jsonb DEFAULT '{}'::jsonb, _virtual_office_id uuid DEFAULT NULL::uuid, _is_demo boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _agency_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.events(agency_id, virtual_office_id, event_type, actor_type, actor_id,
                            subject_type, subject_id, payload, is_demo)
  VALUES (_agency_id, _virtual_office_id, _event_type, COALESCE(_actor_type,'system'), _actor_id,
          COALESCE(_subject_type,'unknown'), _subject_id, COALESCE(_payload,'{}'::jsonb), COALESCE(_is_demo,false));
EXCEPTION WHEN OTHERS THEN
  -- Best effort: event logging must never break the underlying operation.
  RETURN;
END;
$function$
;
GRANT EXECUTE ON FUNCTION public.log_event(uuid, text, text, uuid, text, uuid, jsonb, uuid, boolean) TO PUBLIC, anon, authenticated, service_role;
