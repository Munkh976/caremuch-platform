-- Phase C-01 — group sessions (owner-approved R1 follow-up) + their audit event types.
-- Ripple care-plan module. Owner line-by-line review done 2026-10-04
-- (Phase C changes scheduling).
--
-- A group session = several clients' shifts in the same slot, worked by the same caregiver.
-- R1 keeps one shift per client; this adds:
--   * group_sessions (office-scoped): date, slot, staff:client ratio, max clients (NULL = the
--     office default, virtual_office.group_session_max_clients, default 3 until Ripple answers);
--   * shifts.group_session_id (nullable). Set or cleared ONLY through set_shift_group_session(); a
--     guard trigger refuses any other change, so the exemption below can't be self-granted by
--     editing a shift. A shift must match the session's office, date and slot exactly.
-- The eligibility change (C-02) exempts from double_booked ONLY overlaps where both shifts carry
-- the same group_session_id (and, by the loop, the same caregiver), and refuses an assignment
-- that would give that caregiver more distinct clients in the group than its max. A client can
-- have only one shift per group.
-- Also here (office settings): virtual_office.care_plan_module_enabled_at, the go-live cutover
-- used by projected units (C-02).
-- Roles: manager, agency_admin, scheduler (scheduling tier) in the session office's scope.
-- Audited (fail closed): group_session_created, shift_group_session_set.

-- =============================================================================================
-- 1. Event types (one atomic ALTER: the 42 existing + 2)
-- =============================================================================================
ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
  'caregiver_application_received', 'caregiver_approved', 'caregiver_rejected',
  'care_request_received', 'care_request_converted_to_client',
  'shift_created', 'shift_assigned', 'shift_filled', 'shift_completed', 'shift_cancelled', 'shift_no_show',
  'caregiver_pickup', 'assignment_released', 'rating_added',
  'time_entry_submitted', 'time_entry_approved', 'earnings_computed',
  'account_link_issued',
  'care_plan_module_enabled', 'template_draft_saved', 'template_published', 'instance_template_upgraded',
  'care_plan_created', 'care_plan_renewed', 'care_plan_updated', 'training_version_bumped',
  'objective_measures_set', 'authorization_created', 'client_document_saved',
  'credential_entered', 'credential_overridden', 'inservice_signed', 'training_recorded',
  'training_record_overridden',
  'progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
  'progress_note_voided', 'billing_batch_built', 'billing_batch_approved', 'billing_batch_billed',
  -- Phase C
  'group_session_created', 'shift_group_session_set'
]::text[]));

-- =============================================================================================
-- 2. Office default max clients (admin-only, like the other care-plan office settings)
-- =============================================================================================
ALTER TABLE public.virtual_office
  ADD COLUMN group_session_max_clients smallint NOT NULL DEFAULT 3
    CONSTRAINT virtual_office_group_session_max_clients_chk CHECK (group_session_max_clients BETWEEN 1 AND 20);

-- Go-live cutover: when the care-plan module was first turned on for the office. Stamped by the
-- guard below when care_plan_module_enabled goes on (seed_office_care_plan_defaults does that);
-- no signed-in user can set or change it. Existing offices: NULL (backfill NULL) = the
-- projection counts no past shifts at all for the office.
ALTER TABLE public.virtual_office ADD COLUMN care_plan_module_enabled_at timestamptz;
COMMENT ON COLUMN public.virtual_office.care_plan_module_enabled_at IS
  'Set once, when the care-plan module is first turned on. Projected units count past shifts without a note only from this date (office time zone); NULL = none.';

-- Same function, same trigger: one more admin-only column, and the go-live stamp. (CREATE OR
-- REPLACE of a trigger function with an identical signature; its ACL is unchanged: no grants.)
CREATE OR REPLACE FUNCTION public.guard_virtual_office_flags()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- go-live stamp: nobody signed in sets it by hand (admins included); it is set here, once
  IF _uid IS NOT NULL AND ((TG_OP = 'INSERT' AND NEW.care_plan_module_enabled_at IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.care_plan_module_enabled_at IS DISTINCT FROM OLD.care_plan_module_enabled_at)) THEN
    RAISE EXCEPTION 'The care-plan go-live date is set when the module is turned on' USING ERRCODE = '42501';
  END IF;
  IF NEW.care_plan_module_enabled AND NEW.care_plan_module_enabled_at IS NULL
     AND (TG_OP = 'INSERT' OR NOT OLD.care_plan_module_enabled) THEN
    NEW.care_plan_module_enabled_at := now();
  END IF;

  IF _uid IS NULL
     OR has_role(_uid, 'system_admin'::app_role)
     OR has_role(_uid, 'agency_admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.compliance_enforcement_enabled OR NEW.care_plan_module_enabled OR NEW.billing_week_start <> 1
       OR NEW.group_session_max_clients <> 3 THEN
      RAISE EXCEPTION 'Only an agency admin can set the care-plan module, compliance enforcement, billing week or group size'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.compliance_enforcement_enabled IS DISTINCT FROM OLD.compliance_enforcement_enabled
     OR NEW.care_plan_module_enabled IS DISTINCT FROM OLD.care_plan_module_enabled
     OR NEW.billing_week_start IS DISTINCT FROM OLD.billing_week_start
     OR NEW.group_session_max_clients IS DISTINCT FROM OLD.group_session_max_clients THEN
    RAISE EXCEPTION 'Only an agency admin can change the care-plan module, compliance enforcement, billing week or group size setting'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_virtual_office_flags() FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 3. group_sessions + shifts.group_session_id
-- =============================================================================================
CREATE TABLE public.group_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid NOT NULL REFERENCES public.virtual_office(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  staff_client_ratio text CHECK (staff_client_ratio IS NULL OR staff_client_ratio ~ '^[0-9]{1,2}:[0-9]{1,2}$'),
  max_clients smallint CHECK (max_clients IS NULL OR max_clients BETWEEN 1 AND 20),   -- NULL = office default
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_sessions_slot_chk CHECK (end_time <> start_time)
);
CREATE INDEX group_sessions_office_date_idx ON public.group_sessions (virtual_office_id, session_date);
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.group_sessions
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

ALTER TABLE public.group_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Schedulers read group sessions in scope" ON public.group_sessions
FOR SELECT TO authenticated
USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,scheduler}'::public.app_role[]));
REVOKE ALL ON TABLE public.group_sessions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.group_sessions FROM authenticated;
GRANT SELECT ON TABLE public.group_sessions TO authenticated;

