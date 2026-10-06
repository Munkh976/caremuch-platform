// Ripple care-plan module — Phase B2 (progress notes, reviews, weekly billing, real concurrency C1).
// Usage: node tests/ripple/dev/phase-b2.cjs <after|before>
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, URL_, ANON, LABEL, RUN, SUFFIX, admin, opts, createClient, fs, path, BASELINE, ids, rows, log, rec, pass, ins, mkUser,
  dbNow, reportSkew, pgRead, setup, noBreak, checkNoBreak, DENY, setupB1, rpc, evIds, eventsSince, dbDay, teardownB1, teardown,
  teardownB2, closeDb, summary } = require("./lib.cjs");

const B2_RPCS = ["create_progress_note_for_shift", "get_progress_note_for_caregiver", "save_progress_note_draft", "submit_progress_note",
  "return_progress_note", "review_progress_note", "void_progress_note", "list_overdue_notes", "build_billing_batch", "get_billing_batch",
  "approve_batch_notes", "approve_clean_rows", "mark_batch_billed"];
const B2_INTERNAL = ["cp_guard_billed_note", "cp_guard_billed_note_entry", "cp_is_assigned_caregiver", "cp_objective_measures",
  "cp_validate_answer", "cp_validate_entry_data", "cp_guard_billed_batch", "cp_approve_batch"];

async function beforeB2(F) {
  const st = await pgRead(async (c) => ({
    rpcs: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [B2_RPCS])).rows[0].n,
    internal: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [B2_INTERNAL])).rows[0].n,
    cols: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='progress_notes'
                          AND column_name IN ('service_type','due_at','late_submitted','returned_count','non_billable_reason','batch_approved_at','batch_approved_by')`)).rows[0].n,
    authNotNull: (await c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='progress_notes' AND column_name='authorization_id'`)).rows[0].is_nullable,
    notes: (await c.query(`SELECT count(*)::int n FROM public.progress_notes`)).rows[0].n,
    batches: (await c.query(`SELECT count(*)::int n FROM public.billing_batches`)).rows[0].n,
    nullAuth: (await c.query(`SELECT count(*)::int n FROM public.progress_notes WHERE authorization_id IS NULL`)).rows[0].n,
    eventTypes: (await c.query(`SELECT count(*)::int n FROM regexp_matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='events_event_type_check'), 'progress_note_|billing_batch_', 'g')`)).rows[0].n,
  }));
  rec("B0 B2 objects absent before push", pass(st.rpcs === 0 && st.internal === 0 && st.cols === 0 && st.authNotNull === "NO"),
    `RPCs ${st.rpcs}/13, helpers ${st.internal}/8, new note columns ${st.cols}/7, authorization_id nullable=${st.authNotNull}`);
  rec("B0b pre-flight: B2 event types already allowed (B1-01); progress_notes/billing_batches empty, so the ALTERs are safe", pass(st.eventTypes === 8 && st.notes === 0 && st.batches === 0 && st.nullAuth === 0),
    `B2 event types in the constraint ${st.eventTypes}/8; notes ${st.notes}; batches ${st.batches}`);
  const r = await rpc(F.cg.c, "create_progress_note_for_shift", { _shift_id: F.shifts[0] });
  rec("B0c B2 RPCs not callable before push", pass(!!r.err), r.err || "callable");
  // the current state the B2 RPCs replace: no caregiver path to notes at all (Phase A: no caregiver policy)
  const { data: cgNotes, error: cgErr } = await F.cg.c.from("progress_notes").select("id").limit(1);
  rec("B0d caregivers have no direct note access (Phase A), the RPCs will be their only path", pass(!!cgErr || (cgNotes || []).length === 0), cgErr ? cgErr.message : `${cgNotes.length} rows`);
}

