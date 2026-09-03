-- Restores the family_intake conversation flow: the 8-question lead-capture flow
-- visible in old screenshots of the Lovable-hosted app, never inserted by any
-- migration and confirmed missing from the live conversation_flows table (verified
-- 2026-09-03 -- see docs/known-issues.md, "AUDIT NEEDED: other Lovable-dashboard-
-- authored config may be missing"). Restored as a migration, not the live FlowBuilder
-- UI, specifically so it survives the next environment move (that's exactly what
-- caused it to be lost the first time).
--
-- Lead capture, not personality scoring: useConversationFlow.ts's complete() already
-- nulls the band for any audience other than caregiver_screening
-- (`p_band: audience === "caregiver_screening" ? finalScore.band : null`), so every
-- option here carries score_weight = 0 and trait_weights = '{}'::jsonb -- no scoring
-- machinery needed, matching behavior the app already has.
--
-- Q2 ("What kind of help is needed?") is a STATIC snapshot of care_types, not a live
-- dynamic_source_table node -- FamilyIntakeSurface.tsx lacks the isDynamicSource/
-- DynamicQuestion support ConversationSurface.tsx has (logged in known-issues.md).
-- Q7 keeps its free-text field even though FamilyIntakeSurface.tsx currently discards
-- it for a single_select node with options (also logged in known-issues.md) -- the
-- 5 concern options work; the optional note doesn't save yet.

DO $$
DECLARE
  v_agency_id uuid := '56fbfe38-e8eb-40c1-ba27-07428f62ed2e'; -- CareMuch Agency (existing)

  v_flow_id  uuid := 'b1000000-0000-4000-8000-000000000001';
  v_node1_id uuid := 'b1000000-0000-4000-8000-000000000011'; -- Who needs care?
  v_node2_id uuid := 'b1000000-0000-4000-8000-000000000012'; -- What kind of help is needed?
  v_node3_id uuid := 'b1000000-0000-4000-8000-000000000013'; -- Hours per week?
  v_node4_id uuid := 'b1000000-0000-4000-8000-000000000014'; -- Which days?
  v_node5_id uuid := 'b1000000-0000-4000-8000-000000000015'; -- Time of day?
  v_node6_id uuid := 'b1000000-0000-4000-8000-000000000016'; -- How soon?
  v_node7_id uuid := 'b1000000-0000-4000-8000-000000000017'; -- Biggest concern?
  v_node8_id uuid := 'b1000000-0000-4000-8000-000000000018'; -- Contact capture
BEGIN

  -- ============ 0. Idempotency guard ============
  IF EXISTS (SELECT 1 FROM public.conversation_flows WHERE id = v_flow_id) THEN
    RAISE NOTICE 'Seed already applied (flow % exists) -- skipping.', v_flow_id;
    RETURN;
  END IF;

  -- ============ 1. Flow (entry_node_id set after nodes exist, below) ============
  -- No is_demo column here -- conversation_flows/flow_nodes/flow_options/
  -- conversation_sessions/conversation_answers predate that convention entirely
  -- (confirmed: no such column on any of the five, and purge_demo_data() never
  -- touches them either). Not marking this demo data; it's real product content.
  INSERT INTO public.conversation_flows (
    id, agency_id, audience, name, description, version, is_active,
    entry_node_id, status, published_at
  ) VALUES (
    v_flow_id, v_agency_id, 'family_intake', 'Kind Care Family Intake',
    'Eight-question family care intake capturing needs and contact details for a free consultation.',
    1, true, NULL, 'published', now()
  );

  -- ============ 2. Nodes ============
  INSERT INTO public.flow_nodes (
    id, flow_id, node_key, prompt, helper_text, node_type,
    allow_skip, allow_free_text, free_text_label, sort_order, default_next_node_id
  ) VALUES
  (v_node1_id, v_flow_id, 'who_needs_care', 'Who needs care?', NULL,
   'single_select', false, false, NULL, 0, v_node2_id),
  (v_node2_id, v_flow_id, 'help_needed', 'What kind of help is needed?', NULL,
   'multi_select', false, false, NULL, 1, v_node3_id),
  (v_node3_id, v_flow_id, 'hours_per_week', 'About how many hours of care per week?', NULL,
   'single_select', false, false, NULL, 2, v_node4_id),
  (v_node4_id, v_flow_id, 'care_days', 'Which days would care be needed?', NULL,
   'multi_select', true, false, NULL, 3, v_node5_id),
  (v_node5_id, v_flow_id, 'time_of_day', 'What time of day matters most?', NULL,
   'single_select', true, false, NULL, 4, v_node6_id),
  (v_node6_id, v_flow_id, 'care_start_timing', 'How soon would you like care to start?', NULL,
   'single_select', false, false, NULL, 5, v_node7_id),
  (v_node7_id, v_flow_id, 'biggest_concern', 'What is your biggest concern right now?',
   'This helps us prepare for your consultation.',
   'single_select', true, true, 'Anything else we should know? (optional)', 6, v_node8_id),
  (v_node8_id, v_flow_id, 'contact_info', 'How can we reach you?',
   'A Kind Care coordinator will follow up to arrange your free consultation.',
   'contact_capture', false, false, NULL, 7, NULL);

  -- ============ 3. Options (score_weight = 0, trait_weights = '{}' -- lead capture, no scoring) ============

  -- Q1: Who needs care? (single_select)
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node1_id, 'My parent',                               'parent',   0, 0, '{}'::jsonb),
  (v_node1_id, 'My spouse or partner',                     'spouse',   1, 0, '{}'::jsonb),
  (v_node1_id, 'Myself',                                   'self',     2, 0, '{}'::jsonb),
  (v_node1_id, 'Another family member or friend',          'other',    3, 0, '{}'::jsonb);

  -- Q2: What kind of help is needed? (multi_select) -- static care_types snapshot,
  -- see docs/known-issues.md re: FamilyIntakeSurface.tsx's missing dynamic-catalog support.
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node2_id, 'Bathing, dressing, personal care',         'personal_care',    0, 0, '{}'::jsonb),
  (v_node2_id, 'Meals and light housekeeping',             'meals_household',  1, 0, '{}'::jsonb),
  (v_node2_id, 'Medication reminders',                     'medication',       2, 0, '{}'::jsonb),
  (v_node2_id, 'Mobility and transfers',                   'mobility',         3, 0, '{}'::jsonb),
  (v_node2_id, 'Memory care / dementia support',            'memory_care',      4, 0, '{}'::jsonb),
  (v_node2_id, 'Companionship',                            'companionship',    5, 0, '{}'::jsonb);

  -- Q3: About how many hours of care per week? (single_select)
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node3_id, 'A few hours a week',                       'few_hours',    0, 0, '{}'::jsonb),
  (v_node3_id, '10-20 hours',                              '10_20',        1, 0, '{}'::jsonb),
  (v_node3_id, '20-40 hours',                              '20_40',        2, 0, '{}'::jsonb),
  (v_node3_id, 'Live-in or around the clock',              'live_in',      3, 0, '{}'::jsonb),
  (v_node3_id, 'Not sure yet',                             'unsure',       4, 0, '{}'::jsonb);

  -- Q4: Which days would care be needed? (multi_select, skippable)
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node4_id, 'Weekdays',                                 'weekdays',   0, 0, '{}'::jsonb),
  (v_node4_id, 'Weekends',                                 'weekends',   1, 0, '{}'::jsonb),
  (v_node4_id, 'Every day',                                'every_day',  2, 0, '{}'::jsonb),
  (v_node4_id, 'Occasional respite only',                  'respite',    3, 0, '{}'::jsonb);

  -- Q5: What time of day matters most? (single_select, skippable)
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node5_id, 'Mornings',                                 'mornings',   0, 0, '{}'::jsonb),
  (v_node5_id, 'Afternoons',                                'afternoons', 1, 0, '{}'::jsonb),
  (v_node5_id, 'Evenings',                                 'evenings',   2, 0, '{}'::jsonb),
  (v_node5_id, 'Overnights',                               'overnights', 3, 0, '{}'::jsonb);

  -- Q6: How soon would you like care to start? (single_select)
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node6_id, 'Immediately',                              'immediately',  0, 0, '{}'::jsonb),
  (v_node6_id, 'Within a week',                            'within_week',  1, 0, '{}'::jsonb),
  (v_node6_id, 'Within a month',                           'within_month', 2, 0, '{}'::jsonb),
  (v_node6_id, 'Just planning ahead',                      'planning',     3, 0, '{}'::jsonb);

  -- Q7: What is your biggest concern right now? (single_select, skippable, + free text)
  INSERT INTO public.flow_options (node_id, label, value, sort_order, score_weight, trait_weights) VALUES
  (v_node7_id, 'Safety at home',                           'safety',       0, 0, '{}'::jsonb),
  (v_node7_id, 'Cost and payment',                         'cost',         1, 0, '{}'::jsonb),
  (v_node7_id, 'Finding a caregiver they trust',           'trust',        2, 0, '{}'::jsonb),
  (v_node7_id, 'Consistency and reliability',              'reliability',  3, 0, '{}'::jsonb),
  (v_node7_id, 'Medical complexity',                       'medical',      4, 0, '{}'::jsonb);

  -- Q8: contact_capture -- no flow_options; FamilyIntakeSurface.tsx renders a
  -- hardcoded ContactForm for this node_type.

  -- ============ 4. Entry node (set after nodes exist -- entry_node_id has a real FK) ============
  UPDATE public.conversation_flows SET entry_node_id = v_node1_id WHERE id = v_flow_id;

  RAISE NOTICE 'Seed complete: family_intake flow=%, nodes 1-8 = %,%,%,%,%,%,%,%',
    v_flow_id, v_node1_id, v_node2_id, v_node3_id, v_node4_id, v_node5_id, v_node6_id, v_node7_id, v_node8_id;
END $$;
