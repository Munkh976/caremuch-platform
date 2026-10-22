"""Builds supabase/migrations/20261029120100_s17_ipos_versions.sql and docs/rollback/s17_ipos_versions_rollback.sql
from DEV's exact function definitions (s17_before.json) + the hand-written s17_new.sql. Every replacement is asserted."""
import json, os, re
SP = os.path.dirname(os.path.abspath(__file__))
REPO = r'C:\WMU\CareMatch\optimal-care-flow'
defs = {r['n']: r for r in json.load(open(os.path.join(SP, 's17_before.json'), encoding='utf-8'))}
new_sql = open(os.path.join(SP, 's17_new.sql'), encoding='utf-8').read()

def rep(text, a, b, n=1):
    assert text.count(a) == n, (a[:80], text.count(a))
    return text.replace(a, b)

def body(name):
    return defs[name]['def'].rstrip() + ';\n'

EDIT_OLD = "IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be edited' USING ERRCODE = '22023'; END IF;"
EDIT_NEW = ("IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Only the active or pending plan can be edited' USING ERRCODE = '22023'; END IF;\n"
            "  PERFORM cp_revision_baseline(p.id);   -- S17: revisions of the active version")
out = {}

# -- the four edit functions: accept a pending plan; record a revision of the active one
f = body('update_care_plan_fields')
f = rep(f, EDIT_OLD, EDIT_NEW)
f = rep(f, "                       'field_values_replaced', _field_values IS NOT NULL));\nEND $function$",
        "                       'field_values_replaced', _field_values IS NOT NULL));\n  PERFORM cp_record_revision(p.id);\nEND $function$")
out['update_care_plan_fields'] = f

f = body('set_objective_measures')
f = rep(f, EDIT_OLD, EDIT_NEW)
f = rep(f, "  RETURN v_n;\nEND $function$", "  PERFORM cp_record_revision(p.id);\n  RETURN v_n;\nEND $function$")
out['set_objective_measures'] = f

f = body('set_care_plan_rows')
f = rep(f, EDIT_OLD, EDIT_NEW)
m = re.findall(r"\n  RETURN [^\n]*;\nEND \$function\$", f)
assert len(m) == 1, m
f = rep(f, m[0], "\n  PERFORM cp_record_revision(p.id);" + m[0])
out['set_care_plan_rows'] = f

f = body('upsert_care_plan_goals')
f = rep(f, EDIT_OLD, EDIT_NEW)
f = rep(f, """    IF EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)
       OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version) THEN""",
        """    -- S17: a pending version never bumps its training version
    IF p.status = 'active' AND (EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)
       OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version)) THEN""")
f = rep(f, "  RETURN jsonb_build_object('training_version', v_tv,", "  PERFORM cp_record_revision(p.id);\n  RETURN jsonb_build_object('training_version', v_tv,")
out['upsert_care_plan_goals'] = f

f = body('would_bump_training_version')
f = rep(f, "SELECT id, agency_id, virtual_office_id, training_version INTO p FROM public.care_plans WHERE id = _care_plan_id;",
        "SELECT id, agency_id, virtual_office_id, training_version, status INTO p FROM public.care_plans WHERE id = _care_plan_id;")
f = rep(f, "  v_trained := EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)\n            OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version);",
        "  -- S17: a pending version never bumps\n  v_trained := p.status = 'active' AND (EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)\n            OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version));")
out['would_bump_training_version'] = f

# -- training writers: accept a pending plan, store the revision, try to activate
TR_OLD = "IF p.status <> 'active' THEN RAISE EXCEPTION 'Training is recorded against the active plan' USING ERRCODE = '22023'; END IF;"
TR_NEW = "IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Training is recorded against the active or pending plan' USING ERRCODE = '22023'; END IF;"
LOCK = ("  -- S17: recordings for a pending version run one at a time (they can activate it)\n"
        "  PERFORM 1 FROM public.care_plans WHERE id = _care_plan_id AND status = 'pending' FOR UPDATE;\n")
f = body('record_inservice_form')
f = rep(f, "BEGIN\n  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;", "BEGIN\n" + LOCK + "  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;")
f = rep(f, TR_OLD, TR_NEW)
f = rep(f, "  RETURN v_id;\nEND $function$", "  PERFORM cp_try_activate_plan(p.id);\n  RETURN v_id;\nEND $function$")
out['record_inservice_form'] = f

