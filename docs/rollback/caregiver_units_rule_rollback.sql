-- Rollback of 20261031150000_caregiver_units_rule.sql: get_progress_note_for_caregiver back to the body of
-- 20261031130000 byte-identically (DEV md5 2c445b7e before the push). Grants unchanged.
CREATE OR REPLACE FUNCTION public.get_progress_note_for_caregiver(_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n record; c record;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided;
  IF n.id IS NULL OR NOT cp_is_assigned_caregiver(n.caregiver_id) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT first_name, left(last_name, 1) AS li INTO c FROM public.clients WHERE id = n.client_id;
  RETURN jsonb_build_object(
    'note', jsonb_build_object('id', n.id, 'status', n.status, 'note_kind', n.note_kind, 'service_date', n.service_date,
      'scheduled_start', n.scheduled_start, 'scheduled_end', n.scheduled_end, 'client_arrived_at', n.client_arrived_at,
      'actual_end', n.actual_end, 'staff_client_ratio', n.staff_client_ratio, 'location', n.location,
      'narrative_text', n.narrative_text, 'staff_signature_name', n.staff_signature_name, 'staff_signed_at', n.staff_signed_at,
      'returned_reason', n.returned_reason, 'late_submitted', n.late_submitted, 'arrived_late', n.arrived_late,
      'due_at', n.due_at, 'client_first_name', c.first_name, 'client_last_initial', c.li,
      'location_mode', (SELECT note_location_mode FROM public.virtual_office WHERE id = n.virtual_office_id)),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('entry_id', e.id, 'goal_text', g.goal_text,
        'objective_letter', o.letter, 'objective_text', o.objective_text, 'staff_instructions', o.staff_instructions,
        'notes_text', e.notes_text, 'answers', e.data,
        'measures', (SELECT COALESCE(jsonb_agg(jsonb_build_object('measure_id', x ->> 'measure_id', 'kind', x ->> 'kind',
                        'prompt_text', x ->> 'prompt_text', 'options', x -> 'options', 'trial_count', x -> 'trial_count')), '[]'::jsonb)
                     FROM jsonb_array_elements(COALESCE(e.measures_snapshot, cp_objective_measures(o.id))) x))
        ORDER BY g.seq, o.seq)
      FROM public.progress_note_entries e
      JOIN public.care_plan_objectives o ON o.id = e.objective_id
      JOIN public.care_plan_goals g ON g.id = o.goal_id
      WHERE e.progress_note_id = n.id), '[]'::jsonb));
END $function$;