async function setupB2(F) {
  // second caregiver with a login (for "another caregiver's note"), respite clients, B1 data via RPCs
  F.cg2 = await mkUser("cg2", "caregiver", A);
  await admin.from("caregivers").update({ user_id: F.cg2.id }).eq("id", F.GX2);
  const cl = (tag) => ({ agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `${tag} ${RUN}`, phone: "555-0175", address: "2 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  [F.CR1, F.CR2, F.CR3] = await ins("clients", [cl("CR1"), cl("CR2"), cl("CR3")]);
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(300) } });
  await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [
    { seq: 1, goal_text: "Goal one", objectives: [{ letter: "A", seq: 1, objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" },
                                                  { letter: "B", seq: 2, objective_text: "CM follow-up", responsible_party: "case_management" }] }] });
  F.objA = (await admin.from("care_plan_objectives").select("id, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", F.plan).eq("responsible_party", "this_agency").single()).data.id;
  const { data: mts } = await admin.from("measure_types").select("id, kind").is("agency_id", null);
  F.mt = Object.fromEntries(mts.map((m) => [m.kind, m.id]));
  await must(F.mgrX.c, "set_objective_measures", { _objective_id: F.objA, _measures: [{ measure_type_id: F.mt.yes_no_na, prompt_text: "Participated?" }, { measure_type_id: F.mt.tally, prompt_text: "Interactions" }] });
  const AU = (client, svc, num, units, from, to) => ({ _client_id: client, _service_type: svc, _auth_number: `${num}-${RUN}`, _units_authorized: units, _effective_date: from, _expiration_date: to });
  F.early = await must(F.mgrX.c, "create_service_authorization", AU(F.CX, "cls", "EARLY", 8, await dbDay(-60), await dbDay(10)));
  F.late = await must(F.mgrX.c, "create_service_authorization", AU(F.CX, "cls", "LATE", 40, await dbDay(-60), await dbDay(60)));
  F.race = await must(F.mgrX.c, "create_service_authorization", AU(F.CR3, "respite", "RACE", 4, await dbDay(-60), await dbDay(60)));
  // shifts.caregiver_id is derived from shift_assignments (trigger), and direct assignment inserts are
  // refused: fixtures are assigned through the real assign_caregiver_to_shift RPC. The live engine
  // hard-blocks one caregiver on overlapping shifts (double_booked), so the respite shifts use
  // separate times on DEV (see the B2 report: R1 group sessions vs double_booked).
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }, { caregiver_id: F.GX2, care_type_code: "CLS0001", is_demo: true }]);
  const sh = async (client, cg, code, off, start, end) => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: client, order_title: `ZZ ${RUN}`,
      care_type_code: code, shift_date: await dbDay(off), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    if (cg) { const r = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: cg, _method: "manual", _notes: "B2 fixture", _override_reason: "B2 fixture (disposable)" });
      if (r.err) throw new Error(`assign fixture ${start}: ${r.err}`); }
    return id;
  };
  F.b2 = { S1: await sh(F.CX, F.G, "CLS0001", -1, "13:00", "14:00"), S2: await sh(F.CX, F.G, "CLS0001", -1, "15:00", "16:00"),
    S3: await sh(F.CX, F.G, "CLS0001", -2, "09:00", "10:00"), S4: await sh(F.CX, F.G, "CLS0001", -3, "09:00", "10:00"),
    R1: await sh(F.CR1, F.G, "RESP0001", -1, "07:00", "08:00"), R2: await sh(F.CR2, F.G, "RESP0001", -1, "08:30", "09:30"), R3: await sh(F.CR3, F.G, "RESP0001", -1, "10:00", "11:00"),
    RX: await sh(F.CR3, F.G, "RESP0001", -1, "11:30", "12:30"), S6: await sh(F.CX, F.G, "CLS0001", 1, "09:00", "10:00"),
    S7: await sh(F.CX, null, "CLS0001", -1, "17:00", "18:00"), S8: await sh(F.CX, F.G, "CLS0001", -4, "09:00", "10:00"), S9: await sh(F.CX, F.GX2, "CLS0001", -1, "18:00", "19:00") };
  return F;
}

