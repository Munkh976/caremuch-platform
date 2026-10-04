-- M-CP-07 — system-wide reference rows: the eight measure types (arch §11.3).
-- Ripple care-plan module, Phase A. Schema plan §8. DRAFT FOR REVIEW. Not pushed.
--
-- Owner review (Oct 4): migrations seed only rows every agency uses. The measure types are generic
-- question kinds (Yes/No/N/A, prompt level, tally, ...), not agency policy, so they are SYSTEM rows
-- (agency_id NULL), readable by all staff of any agency and referenced by any agency's objectives.
-- An agency can add its own measure types later (agency_id set) through a Phase B RPC.
-- Agency-specific reference rows (Ripple's credential checklist, its CLS0001 -> cls / RESP0001 ->
-- respite mapping) are NOT here: they live in scripts/seed/ripple_dev_reference_seed.sql, run on
-- DEV only. Nothing from the redacted Ripple documents is seeded. Idempotent.

INSERT INTO public.measure_types (agency_id, kind, label, default_options)
SELECT NULL, v.kind::public.measure_kind, v.label, v.opts::jsonb
FROM (VALUES
  ('yes_no_na',    'Participation (Yes / No / N/A)',   '["Yes","No","N/A"]'),
  ('prompt_level', 'Highest prompt level used',        '["Gestural","Visual","Verbal","Modeling","Partial physical"]'),
  ('graded_steps', 'Steps tolerated without distress', NULL),
  ('tally',        'Frequency tally',                  NULL),
  ('trials',       'Repeated trials',                  '["Yes","No","N/A"]'),
  ('short_answer', 'Short answer',                     NULL),
  ('narrative',    'Narrative response',               NULL),
  ('staff_note',   'Staff note (display only)',        NULL)
) AS v(kind, label, opts)
ON CONFLICT (label) WHERE agency_id IS NULL DO NOTHING;