ALTER TABLE public.shifts
  ADD COLUMN group_session_id uuid REFERENCES public.group_sessions(id) ON DELETE SET NULL;
CREATE INDEX shifts_group_session_idx ON public.shifts (group_session_id) WHERE group_session_id IS NOT NULL;

-- Only set_shift_group_session() may set or change the column (it raises a transaction-local
-- context flag); every other writer, staff included, is refused. Service role (auth.uid() NULL)
-- and the FK's ON DELETE SET NULL (a deleted session) are not blocked.
CREATE FUNCTION public.cp_guard_shift_group_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('caremuch.group_ctx', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.group_session_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.group_session_id IS NOT NULL AND NEW.group_session_id IS DISTINCT FROM OLD.group_session_id) THEN
    RAISE EXCEPTION 'A shift joins a group session only through set_shift_group_session()' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_shift_group_session() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_shift_group_session BEFORE INSERT OR UPDATE OF group_session_id ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.cp_guard_shift_group_session();

-- =============================================================================================
-- 4. RPCs
-- =============================================================================================
CREATE FUNCTION public.create_group_session(_office_id uuid, _session_date date, _start_time time, _end_time time,
                                            _staff_client_ratio text DEFAULT NULL, _max_clients smallint DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_id uuid;
BEGIN
  SELECT id, agency_id INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin,scheduler}'::public.app_role[]);
  IF _session_date IS NULL OR _start_time IS NULL OR _end_time IS NULL OR _end_time = _start_time THEN
    RAISE EXCEPTION 'A date and a start and end time are required' USING ERRCODE = '22023';
  END IF;
  IF _staff_client_ratio IS NOT NULL AND _staff_client_ratio !~ '^[0-9]{1,2}:[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Staff:client ratio looks like 1:3' USING ERRCODE = '22023';
  END IF;
  IF _max_clients IS NOT NULL AND _max_clients NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Max clients is 1-20' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.group_sessions (agency_id, virtual_office_id, session_date, start_time, end_time, staff_client_ratio, max_clients)
  VALUES (o.agency_id, o.id, _session_date, _start_time, _end_time, _staff_client_ratio, _max_clients)
  RETURNING id INTO v_id;
  PERFORM cp_audit(o.agency_id, o.id, 'group_session_created', 'group_session', v_id,
    jsonb_strip_nulls(jsonb_build_object('group_session_id', v_id, 'max_clients', _max_clients)));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_group_session(uuid, date, time, time, text, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_session(uuid, date, time, time, text, smallint) TO authenticated;

-- _group_session_id NULL removes the shift from its group. The shift must be in the session's
-- office, on its date, with exactly its start and end time; cancelled shifts can't join.
CREATE FUNCTION public.set_shift_group_session(_shift_id uuid, _group_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; g record;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  PERFORM cp_require_scope(s.agency_id, s.virtual_office_id, '{manager,agency_admin,scheduler}'::public.app_role[]);
  IF _group_session_id IS NOT NULL THEN
    SELECT * INTO g FROM public.group_sessions WHERE id = _group_session_id FOR UPDATE;
    IF g.id IS NULL OR g.agency_id IS DISTINCT FROM s.agency_id OR g.virtual_office_id IS DISTINCT FROM s.virtual_office_id THEN
      RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
    END IF;
    IF s.shift_date <> g.session_date OR s.start_time <> g.start_time OR s.end_time <> g.end_time THEN
      RAISE EXCEPTION 'The shift must be on the session''s date and in exactly its time slot' USING ERRCODE = '22023';
    END IF;
    IF s.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled shift can''t join a group session' USING ERRCODE = '22023'; END IF;
    -- One shift per client per group (the session row lock above serializes concurrent joins).
    IF EXISTS (SELECT 1 FROM public.shifts o WHERE o.group_session_id = g.id AND o.id <> s.id
                 AND o.client_id = s.client_id AND o.status IS DISTINCT FROM 'cancelled') THEN
      RAISE EXCEPTION 'This client already has a shift in this group session' USING ERRCODE = '22023';
    END IF;
  END IF;
  PERFORM set_config('caremuch.group_ctx', '1', true);
  UPDATE public.shifts SET group_session_id = _group_session_id WHERE id = s.id;
  PERFORM set_config('caremuch.group_ctx', '', true);
  PERFORM cp_audit(s.agency_id, s.virtual_office_id, 'shift_group_session_set', 'shift', s.id,
    jsonb_strip_nulls(jsonb_build_object('shift_id', s.id, 'group_session_id', _group_session_id, 'removed', _group_session_id IS NULL)));
END $$;
REVOKE ALL ON FUNCTION public.set_shift_group_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shift_group_session(uuid, uuid) TO authenticated;