async function afterB2(F) {
  const audit = []; const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const audited = async (step, c, fn, args, expType, subjOf) => {
    const t = await dbNow(); const r = await rpc(c, fn, args);
    const subj = subjOf ? subjOf(r) : (typeof r.v === "string" && uuidRe.test(r.v) ? r.v : Object.values(args)[0]);
    const { data: evs } = await admin.from("events").select("id, event_type, payload").eq("subject_id", subj).gte("created_at", t);
    (evs || []).forEach((e) => evIds.add(e.id)); const mine = (evs || []).filter((e) => e.event_type === expType);
    audit.push({ step, ok: (expType ? mine.length === 1 && evs.length === 1 : (evs || []).length === 0)
      && (evs || []).every((e) => Object.values(e.payload).every((x) => typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && uuidRe.test(x)))), n: (evs || []).length });
    return r;
  };
  const note = async (id) => (await admin.from("progress_notes").select("*").eq("id", id).single()).data;
  const avail = async (id) => Number((await admin.from("service_authorizations").select("units_available").eq("id", id).single()).data.units_available);
  const plus = (n, sec) => new Date(Date.parse(n.scheduled_start) + sec * 1000).toISOString();
  const ms = (await admin.from("objective_measures").select("id, seq").eq("objective_id", F.objA).order("seq")).data.map((m) => m.id);
  const data = () => ({ [ms[0]]: { value: "N/A" }, [ms[1]]: { count: 3 } });
  const fill = async (key, sec) => { const id = (await rpc(F.cg.c, "create_progress_note_for_shift", { _shift_id: F.b2[key] })).v; const n = await note(id);
    const { data: es } = await admin.from("progress_note_entries").select("id").eq("progress_note_id", id);
    const s = await rpc(F.cg.c, "save_progress_note_draft", { _note_id: id, _header: { client_arrived_at: plus(n, sec) }, _entries: es.map((e) => ({ entry_id: e.id, data: data() })) });
    if (s.err) log("fill", key, s.err); return id; };
  // happy path
  const c1 = await audited("create", F.cg.c, "create_progress_note_for_shift", { _shift_id: F.b2.S1 }, "progress_note_created");
  const c1b = await audited("create again", F.cg.c, "create_progress_note_for_shift", { _shift_id: F.b2.S1 }, null, () => c1.v);
  const view = (await rpc(F.cg.c, "get_progress_note_for_caregiver", { _note_id: c1.v })).v;
  const NOTE_KEYS = "actual_end,arrived_late,client_arrived_at,client_first_name,client_last_initial,due_at,id,late_submitted,location,narrative_text,note_kind,returned_reason,scheduled_end,scheduled_start,service_date,staff_client_ratio,staff_signature_name,staff_signed_at,status";
  const keysOk = view && Object.keys(view).sort().join(",") === "entries,note" && Object.keys(view.note).sort().join(",") === NOTE_KEYS
    && view.entries.every((e) => Object.keys(e).sort().join(",") === "answers,entry_id,goal_text,measures,notes_text,objective_letter,objective_text,staff_instructions"
      && e.measures.every((m) => Object.keys(m).sort().join(",") === "kind,measure_id,options,prompt_text,trial_count"));
  rec("N1/N2 create (idempotent, CM objective excluded) + caregiver payload exact keys", pass(!c1.err && c1b.v === c1.v && keysOk && view.entries.length === 1),
    `${c1.err || "ok"}; same id ${c1b.v === c1.v}; entries ${view && view.entries.length}; keys exact ${keysOk}`);
  const n1 = await note(c1.v); const { data: e1 } = await admin.from("progress_note_entries").select("id").eq("progress_note_id", c1.v);
  await rpc(F.cg.c, "save_progress_note_draft", { _note_id: c1.v, _header: { client_arrived_at: plus(n1, 0) }, _entries: [{ entry_id: e1[0].id, data: data() }] });
  const sub = await audited("submit", F.cg.c, "submit_progress_note", { _note_id: c1.v, _typed_signature: "Fixture Caregiver" }, "progress_note_submitted");
  const rv = await audited("review", F.mgrX.c, "review_progress_note", { _note_id: c1.v, _billable: true }, "progress_note_reviewed", () => c1.v);
  rec("N4 submit + review FIFO (earliest-expiring authorization)", pass(!sub.err && !rv.err && (await note(c1.v)).authorization_id === F.early && (await avail(F.early)) === 4),
    `submit ${sub.err || "ok"}; review ${rv.err || "ok"}; EARLY left ${await avail(F.early)}`);
  // boundary + rollover
  const n2 = await fill("S2", 59); await rpc(F.cg.c, "submit_progress_note", { _note_id: n2, _typed_signature: "x" });
  const n3 = await fill("S3", 60); await rpc(F.cg.c, "submit_progress_note", { _note_id: n3, _typed_signature: "x" });
  await rpc(F.mgrX.c, "review_progress_note", { _note_id: n2, _billable: true }); const r3 = await rpc(F.mgrX.c, "review_progress_note", { _note_id: n3, _billable: true });
  const N2 = await note(n2), N3 = await note(n3);
  rec("N6 +0:59 -> 4 not late; +1:00 -> 3 late (no grace period, Oct 6); FIFO rolls to the later authorization once the earliest is exhausted",
    pass(Number(N2.units_used) === 4 && !N2.arrived_late && Number(N3.units_used) === 3 && N3.arrived_late && N2.authorization_id === F.early && N3.authorization_id === F.late && !r3.err),
    `+0:59 ${N2.units_used}/${N2.arrived_late}; +1:00 ${N3.units_used}/${N3.arrived_late}; S2 -> ${N2.authorization_id === F.early ? "EARLY" : "?"} (EARLY now ${await avail(F.early)}), S3 -> ${N3.authorization_id === F.late ? "LATE" : "?"}`);
  // concurrency: two reviews race for the last units of one authorization (RACE: 4 units; two 4-unit respite notes)
  const ra = await fill("R3", 0), rb = await fill("RX", 0);
  for (const id of [ra, rb]) { await rpc(F.cg.c, "save_progress_note_draft", { _note_id: id, _narrative_text: "Calm session" }); await rpc(F.cg.c, "submit_progress_note", { _note_id: id, _typed_signature: "x" }); }
  const [x1, x2] = await Promise.all([rpc(F.mgrX.c, "review_progress_note", { _note_id: ra, _billable: true }), rpc(F.mgrAll.c, "review_progress_note", { _note_id: rb, _billable: true })]);
  const okCount = [x1, x2].filter((r) => !r.err).length;
  rec("C1 concurrency: two reviews racing for the last units of one authorization -> exactly one succeeds, the other is refused with the units reason",
    pass(okCount === 1 && [x1, x2].some((r) => /not enough authorized units/.test(r.err || "")) && (await avail(F.race)) === 0),
    `succeeded ${okCount}; refusal "${([x1, x2].find((r) => r.err) || {}).err || "none"}"; RACE left ${await avail(F.race)}`);
  // respite refusals + group
  const rr = {}; for (const k of ["R1", "R2"]) { rr[k] = await fill(k, 0); await rpc(F.cg.c, "save_progress_note_draft", { _note_id: rr[k], _narrative_text: "Walk" }); await rpc(F.cg.c, "submit_progress_note", { _note_id: rr[k], _typed_signature: "x" }); }
  const v1 = await rpc(F.mgrX.c, "review_progress_note", { _note_id: rr.R1, _billable: true });
  rec("N7 three clients' respite shifts -> 3 separate notes (DEV: separate times, the engine blocks overlap); no authorization -> clear refusal, note stays submitted",
    pass(new Set([rr.R1, rr.R2, ra]).size === 3 && /no authorization/.test(v1.err || "") && (await note(rr.R1)).status === "submitted"), v1.err || "accepted");
  // caregiver rules
  const fut = await rpc(F.cg.c, "create_progress_note_for_shift", { _shift_id: F.b2.S6 }), un = await rpc(F.cg.c, "create_progress_note_for_shift", { _shift_id: F.b2.S7 });
  const n9 = (await rpc(F.mgrX.c, "create_progress_note_for_shift", { _shift_id: F.b2.S9 })).v;
  const oth = await rpc(F.cg.c, "get_progress_note_for_caregiver", { _note_id: n9 });
  rec("N8 caregiver: opens at shift start; unassigned shift and another caregiver's note -> generic refusal",
    pass(/opens when the shift starts/.test(fut.err || "") && DENY.test(un.err || "") && DENY.test(oth.err || "")), `future ${fut.err ? "refused" : "accepted"}; unassigned ${un.err ? "refused" : "accepted"}; other's note ${oth.err ? "refused" : "accepted"}`);
  // overdue at the office-zone boundary
  const n8 = await note((await rpc(F.cg.c, "create_progress_note_for_shift", { _shift_id: F.b2.S8 })).v);
  const lst = async (asOf) => ((await rpc(F.mgrX.c, "list_overdue_notes", { _office_id: F.OX, _as_of: asOf })).v || []).map((x) => x.note_id);
  const before = await lst(new Date(Date.parse(n8.due_at) - 60000).toISOString()), atB = await lst(n8.due_at);
  const localDue = await pgRead(async (c) => (await c.query(`SELECT ($1::timestamptz AT TIME ZONE 'America/New_York')::text a, (($2::date + 2)::text || ' 00:00:00') e`, [n8.due_at, n8.service_date])).rows[0]);
  rec("N10 overdue at DB time in the office zone: 23:59 day-after not overdue, 00:00 second day overdue", pass(localDue.a === localDue.e && !before.includes(n8.id) && atB.includes(n8.id)),
    `deadline local ${localDue.a}; 23:59 listed ${before.includes(n8.id)}; 00:00 listed ${atB.includes(n8.id)}`);
  // void, billing, billed immutability
  const vd = await audited("void", F.mgrX.c, "void_progress_note", { _note_id: n3, _reason: "Wrong shift" }, "progress_note_voided", () => n3);
  rec("N9 void restores units", pass(!vd.err && (await avail(F.late)) === 40), `LATE ${await avail(F.late)}`);
  const wk = await pgRead(async (c) => (await c.query(`SELECT date_trunc('week', $1::date)::date::text w`, [await dbDay(-1)])).rows[0].w);
  const bb = await audited("build", F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: wk }, "billing_batch_built", (r) => r.v && r.v.batch_id);
  const batch = bb.v && bb.v.batch_id; (ids.billing_batches = ids.billing_batches || []).push(batch);
  const ap = await audited("approve clean", F.mgrX.c, "approve_clean_rows", { _batch_id: batch }, "billing_batch_approved");
  const { data: inBatch } = await admin.from("progress_notes").select("id, batch_approved_at").eq("billing_batch_id", batch);
  const rest = inBatch.filter((x) => !x.batch_approved_at).map((x) => x.id);
  if (rest.length) await audited("approve rest", F.mgrX.c, "approve_batch_notes", { _batch_id: batch, _note_ids: rest }, "billing_batch_approved", () => batch);
  const bl = await audited("bill", F.mgrX.c, "mark_batch_billed", { _batch_id: batch }, "billing_batch_billed");
  const imm = [await rpc(F.mgrX.c, "void_progress_note", { _note_id: c1.v, _reason: "x" }), await rpc(F.mgrX.c, "return_progress_note", { _note_id: c1.v, _reason: "x" }),
    await rpc(F.mgrX.c, "review_progress_note", { _note_id: c1.v, _billable: true }), await rpc(F.cg.c, "save_progress_note_draft", { _note_id: c1.v })];
  rec("N11/N12 batch -> approve (clean + rest) -> billed; a billed note can't be voided, returned, re-reviewed or edited",
    pass(!bb.err && inBatch.some((x) => x.id === c1.v) && !bl.err && (await note(c1.v)).status === "billed" && imm.every((r) => !!r.err)),
    `included ${inBatch.length}; clean approved ${ap.v && ap.v.approved}; billed ${bl.err || "ok"}; billed-note actions refused ${imm.filter((r) => r.err).length}/4`);
  // denials
  const anon = createClient(URL_, ANON, opts); const calls = {
    create_progress_note_for_shift: { _shift_id: F.b2.S2 }, get_progress_note_for_caregiver: { _note_id: c1.v }, save_progress_note_draft: { _note_id: rr.R2 },
    submit_progress_note: { _note_id: rr.R2, _typed_signature: "x" }, return_progress_note: { _note_id: rr.R2, _reason: "x" },
    review_progress_note: { _note_id: rr.R2, _billable: true }, void_progress_note: { _note_id: rr.R2, _reason: "x" }, list_overdue_notes: { _office_id: F.OX },
    build_billing_batch: { _office_id: F.OX, _week_start: wk }, get_billing_batch: { _batch_id: batch }, approve_batch_notes: { _batch_id: batch, _note_ids: [c1.v] },
    approve_clean_rows: { _batch_id: batch }, mark_batch_billed: { _batch_id: batch } };
  const leaks = []; let n = 0;
  for (const [fn, args] of Object.entries(calls)) for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    const r = await rpc(c, fn, args); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${label}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
  rec("D1 every B2 RPC refused for scheduler, hr_staff, client, anon, office-Y manager, agency-B admin, system_admin", pass(leaks.length === 0), leaks.length ? leaks.join("; ") : `${n} denied calls refused`);
  const badA = audit.filter((a) => !a.ok);
  rec("A1 exactly one correlated event per audited write (by subject id + type, DB-clock window)", pass(badA.length === 0), badA.length ? JSON.stringify(badA) : `${audit.length} audited calls`);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [[...B2_RPCS, ...B2_INTERNAL]])).rows);
  const badAcl = acl.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g) || (B2_RPCS.includes(f.proname) ? !(f.d && /authenticated/.test(f.g)) : /authenticated/.test(f.g)));
  rec("ACL every B2 function", pass(acl.length === 21 && badAcl.length === 0), `${acl.length}/21; offending ${badAcl.map((f) => f.proname).join(", ") || "none"}`);
}