f = body('record_training_form')
f = rep(f, "BEGIN\n  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;", "BEGIN\n" + LOCK + "  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;")
f = rep(f, TR_OLD, TR_NEW)
f = rep(f, "    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date)\n  SELECT v_id,",
        "    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date, plan_revision)\n  SELECT v_id,")
f = rep(f, "NULLIF(btrim(e ->> 'trainer_name'), ''), (e ->> 'signed_date')::date\n  FROM jsonb_array_elements(_records) e;",
        "NULLIF(btrim(e ->> 'trainer_name'), ''), (e ->> 'signed_date')::date, p.revision\n  FROM jsonb_array_elements(_records) e;")
f = rep(f, "  RETURN v_id;\nEND $function$", "  PERFORM cp_try_activate_plan(p.id);\n  RETURN v_id;\nEND $function$")
out['record_training_form'] = f

f = body('add_training_attendees')
f = rep(f, "  SELECT * INTO p FROM public.care_plans WHERE id = t.care_plan_id FOR SHARE;",
        "  PERFORM 1 FROM public.care_plans WHERE id = t.care_plan_id AND status = 'pending' FOR UPDATE;   -- S17\n  SELECT * INTO p FROM public.care_plans WHERE id = t.care_plan_id FOR SHARE;")
f = rep(f, "IF p.status <> 'active' OR t.training_version <> p.training_version THEN", "IF p.status NOT IN ('active', 'pending') OR t.training_version <> p.training_version THEN")
f = rep(f, "    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date)\n  SELECT t.id,",
        "    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date, plan_revision)\n  SELECT t.id,")
f = rep(f, "NULLIF(btrim(e ->> 'primary_clinician_name'), ''), v_trainer, (e ->> 'signed_date')::date\n  FROM jsonb_array_elements(_records) e;",
        "NULLIF(btrim(e ->> 'primary_clinician_name'), ''), v_trainer, (e ->> 'signed_date')::date, p.revision\n  FROM jsonb_array_elements(_records) e;")
f = rep(f, "  RETURN v_n;\nEND $function$", "  PERFORM cp_try_activate_plan(p.id);\n  RETURN v_n;\nEND $function$")
out['add_training_attendees'] = f

# -- the training context works on the pending version when there is one
f = body('get_client_training_context')
f = rep(f, "  SELECT id, version, training_version, plan_type, effective_date, expiration_date INTO p\n    FROM public.care_plans WHERE client_id = c.id AND status = 'active';",
        "  -- S17: the version being trained = the pending one when there is one, else the active one\n"
        "  SELECT id, version, training_version, plan_type, effective_date, expiration_date, status, revision INTO p\n"
        "    FROM public.care_plans WHERE client_id = c.id AND status IN ('active', 'pending') ORDER BY (status = 'pending') DESC LIMIT 1;\n"
        "  SELECT id, version, training_version, effective_date, expiration_date INTO a\n"
        "    FROM public.care_plans WHERE client_id = c.id AND status = 'active';")
f = rep(f, "              'plan_type', p.plan_type, 'effective_date', p.effective_date, 'expiration_date', p.expiration_date) END,",
        "              'plan_type', p.plan_type, 'effective_date', p.effective_date, 'expiration_date', p.expiration_date,\n"
        "              'status', p.status, 'revision', p.revision) END,\n"
        "    'in_effect', CASE WHEN a.id IS NULL OR a.id = p.id THEN NULL ELSE jsonb_build_object('care_plan_id', a.id, 'version', a.version,\n"
        "              'training_version', a.training_version, 'effective_date', a.effective_date, 'expiration_date', a.expiration_date) END,")
f = rep(f, "              'signed_date', r.signed_date) ORDER BY g.last_name, g.first_name)",
        "              'signed_date', r.signed_date, 'plan_revision', r.plan_revision) ORDER BY g.last_name, g.first_name)")
out['get_client_training_context'] = f

# -- S4b parent: files can be added to a pending version (ISK IPOS PDF) and its training forms
f = body('cp_attachment_parent')
f = rep(f, "(p.status = 'active' AND f.training_version = p.training_version)", "(p.status IN ('active', 'pending') AND f.training_version = p.training_version)", 2)
f = rep(f, "SELECT p.agency_id, p.virtual_office_id, p.client_id, NULL, (p.status = 'active')", "SELECT p.agency_id, p.virtual_office_id, p.client_id, NULL, (p.status IN ('active', 'pending'))")
out['cp_attachment_parent'] = f

