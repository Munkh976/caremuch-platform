-- Small, complete demo dataset for the real CareMuch Agency (56fbfe38-...),
-- so Schedule / AvailableShifts / the caregiver screening flow can all be
-- exercised end to end. Additive only -- no DROP/CREATE TABLE, no RLS changes.
--
-- PREREQUISITE: Dana Reyes (dana.reyes@caremuch-test.com) must already exist
-- as a caregiver with a login, created via the create-user Edge Function
-- (the supported provisioning path -- see chat history / runbook), BEFORE
-- this migration is pushed. This migration only looks her up; it does not
-- touch auth.* at all.
--
-- Scope:
--   3 caregivers (Dana has a login, provisioned separately), 3 clients,
--   5 shifts (2 assigned, 3 open), 1 published caregiver_screening
--   conversation_flow (3 questions).
--
-- Everything with an is_demo column is marked is_demo = true, so it is
-- covered by public.purge_demo_data() later. Dana survives a purge because
-- purge_demo_data() only deletes caregivers WHERE is_demo AND user_id IS NULL.
--
-- Idempotent: if this has already run (v_flow_id already exists), it exits
-- immediately. A DO block is otherwise all-or-nothing on error, so there is
-- no partial-application state to worry about between runs.

DO $$
DECLARE
  v_agency_id      uuid := '56fbfe38-e8eb-40c1-ba27-07428f62ed2e'; -- CareMuch Agency (existing)
  v_vo_primary_id  uuid := '17acb690-8726-4ad1-8df2-460799cd11f7'; -- Primary Office, LA CA (existing)
  v_vo_kind_id     uuid := '56785edd-ce66-4bf0-a487-abb628f21fef'; -- Kind Care Services, Winnetka IL (existing)

  v_dana_id        uuid; -- looked up below: provisioned via create-user Edge Function
  v_dana_user_id   uuid;
  v_marcus_id      uuid := '582bf196-91c6-47b3-9ed6-bdc3b72771d7';
  v_priya_id       uuid := '0fb086b4-09d4-4d72-ab9d-4de795dde5f8';

  v_eleanor_id     uuid := '1725aa29-f369-4c97-b072-f27777dd9d91';
  v_robert_id      uuid := '7d96a702-e876-4021-8e71-a91ce3305aa2';
  v_grace_id       uuid := 'e8090335-291d-4940-b802-890a13541235';

  v_shift1_id      uuid := 'af8b8677-a5c6-45c3-a9d0-d4e69326ae99'; -- Dana / Eleanor, becomes 'assigned'
  v_shift2_id      uuid := 'edfa6095-7a50-4a75-9bdf-ee0062fc4223'; -- Dana / Eleanor, becomes 'assigned' then set to 'confirmed'
  v_shift3_id      uuid := 'f6715593-f4f9-45a0-99d9-0fb50a9bd87a'; -- open, Robert
  v_shift4_id      uuid := '18d60cff-cdd0-4fb5-90ca-f9c6e695253c'; -- open, Grace
  v_shift5_id      uuid := 'c020fc86-4a05-4756-b669-b6ee4c119ed7'; -- open, Eleanor

  v_flow_id        uuid := 'be823bdf-c644-44e8-b8da-0d9638b73b38';
  v_node1_id       uuid := '9b27ad65-44cb-4dbe-91c4-eb7f3e6da857';
  v_node2_id       uuid := 'e9e52ea2-c763-4a81-9ef2-3aeb73962e2c';
  v_node3_id       uuid := '83935605-d140-44bf-9e71-f3c3e7778e8e';