(async () => {
  log(`=== Ripple Phase B2 tests — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    log(`fixtures [${RUN}]: Phase A/B1 fixture set (disposable agency B, offices X/Y/Z, staff of every role, caregiver + client logins)`);
    await checkNoBreak(F);
    if (LABEL === "before") await beforeB2(F); else { await setupB2(F); await afterB2(F); }
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    await teardownB2(F); await teardownB1(F);
    if (ids.caregiver_certifications) for (const id of ids.caregiver_certifications) await admin.from("caregiver_certifications").delete().eq("id", id);
    await teardown(F);
    if (F) {
      const left = await pgRead(async (c) => (await c.query(`SELECT
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR agency_id = $2::uuid)::int ev,
        (SELECT count(*) FROM public.progress_notes WHERE virtual_office_id = ANY($1::uuid[]))::int notes,
        (SELECT count(*) FROM public.billing_batches WHERE virtual_office_id = ANY($1::uuid[]))::int batches,
        (SELECT count(*) FROM public.shifts WHERE virtual_office_id = ANY($1::uuid[]))::int shifts,
        (SELECT count(*) FROM auth.users WHERE email LIKE $3)::int users`, [[F.OX, F.OY, F.OZ], F.B, "%" + SUFFIX])).rows[0]);
      log(`B2 teardown re-query: events ${left.ev}, notes ${left.notes}, batches ${left.batches}, shifts ${left.shifts}, users ${left.users} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`);
    }
    await closeDb();
  }
  summary();
})();
