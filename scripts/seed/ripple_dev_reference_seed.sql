-- Ripple DEV reference seed — agency-specific rows moved out of migrations (owner review, Oct 4).
-- DEV project only (rgeldgztadebgvrdhaqa): agency 56fbfe38 / Ripple office 12faa863.
-- Run AFTER the Phase A migrations, as an approved data statement:
--   npx supabase db query --linked -f scripts/seed/ripple_dev_reference_seed.sql
-- One DO block = one transaction. It raises (and everything rolls back) unless:
--   * the agency and office exist (refuses to run anywhere else),
--   * exactly the missing rows are inserted (expected = 22 / 2 minus rows already present),
--   * the totals afterwards are exactly 22 credential types and 2 service-type mappings.
-- Re-running is safe: it inserts 0 and the totals still check.
-- Reference rows only. No client, caregiver or document data; nothing from the redacted documents.
-- When the care-plan module is enabled for a real office, a Phase B RPC seeds that office's
-- editable defaults instead of this script.
DO $$
DECLARE
  _agency constant uuid := '56fbfe38-e8eb-40c1-ba27-07428f62ed2e';
  _office constant uuid := '12faa863-017e-438c-966c-f67be9b726e7';
  _pre_ct int; _pre_ost int; _ins_ct int; _ins_ost int; _tot_ct int; _tot_ost int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.virtual_office WHERE id = _office AND agency_id = _agency) THEN
    RAISE EXCEPTION 'Ripple dev agency/office not found: this seed is for the DEV project only';
  END IF;

  CREATE TEMP TABLE _ct (name text, category text, valid_months int, required boolean) ON COMMIT DROP;
  INSERT INTO _ct VALUES
    ('ICHAT',                                                  'background_check', 12,   true),
    ('MDHHS Central Registry',                                 'background_check', 12,   true),
    ('OIG',                                                    'background_check', 12,   true),
    ('Sanctioned Provider',                                    'background_check', 12,   true),
    ('MI Sex Offender Registry',                               'background_check', 12,   true),
    ('National Sex Offender Registry',                         'background_check', 12,   true),
    ('Basic First Aid',                                        'annual_online',    12,   true),
    ('Bloodborne Pathogens',                                   'annual_online',    12,   true),
    ('Corporate Compliance',                                   'annual_online',    12,   true),
    ('Cultural Diversity',                                     'annual_online',    12,   true),
    ('Customer Service',                                       'annual_online',    12,   true),
    ('Emergency Preparedness',                                 'annual_online',    12,   true),
    ('Grievances & Appeals',                                   'annual_online',    12,   true),
    ('HIPAA',                                                  'annual_online',    12,   true),
    ('Limited English Proficiency',                            'annual_online',    12,   true),
    ('Person-Centered Planning for Direct Care Professionals', 'annual',           12,   true),
    ('Recipient Rights',                                       'annual',           12,   true),
    ('Trauma Informed Care',                                   'annual',           12,   true),
    ('CPR/First Aid Combined',                                 'in_person_recert', NULL, true),
    ('Mandt Training',                                         'in_person_recert', NULL, true),
    ('Medication Training (if applicable)',                    'in_person_recert', NULL, false),
    ('Recipient Rights (initial only)',                        'in_person_recert', NULL, false);

  SELECT count(*) INTO _pre_ct FROM public.credential_types t JOIN _ct ON _ct.name = t.name WHERE t.agency_id = _agency;
  SELECT count(*) INTO _pre_ost FROM public.office_service_types
    WHERE virtual_office_id = _office AND care_type_code IN ('CLS0001', 'RESP0001');

  INSERT INTO public.credential_types (agency_id, name, category, valid_months, required)
  SELECT _agency, name, category::public.credential_category, valid_months, required FROM _ct
  ON CONFLICT (agency_id, name) DO NOTHING;
  GET DIAGNOSTICS _ins_ct = ROW_COUNT;

  INSERT INTO public.office_service_types (agency_id, virtual_office_id, care_type_code, service_type)
  SELECT _agency, _office, v.code, v.service_type
  FROM (VALUES ('CLS0001', 'cls'), ('RESP0001', 'respite')) AS v(code, service_type)
  JOIN public.care_types ct ON ct.code = v.code
  ON CONFLICT (virtual_office_id, care_type_code) DO NOTHING;
  GET DIAGNOSTICS _ins_ost = ROW_COUNT;

  SELECT count(*) INTO _tot_ct FROM public.credential_types t JOIN _ct ON _ct.name = t.name WHERE t.agency_id = _agency;
  SELECT count(*) INTO _tot_ost FROM public.office_service_types
    WHERE virtual_office_id = _office AND care_type_code IN ('CLS0001', 'RESP0001');

  IF _ins_ct <> 22 - _pre_ct OR _tot_ct <> 22 OR _ins_ost <> 2 - _pre_ost OR _tot_ost <> 2 THEN
    RAISE EXCEPTION 'Seed count check failed: credential_types inserted % (expected %), total % (expected 22); office_service_types inserted % (expected %), total % (expected 2) -- rolled back',
      _ins_ct, 22 - _pre_ct, _tot_ct, _ins_ost, 2 - _pre_ost, _tot_ost;
  END IF;
  RAISE NOTICE 'Ripple dev seed: credential_types +% (total %), office_service_types +% (total %)', _ins_ct, _tot_ct, _ins_ost, _tot_ost;
END $$;