# -- start_pending_plan_version: renew_care_plan's copy, but the new version is PENDING and the old one stays active
f = body('renew_care_plan')
f = rep(f, "CREATE OR REPLACE FUNCTION public.renew_care_plan(", "CREATE FUNCTION public.start_pending_plan_version(")
f = rep(f, "  IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be renewed' USING ERRCODE = '22023'; END IF;",
        "  IF p.status <> 'active' THEN RAISE EXCEPTION 'A new version starts from the active plan' USING ERRCODE = '22023'; END IF;\n"
        "  IF EXISTS (SELECT 1 FROM public.care_plans WHERE client_id = p.client_id AND status = 'pending') THEN\n"
        "    RAISE EXCEPTION 'A new IPOS version is already pending for this client' USING ERRCODE = '22023';\n"
        "  END IF;")
f = rep(f, "  UPDATE public.care_plans SET status = 'superseded' WHERE id = p.id;\n", "")
f = rep(f, "VALUES (p.agency_id, p.virtual_office_id, p.client_id, v_version, v_tv, 'active', COALESCE(_plan_type, 'annual'),",
        "VALUES (p.agency_id, p.virtual_office_id, p.client_id, v_version, v_tv, 'pending', COALESCE(_plan_type, 'annual'),")
f = rep(f, "  -- copy children forward for editing (history stays on the superseded row)", "  -- copy children forward for editing (the active version keeps its own)")
f = rep(f, "    jsonb_build_object('care_plan_id', v_new, 'previous_care_plan_id', p.id, 'version', v_version, 'training_version', v_tv));",
        "    jsonb_build_object('care_plan_id', v_new, 'previous_care_plan_id', p.id, 'version', v_version, 'training_version', v_tv, 'pending', true));")
start_pending = f

EV = open(os.path.join(REPO, r'supabase\migrations\20261028120000_s4b_attachments.sql'), encoding='utf-8').read()
i = EV.index('ALTER TABLE public.events'); j = EV.index(']::text[]));', i) + len(']::text[]));')
ev_before = EV[i:j]
ev_after = rep(ev_before, "  'attachment_added', 'attachment_removed', 'attachment_viewed'\n]::text[]));",
               "  'attachment_added', 'attachment_removed', 'attachment_viewed',\n  -- S17: IPOS versions\n  'care_plan_activated', 'care_plan_revised'\n]::text[]));")

sig = {n: f"public.{n}({defs[n]['a']})" for n in defs}
def sigtypes(n):
    # identity arguments without names, for REVOKE / GRANT / DROP
    args = defs[n]['a']
    parts = [x.strip() for x in args.split(',')] if args else []
    types = []
    for x in parts:
        if x.startswith('OUT '):
            continue
        types.append(' '.join(x.split()[1:]))
    return f"public.{n}({', '.join(types)})"

CHANGED = ['update_care_plan_fields', 'upsert_care_plan_goals', 'set_objective_measures', 'set_care_plan_rows', 'would_bump_training_version',
           'record_inservice_form', 'record_training_form', 'add_training_attendees', 'get_client_training_context', 'cp_attachment_parent']
head = """-- S17 — IPOS versions: pending -> active, revisions, shift creation limits, expiry warnings.
-- Design docs/design/s17-ipos-effective-and-revisions.md; owner approval + decisions Oct 21 (1a-1d, 2, 5).
-- Needs 20261029120000 (care_plan_status 'pending').
--
-- New: care_plans.revision, plan_training_records.plan_revision, care_plan_revisions (+RLS, read manager / agency admin),
--   one pending version per client (unique index), start_pending_plan_version (renew_care_plan's copy, the new version is
--   PENDING; refused when one is already pending), cp_try_activate_plan / cp_activate_due_plans (pending -> active when
--   the in-service is signed and a training session has attendees, on its effective date; the old version superseded in
--   the same transaction), revisions of the ACTIVE version (cp_plan_snapshot / cp_revision_baseline /
--   cp_record_revision; rev 0 at activation; a no-change save doesn't bump), the shift trigger cp_guard_shift_dates
--   (1a: no visit after the active IPOS's expiration date; 1d: CLS / respite not after the client's latest authorization
--   end date; every writer, regardless of the enforcement switch; inserts and moves only), get_shift_creation_limits
--   (series screens), list_ipos_expiry (1c warnings).
-- Changed (existing functions, approved; same signatures, CREATE OR REPLACE, grants re-stated; bodies = DEV's + the
--   marked S17 lines): update_care_plan_fields, upsert_care_plan_goals, set_objective_measures, set_care_plan_rows
--   (accept pending; revisions), would_bump_training_version + upsert_care_plan_goals (a pending version never bumps),
--   record_inservice_form, record_training_form, add_training_attendees (accept pending; plan_revision; activation),
--   get_client_training_context (the pending version when there is one; 'in_effect'; plan_revision),
--   cp_attachment_parent (S4b: files on a pending version).
-- events CHECK: the 55 values of 20261028120000 + care_plan_activated, care_plan_revised.
-- Unchanged: renew_care_plan, notes (create_progress_note_for_shift), eligibility (cp_eligibility_core,
--   cp_shift_client_context), every assign / trade / pickup function.

"""
parts = [head, ev_after, "\n\n", new_sql, "\n-- =============================================================================================\n-- 6. start_pending_plan_version\n-- =============================================================================================\n",
         start_pending,
         "REVOKE ALL ON FUNCTION public.start_pending_plan_version(uuid, care_plan_type, jsonb, jsonb) FROM PUBLIC, anon;\n",
         "GRANT EXECUTE ON FUNCTION public.start_pending_plan_version(uuid, care_plan_type, jsonb, jsonb) TO authenticated;\n",
         "\n-- =============================================================================================\n-- 7. Existing functions (approved changes)\n-- =============================================================================================\n"]
