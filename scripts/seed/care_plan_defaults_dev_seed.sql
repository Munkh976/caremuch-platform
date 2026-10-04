-- Care-plan module DEFAULTS seed — DEV project only (Phase B1).
-- Fills the system default catalogs that seed_office_care_plan_defaults(_office_id) copies into an
-- office/agency when an agency_admin enables the module. The content is the ISK/Ripple checklist
-- (Michigan CMH), i.e. deployment reference data, so it is NOT in a migration.
-- Run AFTER the B1 migrations, as an approved data statement:
--   npx supabase db query --linked -f scripts/seed/care_plan_defaults_dev_seed.sql
-- One DO block = one transaction; raises (rolls back) unless the DEV agency exists and the totals
-- afterwards are exactly 22 default credential types and 2 default service mappings.
-- Re-running is safe (inserts 0, totals still check). No client or person data.
DO $$
DECLARE _ins_ct int; _ins_st int; _tot_ct int; _tot_st int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agency WHERE id = '56fbfe38-e8eb-40c1-ba27-07428f62ed2e') THEN
    RAISE EXCEPTION 'DEV agency not found: this seed is for the DEV project only';
  END IF;

  INSERT INTO public.cp_default_credential_types (name, category, valid_months, required)
  SELECT v.name, v.category::public.credential_category, v.valid_months, v.required FROM (VALUES
    ('ICHAT', 'background_check', 12, true), ('MDHHS Central Registry', 'background_check', 12, true),
    ('OIG', 'background_check', 12, true), ('Sanctioned Provider', 'background_check', 12, true),
    ('MI Sex Offender Registry', 'background_check', 12, true), ('National Sex Offender Registry', 'background_check', 12, true),
    ('Basic First Aid', 'annual_online', 12, true), ('Bloodborne Pathogens', 'annual_online', 12, true),
    ('Corporate Compliance', 'annual_online', 12, true), ('Cultural Diversity', 'annual_online', 12, true),
    ('Customer Service', 'annual_online', 12, true), ('Emergency Preparedness', 'annual_online', 12, true),
    ('Grievances & Appeals', 'annual_online', 12, true), ('HIPAA', 'annual_online', 12, true),
    ('Limited English Proficiency', 'annual_online', 12, true),
    ('Person-Centered Planning for Direct Care Professionals', 'annual', 12, true),
    ('Recipient Rights', 'annual', 12, true), ('Trauma Informed Care', 'annual', 12, true),
    ('CPR/First Aid Combined', 'in_person_recert', NULL, true), ('Mandt Training', 'in_person_recert', NULL, true),
    ('Medication Training (if applicable)', 'in_person_recert', NULL, false),
    ('Recipient Rights (initial only)', 'in_person_recert', NULL, false)
  ) AS v(name, category, valid_months, required)
  ON CONFLICT (name) DO NOTHING;
  GET DIAGNOSTICS _ins_ct = ROW_COUNT;

  INSERT INTO public.cp_default_service_types (care_type_code, service_type)
  SELECT v.code, v.service_type FROM (VALUES ('CLS0001', 'cls'), ('RESP0001', 'respite')) AS v(code, service_type)
  JOIN public.care_types ct ON ct.code = v.code
  ON CONFLICT (care_type_code) DO NOTHING;
  GET DIAGNOSTICS _ins_st = ROW_COUNT;

  SELECT count(*) INTO _tot_ct FROM public.cp_default_credential_types;
  SELECT count(*) INTO _tot_st FROM public.cp_default_service_types;
  IF _tot_ct <> 22 OR _tot_st <> 2 THEN
    RAISE EXCEPTION 'Defaults seed count check failed: credential defaults % (expected 22, inserted %), service defaults % (expected 2, inserted %) -- rolled back',
      _tot_ct, _ins_ct, _tot_st, _ins_st;
  END IF;
  RAISE NOTICE 'Care-plan defaults: credential types +% (total %), service mappings +% (total %)', _ins_ct, _tot_ct, _ins_st, _tot_st;
END $$;
