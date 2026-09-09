-- Data fix, not a Reports.tsx bug: the 5 demo caregivers seeded for agency
-- 56fbfe38 (CareMuch Agency) have virtual_office_id = NULL, so the Hours
-- Delivered tab's "By caregiver"/"By virtual office" breakdowns correctly
-- (per hoursDelivered.ts's UNASSIGNED_OFFICE fallback) show them as
-- "Unassigned office" instead of Ripple Effects. Confirmed live in
-- 20260909030000_investigate_reports_office_and_actuals.sql: exactly 5
-- is_demo caregivers under this agency, all with virtual_office_id NULL.
--
-- This only assigns the office for display/reporting purposes. It does not
-- touch conversation_flows, knowledge_documents, virtual_office branding/
-- config, or anything else under the frozen Ripple Effects demo -- additive
-- data fix on the caregivers table only.
DO $$
DECLARE
  v_agency_id   uuid;
  v_ripple_id   uuid;
  v_updated     int;
BEGIN
  SELECT id INTO v_agency_id FROM public.agency WHERE id::text LIKE '56fbfe38%';
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'CareMuch Agency (56fbfe38...) not found -- aborting.';
  END IF;

  SELECT id INTO v_ripple_id
  FROM public.virtual_office
  WHERE agency_id = v_agency_id AND name ILIKE '%ripple%';
  IF v_ripple_id IS NULL THEN
    RAISE EXCEPTION 'Ripple Effects virtual_office not found under agency % -- aborting.', v_agency_id;
  END IF;

  UPDATE public.caregivers
  SET virtual_office_id = v_ripple_id
  WHERE agency_id = v_agency_id
    AND is_demo = true
    AND virtual_office_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Attached % demo caregiver(s) to Ripple Effects office %.', v_updated, v_ripple_id;

  IF v_updated <> 5 THEN
    RAISE WARNING 'Expected to update exactly 5 caregivers (per the confirmed investigation), updated % instead -- verify manually.', v_updated;
  END IF;
END $$;