for n in CHANGED:
    parts.append(out[n])
    if n == 'cp_attachment_parent':
        parts.append(f"REVOKE ALL ON FUNCTION {sigtypes(n)} FROM PUBLIC, anon, authenticated;\n\n")
    else:
        parts.append(f"REVOKE ALL ON FUNCTION {sigtypes(n)} FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION {sigtypes(n)} TO authenticated;\n\n")
mig = ''.join(parts)
open(os.path.join(REPO, r'supabase\migrations\20261029120100_s17_ipos_versions.sql'), 'w', encoding='utf-8', newline='\n').write(mig)

rb = ["""-- Rollback of 20261029120100_s17_ipos_versions.sql (S17). Restores the 10 changed functions to DEV's bodies before the
-- push (byte-identical), drops what S17 added and restores the events CHECK of 20261028120000. Stops (nothing changed)
-- while a pending version exists or S17 audit events exist. The 'pending' enum value of 20261029120000 stays (it can't
-- be dropped in place; unused once no row has it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.care_plans WHERE status::text = 'pending') THEN
    RAISE EXCEPTION 'A pending plan version exists; activate or delete it first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE event_type IN ('care_plan_activated', 'care_plan_revised')) THEN
    RAISE EXCEPTION 'S17 audit events exist; delete them first (they reference plans only)';
  END IF;
END $$;

DROP TRIGGER trg_cp_guard_shift_dates ON public.shifts;
DROP FUNCTION public.cp_guard_shift_dates();
DROP FUNCTION public.get_shift_creation_limits(uuid);
DROP FUNCTION public.cp_shift_creation_limits(uuid, uuid);
DROP FUNCTION public.list_ipos_expiry(uuid, uuid);
DROP FUNCTION public.start_pending_plan_version(uuid, care_plan_type, jsonb, jsonb);
DROP FUNCTION public.cp_activate_due_plans();
DROP FUNCTION public.cp_try_activate_plan(uuid);
"""]
for n in CHANGED:
    rb.append(body(n))
    if n == 'cp_attachment_parent':
        rb.append(f"REVOKE ALL ON FUNCTION {sigtypes(n)} FROM PUBLIC, anon, authenticated;\n")
    else:
        rb.append(f"REVOKE ALL ON FUNCTION {sigtypes(n)} FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION {sigtypes(n)} TO authenticated;\n")
rb.append("""DROP FUNCTION public.cp_record_revision(uuid);
DROP FUNCTION public.cp_revision_baseline(uuid);
DROP FUNCTION public.cp_plan_snapshot(uuid);
DROP TABLE public.care_plan_revisions;
ALTER TABLE public.plan_training_records DROP COLUMN plan_revision;
DROP INDEX public.one_pending_plan_per_client;
ALTER TABLE public.care_plans DROP COLUMN revision;

""" + ev_before + "\n")
open(os.path.join(REPO, r'docs\rollback\s17_ipos_versions_rollback.sql'), 'w', encoding='utf-8', newline='\n').write(''.join(rb))
json.dump({n: defs[n]['h'] for n in CHANGED}, open(os.path.join(SP, 's17_md5.json'), 'w'))
print("migration", len(mig), "chars; rollback ok;", {n: sigtypes(n) for n in CHANGED})