BEGIN

  -- ============ 0. Idempotency guard ============
  IF EXISTS (SELECT 1 FROM public.conversation_flows WHERE id = v_flow_id) THEN
    RAISE NOTICE 'Seed already applied (flow % exists) -- skipping.', v_flow_id;
    RETURN;
  END IF;

  -- ============ 1. Look up Dana (provisioned via create-user Edge Function) ============
  SELECT c.id, c.user_id INTO v_dana_id, v_dana_user_id
  FROM public.caregivers c
  WHERE c.email = 'dana.reyes@caremuch-test.com' AND c.agency_id = v_agency_id
  LIMIT 1;

  IF v_dana_id IS NULL THEN
    RAISE EXCEPTION 'Dana Reyes caregiver row not found. Provision her first via the '
      'create-user Edge Function (email dana.reyes@caremuch-test.com, agency %), '
      'then re-run this migration.', v_agency_id;
  END IF;

  -- ============ 2. Remaining caregivers (no login) ============
  INSERT INTO public.caregivers (
    id, agency_id, virtual_office_id, user_id, first_name, last_name, email, phone,
    address, city, state, zip_code, employment_type, role, hourly_rate,
    is_active, is_demo, hire_date, service_radius_miles,
    location_address, location_city, location_state, location_zip_code, service_zipcodes
  ) VALUES
  (v_marcus_id, v_agency_id, v_vo_primary_id, NULL, 'Marcus', 'Chen',
   'marcus.chen@caremuch-test.com', '310-555-0122',
   '210 Oak Ave', 'Los Angeles', 'CA', '90003', 'part_time', 'part_time', 21.00,
   true, true, CURRENT_DATE - 200, 12,
   '210 Oak Ave', 'Los Angeles', 'CA', '90003', ARRAY['90001','90002','90003','90004']),
  (v_priya_id, v_agency_id, v_vo_kind_id, NULL, 'Priya', 'Nair',
   'priya.nair@caremuch-test.com', '847-555-0133',
   '88 Birch Ln', 'Winnetka', 'IL', '60093', 'on_call', 'on_call', 26.00,
   true, true, CURRENT_DATE - 90, 10,
   '88 Birch Ln', 'Winnetka', 'IL', '60093', ARRAY['60093','60091']);

  -- ============ 3. Caregiver skills (real care_type codes) ============
  INSERT INTO public.caregiver_skills (caregiver_id, care_type_code, proficiency_level, years_experience, is_certified, is_demo) VALUES
  (v_dana_id,   'SPC0001', 'expert',       5, true,  true), -- Personal Care
  (v_dana_id,   'ADL0003', 'expert',       5, true,  true), -- Companionship
  (v_dana_id,   'SAF0001', 'intermediate', 3, true,  true), -- Mobility Assistance
  (v_marcus_id, 'SAF0001', 'intermediate', 3, true,  true),
  (v_marcus_id, 'HMC0001', 'intermediate', 2, true,  true), -- Medication Management
  (v_priya_id,  'ADL0003', 'expert',       6, true,  true),
  (v_priya_id,  'ADL0004', 'intermediate', 4, false, true); -- Meal Preparation

  -- ============ 4. Caregiver certifications ============
  INSERT INTO public.caregiver_certifications (caregiver_id, certification_name, expiry_date, issued_date, is_verified, is_demo) VALUES
  (v_dana_id,   'HHA (Home Health Aide)',              CURRENT_DATE + 300, CURRENT_DATE - 400, true, true),
  (v_dana_id,   'CPR / First Aid',                     CURRENT_DATE + 120, CURRENT_DATE - 200, true, true),
  (v_marcus_id, 'CNA (Certified Nursing Assistant)',   CURRENT_DATE + 250, CURRENT_DATE - 150, true, true),
  (v_priya_id,  'Dementia care training',              CURRENT_DATE + 400, CURRENT_DATE - 90,  true, true);

  -- ============ 5. Caregiver availability (0=Sun .. 6=Sat, matches EXTRACT(DOW)) ============
  INSERT INTO public.caregiver_availability (agency_id, caregiver_id, day_of_week, start_time, end_time, is_demo) VALUES
  (v_agency_id, v_dana_id,   1, '08:00', '16:00', true),
  (v_agency_id, v_dana_id,   2, '08:00', '16:00', true),
  (v_agency_id, v_dana_id,   3, '08:00', '16:00', true),
  (v_agency_id, v_dana_id,   4, '08:00', '16:00', true),
  (v_agency_id, v_dana_id,   5, '08:00', '16:00', true),
  (v_agency_id, v_marcus_id, 2, '10:00', '18:00', true),
  (v_agency_id, v_marcus_id, 4, '10:00', '18:00', true),
  (v_agency_id, v_marcus_id, 6, '09:00', '15:00', true),
  (v_agency_id, v_priya_id,  1, '09:00', '17:00', true),
  (v_agency_id, v_priya_id,  3, '09:00', '17:00', true),
  (v_agency_id, v_priya_id,  5, '09:00', '17:00', true);

  -- ============ 6. Clients ============
  INSERT INTO public.clients (
    id, agency_id, virtual_office_id, first_name, last_name, phone, email,
    address, city, state, zip_code, is_active, is_demo, preferred_caregiver_id,
    medical_conditions, care_requirements
  ) VALUES
  (v_eleanor_id, v_agency_id, v_vo_primary_id, 'Eleanor', 'Whitfield', '310-555-0201', 'eleanor.whitfield@example.com',
   '55 Maple Dr', 'Los Angeles', 'CA', '90002', true, true, v_dana_id,
   ARRAY['Mild dementia'], ARRAY['Personal care', 'Mobility assistance']),
  (v_robert_id, v_agency_id, v_vo_primary_id, 'Robert', 'Kim', '310-555-0202', 'robert.kim@example.com',
   '12 Pine St', 'Los Angeles', 'CA', '90001', true, true, NULL,
   ARRAY['Diabetes'], ARRAY['Medication management']),
  (v_grace_id, v_agency_id, v_vo_kind_id, 'Grace', 'Lindqvist', '847-555-0203', 'grace.lindqvist@example.com',
   '9 Cedar Ct', 'Winnetka', 'IL', '60093', true, true, v_priya_id,
   ARRAY[]::text[], ARRAY['Companionship', 'Meal preparation']);

  -- ============ 7. Client care needs ============
  INSERT INTO public.client_care_needs (client_id, care_type_code, priority, is_demo) VALUES
  (v_eleanor_id, 'SPC0001', 1, true),
  (v_eleanor_id, 'SAF0001', 2, true),
  (v_robert_id,  'HMC0001', 1, true),
  (v_grace_id,   'ADL0003', 1, true),
  (v_grace_id,   'ADL0004', 2, true);

  -- ============ 8. Shifts ============
  -- Inserted as 'open' with no caregiver_id: shifts.caregiver_id is a derived
  -- column (trg_enforce_derived_shift_caregiver overwrites it on insert), so
  -- setting it here would just be discarded. The two "assigned" shifts get
  -- their caregiver + status via a shift_assignments insert in step 9, which
  -- trg_sync_shift_caregiver picks up automatically.
  INSERT INTO public.shifts (
    id, agency_id, client_id, order_title, care_type_code,
    shift_date, start_time, end_time, duration_hours, pay_rate, status,
    required_skills, is_demo
  ) VALUES
  (v_shift1_id, v_agency_id, v_eleanor_id, 'Personal care visit',  'SPC0001', CURRENT_DATE + 1, '09:00', '13:00', 4, 24.00, 'open', ARRAY['SPC0001'], true),
  (v_shift2_id, v_agency_id, v_eleanor_id, 'Mobility support',     'SAF0001', CURRENT_DATE + 3, '09:00', '11:00', 2, 24.00, 'open', ARRAY['SAF0001'], true),
  (v_shift3_id, v_agency_id, v_robert_id,  'Medication check-in',  'HMC0001', CURRENT_DATE + 2, '14:00', '15:00', 1, 26.00, 'open', ARRAY['HMC0001'], true),
  (v_shift4_id, v_agency_id, v_grace_id,   'Companionship visit',  'ADL0003', CURRENT_DATE + 2, '10:00', '14:00', 4, 22.00, 'open', ARRAY['ADL0003'], true),
  (v_shift5_id, v_agency_id, v_eleanor_id, 'Companionship visit',  'ADL0003', CURRENT_DATE + 6, '15:00', '17:00', 2, 22.00, 'open', ARRAY['ADL0003'], true);

  -- ============ 9. Shift assignments (drives shifts 1 & 2 to 'assigned') ============
  -- protect_assignment_columns() blocks direct INSERTs into shift_assignments
  -- unless caremuch.assignment_ctx = '1' -- the same escape hatch
  -- assign_caregiver_to_shift()/caregiver_pick_up_shift() set around their
  -- own inserts. Mirroring that exact pattern here.
  PERFORM set_config('caremuch.assignment_ctx', '1', true);
  INSERT INTO public.shift_assignments (shift_id, caregiver_id, status, assignment_method, is_locked, is_demo) VALUES
  (v_shift1_id, v_dana_id, 'scheduled', 'manual', true, true),
  (v_shift2_id, v_dana_id, 'confirmed', 'manual', true, true);
  PERFORM set_config('caremuch.assignment_ctx', '', true);

  -- shift2: bump the shift's own status past the trigger's default 'assigned'
  -- to 'confirmed', for a second, distinct status in the seed set.
  UPDATE public.shifts SET status = 'confirmed' WHERE id = v_shift2_id;

  -- ============ 10. Conversation flow: caregiver_screening, published ============
  INSERT INTO public.conversation_flows (id, agency_id, audience, name, description, status, is_active, published_at)
  VALUES (v_flow_id, v_agency_id, 'caregiver_screening', 'CareMuch Agency Caregiver Screening',
          'Three-question baseline screening for new caregiver applicants.', 'published', true, now());

  INSERT INTO public.flow_nodes (id, flow_id, node_key, prompt, node_type, sort_order, allow_skip, allow_free_text, free_text_label) VALUES
  (v_node1_id, v_flow_id, 'experience', 'How many years of professional caregiving experience do you have?', 'single_select', 1, false, false, NULL),
  (v_node2_id, v_flow_id, 'de_escalation', 'A client is frustrated and raises their voice at you. What do you do?', 'single_select', 2, false, false, NULL),
  (v_node3_id, v_flow_id, 'dementia_comfort', 'How comfortable are you working with clients who have dementia or memory loss?', 'single_select', 3, false, true, 'Anything else we should know?');

  UPDATE public.conversation_flows SET entry_node_id = v_node1_id WHERE id = v_flow_id;

  INSERT INTO public.flow_options (node_id, label, value, sort_order, trait_weights) VALUES
  (v_node1_id, 'Less than 1 year',  'exp_lt1',    1, '{"conscientiousness": 2}'::jsonb),
  (v_node1_id, '1-3 years',         'exp_1to3',   2, '{"conscientiousness": 5}'::jsonb),
  (v_node1_id, '3+ years',          'exp_3plus',  3, '{"conscientiousness": 8}'::jsonb),

  (v_node2_id, 'Stay calm, listen, and de-escalate',                     'deesc_calm',     1, '{"emotional_stability": 8, "resilience": 6}'::jsonb),
  (v_node2_id, 'Explain calmly that you need them to lower their voice', 'deesc_explain',  2, '{"emotional_stability": 5, "agreeableness": 3}'::jsonb),
  (v_node2_id, 'Step away and get a supervisor immediately',             'deesc_escalate', 3, '{"emotional_stability": 2}'::jsonb),

  (v_node3_id, 'Very comfortable, I have specific experience', 'dementia_high', 1, '{"ice": 8, "agreeableness": 5}'::jsonb),
  (v_node3_id, 'Somewhat comfortable, willing to learn',       'dementia_mid',  2, '{"ice": 5, "agreeableness": 5}'::jsonb),
  (v_node3_id, 'Not very comfortable',                         'dementia_low',  3, '{"ice": 2}'::jsonb);

  RAISE NOTICE 'Seed complete: caregivers dana=%, marcus=%, priya=% | clients eleanor=%, robert=%, grace=% | flow=%',
    v_dana_id, v_marcus_id, v_priya_id, v_eleanor_id, v_robert_id, v_grace_id, v_flow_id;
END $$;
