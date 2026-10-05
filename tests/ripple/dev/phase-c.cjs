// Ripple care-plan module — Phase C (group sessions, compliance rules in eligibility, projected units, opening balance, period caps, real concurrency CC).
// Usage: node tests/ripple/dev/phase-c.cjs <after|before>
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, URL_, ANON, LABEL, RUN, SUFFIX, admin, opts, createClient, fs, path, BASELINE, ids, rows, log, rec, pass, ins, mkUser,
  dbNow, reportSkew, pgRead, setup, noBreak, checkNoBreak, DENY, setupB1, rpc, evIds, eventsSince, dbDay, teardownB1, teardown,
  teardownB2, closeDb, summary } = require("./lib.cjs");

const C_NEW = ["cp_shift_units", "cp_projected_units", "cp_shift_client_context", "cp_lock_client_authorizations", "cp_eligibility_core",
  "cp_period_window", "cp_period_left", "cp_safe_issue_list", "cp_caregiver_safe_eligibility", "cp_guard_shift_group_session",
  "create_group_session", "set_shift_group_session", "list_caregivers_needing_retraining"];
const C_RPCS = ["create_group_session", "set_shift_group_session", "list_caregivers_needing_retraining"];
const C_CHANGED = ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "assign_caregiver_to_shift", "check_caregiver_shifts_eligibility",
  "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "create_progress_note_for_shift",
  "review_progress_note", "guard_virtual_office_flags", "cp_derive_authorization_units"];
const C_SIG_FILE = path.join(BASELINE, "phase_c_sig_before.json");
const sigAcl = (c) => c.query(`SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||') definer='||p.prosecdef||' EXECUTE: '||
    COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') s
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [C_CHANGED]).then((r) => r.rows.map((x) => x.s));

async function beforeC(F) {
  const st = await pgRead(async (c) => ({
    fns: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [C_NEW])).rows[0].n,
    tbl: (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='group_sessions'`)).rows[0].n,
    cols: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND ((table_name='shifts' AND column_name='group_session_id') OR (table_name='virtual_office' AND column_name IN ('group_session_max_clients','care_plan_module_enabled_at')) OR (table_name='service_authorizations' AND column_name='units_used_before_caremuch'))`)).rows[0].n,
    ev: (await c.query(`SELECT count(*)::int n FROM regexp_matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='events_event_type_check'), '''[a-z_]+''', 'g')`)).rows[0].n,
    flags: (await c.query(`SELECT count(*)::int n FROM public.virtual_office WHERE (compliance_enforcement_enabled OR care_plan_module_enabled) AND name NOT LIKE 'ZZ %'`)).rows[0].n,
    csa: (await c.query(`SELECT string_agg(pronargs::text, ',') s FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='create_service_authorization'`)).rows[0].s,
    sig: await sigAcl(c),
    cr: (await c.query(`SELECT string_agg(proname||' md5 '||md5(prosrc), '; ' ORDER BY proname) s FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1) AND position(chr(13) in prosrc) > 0`, [C_CHANGED])).rows[0].s,
  }));
  rec("B0 Phase C objects absent before push", pass(st.fns === 0 && st.tbl === 0 && st.cols === 0 && st.ev === 42 && st.csa === '14'),
    `new functions ${st.fns}/${C_NEW.length}, group_sessions ${st.tbl}, new columns ${st.cols}/4, event types ${st.ev} (exp 42), create_service_authorization argument counts ${st.csa}`);
  rec("B0b pre-flight: no real office has the care-plan module or enforcement on (Phase C changes nothing on real data until an admin turns it on)", pass(st.flags === 0), `offices with a flag on: ${st.flags}`);
  rec("B0e the 10 replaced functions: signatures + EXECUTE grants recorded for the after-run", pass(st.sig.length === 10), st.sig.join(" | "));
  fs.writeFileSync(C_SIG_FILE, JSON.stringify(st.sig, null, 1));
  log(`   stored bodies with CR characters (the rollback restores these byte-for-byte): ${st.cr || "none"}`);
  // today's double_booked behaviour (the baseline the group exemption must not weaken)
  const a1 = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: F.shifts[4], _caregiver_id: F.G, _method: "manual", _notes: "C before", _override_reason: "C before (fixture)" });
  const { data: s4 } = await admin.from("shifts").select("shift_date, start_time, end_time").eq("id", F.shifts[4]).single();
  const ov = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001",
    shift_date: s4.shift_date, start_time: s4.start_time, end_time: s4.end_time, duration_hours: 1, status: "open", is_demo: true });
  F.shifts.push(ov);
  const a2 = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: ov, _caregiver_id: F.G, _method: "manual", _notes: "C before", _override_reason: "C before (fixture)" });
  rec("B0c today: the same caregiver on an overlapping shift is refused (double_booked)", pass(!a1.err && /Overlaps a shift/.test(a2.err || "")), `first ${a1.err || "assigned"}; overlapping: ${(a2.err || "accepted").slice(0, 70)}`);
  const r = await rpc(F.mgrAll.c, "create_group_session", { _office_id: F.OX, _session_date: s4.shift_date, _start_time: s4.start_time, _end_time: s4.end_time, _staff_client_ratio: null, _max_clients: null });
  rec("B0d Phase C RPCs not callable before push", pass(!!r.err), r.err || "callable");
}

// ---------------------------------------------------------------------------------------------
async function afterC(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const audit = [];
  const audited = async (step, c, fn, args, expType, subj) => {   // one event per successful write, none for a refused one
    const t = await dbNow(); const r = await rpc(c, fn, args);
    const s = subj || (typeof r.v === "string" && uuidRe.test(r.v) ? r.v : null);
    const evs = s ? ((await admin.from("events").select("id, event_type, payload").eq("subject_id", s).gte("created_at", t)).data || []) : [];
    evs.forEach((e) => evIds.add(e.id));
    const want = r.err ? 0 : 1;
    audit.push({ step, ok: evs.length === want && evs.every((e) => e.event_type === expType)
      && evs.every((e) => Object.values(e.payload).every((x) => typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && uuidRe.test(x)))), n: evs.length, refused: !!r.err });
    return r;
  };
  const ASSIGN = (c, s, g, m = "manual") => rpc(c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: m, _notes: "C after", _override_reason: null });
  const elig = async (s, g) => (await rpc(F.mgrX.c, "check_assignment_eligibility", { _shift_id: s, _caregiver_id: g })).v;
  const hard = async (s, g) => ((await elig(s, g)).hard || []).map((x) => x.code).sort().join(",");
  const proj = (s) => pgRead(async (c) => (await c.query(`SELECT public.cp_shift_client_context($1) -> 'proj' p`, [s])).rows[0].p);
  const cl = (tag) => ({ agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `${tag} ${RUN}`, phone: "555-0176", address: "3 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  const cgv = async (tag) => { const id = await ins("caregivers", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `${tag} ${RUN}`, email: `sec-${tag.toLowerCase()}${SUFFIX}`, phone: "555-0177", is_demo: true });
    await ins("caregiver_skills", { caregiver_id: id, care_type_code: "CLS0001", is_demo: true }); return id; };
  const sh = async (client, off, start, end) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: client, order_title: `ZZ ${RUN}`,
    care_type_code: "CLS0001", shift_date: await dbDay(off), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    F.shifts.push(id); return id; };
  F.cClients = []; F.cCaregivers = [];

  // ---- C0 catalog, signatures, grants ----
  const st = await pgRead(async (c) => ({
    fns: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [C_NEW])).rows[0].n,
    tbl: (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='group_sessions'`)).rows[0].n,
    cols: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND ((table_name='shifts' AND column_name='group_session_id') OR (table_name='virtual_office' AND column_name IN ('group_session_max_clients','care_plan_module_enabled_at')) OR (table_name='service_authorizations' AND column_name='units_used_before_caremuch'))`)).rows[0].n,
    ev: (await c.query(`SELECT count(*)::int n FROM regexp_matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='events_event_type_check'), '''[a-z_]+''', 'g')`)).rows[0].n,
    evC: (await c.query(`SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='events_event_type_check') ~ 'group_session_created' AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='events_event_type_check') ~ 'shift_group_session_set' ok`)).rows[0].ok,
    flags: (await c.query(`SELECT count(*)::int n FROM public.virtual_office WHERE (compliance_enforcement_enabled OR care_plan_module_enabled) AND name NOT LIKE 'ZZ %'`)).rows[0].n,
    sig: await sigAcl(c),
    csa: (await c.query(`SELECT p.pronargs n, (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE') g FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = 'create_service_authorization'`)).rows,
    acl: (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [C_NEW])).rows,
  }));
  // event types: 44 through Phase C; later additive rounds only add (W1: 50), so >= 44 with Phase C's two present
  rec("C0 Phase C objects present (13 functions, group_sessions, 4 columns, Phase C event types within >= 44); still no real office with a flag on", pass(st.fns === 13 && st.tbl === 1 && st.cols === 4 && st.ev >= 44 && st.evC && st.flags === 0),
    `functions ${st.fns}/13, table ${st.tbl}, columns ${st.cols}/4, event types ${st.ev}, real offices flagged ${st.flags}`);
  const sigBefore = JSON.parse(fs.readFileSync(C_SIG_FILE, "utf8"));
  rec("SIG the 10 replaced functions keep their exact signatures, definer flag and EXECUTE grants (no overloads)", pass(JSON.stringify(sigBefore) === JSON.stringify(st.sig)),
    JSON.stringify(sigBefore) === JSON.stringify(st.sig) ? `${st.sig.length} identical` : `before ${sigBefore.join(" | ")} // after ${st.sig.join(" | ")}`);
  const badAcl = st.acl.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g) || (C_RPCS.includes(f.proname) ? !(f.d && /authenticated/.test(f.g)) : (f.d || /authenticated/.test(f.g))));
  rec("ACL 3 RPCs definer + authenticated; 10 helpers/trigger functions not definer, no API role", pass(st.acl.length === 13 && badAcl.length === 0),
    `${st.acl.length}/13; offending ${badAcl.map((f) => `${f.proname}(${f.g})`).join(", ") || "none"}`);

  rec("R13 create_service_authorization: exactly one function (15 arguments), old one dropped, grants re-applied (authenticated, no PUBLIC/anon)",
    pass(st.csa.length === 1 && st.csa[0].n === 15 && /authenticated/.test(st.csa[0].g) && !/PUBLIC|anon/.test(st.csa[0].g)), JSON.stringify(st.csa));

  // ---- G group sessions (office X, flags still off: the group rules don't depend on the module) ----
  const H1 = await cgv("H1"), H2 = await cgv("H2"); F.cCaregivers.push(H1, H2);
  const gcl = await ins("clients", Array.from({ length: 8 }, (_, i) => cl(`GC${i}`))); F.cClients.push(...gcl);
  const gday = await dbDay(15);
  const g1 = await audited("create session (scheduler)", F.schX.c, "create_group_session", { _office_id: F.OX, _session_date: gday, _start_time: "09:00", _end_time: "10:00", _staff_client_ratio: "1:3", _max_clients: null }, "group_session_created");
  if (g1.err) throw new Error("create_group_session: " + g1.err);
  F.groups = [g1.v];
  const gsh = []; for (let i = 0; i < 8; i++) gsh.push(await sh(gcl[i], 15, "09:00", "10:00"));
  for (const i of [0, 1, 2, 3, 5, 6, 7]) { const r = await audited(`link shift ${i}`, F.schX.c, "set_shift_group_session", { _shift_id: gsh[i], _group_session_id: g1.v }, "shift_group_session_set", gsh[i]); if (r.err) throw new Error("link: " + r.err); }
  const ga = []; for (const i of [0, 1, 2]) ga.push(await ASSIGN(F.mgrX.c, gsh[i], H1));
  const gb = []; for (const i of [5, 6, 7]) gb.push(await ASSIGN(F.mgrX.c, gsh[i], H2));
  const fourth = await ASSIGN(F.mgrX.c, gsh[3], H1);
  const outside = await ASSIGN(F.mgrX.c, gsh[4], H1);
  const dupShift = await sh(gcl[5], 15, "09:00", "10:00");
  const dup = await audited("same client twice", F.schX.c, "set_shift_group_session", { _shift_id: dupShift, _group_session_id: g1.v }, "shift_group_session_set", dupShift);
  const wrongShift = await sh(gcl[0], 15, "09:30", "10:30");
  const wrong = await audited("wrong slot", F.schX.c, "set_shift_group_session", { _shift_id: wrongShift, _group_session_id: g1.v }, "shift_group_session_set", wrongShift);
  rec("G-cap per caregiver: two caregivers with 3 clients each in one group both pass; a 4th client for one caregiver is group_full; the same client twice in a group is refused",
    pass(ga.every((r) => !r.err) && gb.every((r) => !r.err) && /This caregiver already has 3 of 3 clients/.test(fourth.err || "") && /already has a shift in this group session/.test(dup.err || "")),
    `H1 ${ga.map((r) => r.err || "ok").join("/")}; H2 ${gb.map((r) => r.err || "ok").join("/")}; H1 4th "${(fourth.err || "accepted").slice(0, 80)}"; same client twice "${(dup.err || "accepted").slice(0, 60)}"`);
  const { data: direct, error: directErr } = await F.mgrX.c.from("shifts").update({ group_session_id: g1.v }).eq("id", gsh[4]).select("id");
  rec("G overlap exemption only inside the group: H1's 3 overlapping group shifts assign, but H1 on the same-slot shift outside the group is double_booked; wrong slot and direct column updates are refused",
    pass(/Overlaps a shift/.test(outside.err || "") && /exactly its time slot/.test(wrong.err || "") && (!!directErr || (direct || []).length === 0)),
    `outside group "${(outside.err || "accepted").slice(0, 60)}"; wrong slot "${(wrong.err || "accepted").slice(0, 50)}"; direct update ${directErr ? directErr.message.slice(0, 60) : `${(direct || []).length} rows`}`);

  // ---- turn the module + enforcement on for office X (agency admin, as the owner will) ----
  const ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  // ---- GL go-live stamp (fix 2) ----
  const { data: voS } = await admin.from("virtual_office").select("care_plan_module_enabled_at").eq("id", F.OX).single();
  const stampAge = voS.care_plan_module_enabled_at ? Date.parse(await dbNow()) - Date.parse(voS.care_plan_module_enabled_at) : null;
  const { data: hs, error: hsErr } = await F.aaA.c.from("virtual_office").update({ care_plan_module_enabled_at: "2025-01-01T05:00:00Z" }).eq("id", F.OX).select("id");
  rec("GL turning the module on stamps care_plan_module_enabled_at; the agency admin can't set it by hand",
    pass(stampAge !== null && stampAge >= -5000 && stampAge < 600000 && /go-live date is set when the module is turned on/.test(hsErr ? hsErr.message : "")),
    `stamped ${stampAge === null ? "no" : Math.round(stampAge / 1000) + " s ago (DB clock)"}; admin hand-set "${hsErr ? hsErr.message.slice(0, 70) : `accepted (${(hs || []).length} rows)`}"`);
  // fixture: the module has been live for 90 days (service role), so the past shifts below are after go-live
  const setLive = async (off) => {
    const ts = await pgRead(async (c) => (await c.query(`SELECT (((now() AT TIME ZONE 'America/New_York')::date + $1::int) AT TIME ZONE 'America/New_York') t`, [off])).rows[0].t);
    const { error } = await admin.from("virtual_office").update({ care_plan_module_enabled_at: ts.toISOString() }).eq("id", F.OX);
    if (error) throw new Error("setLive: " + error.message);
  };
  await setLive(-90);
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !ctBefore.has(id));
  const { data: en, error: enErr } = await F.aaA.c.from("virtual_office").update({ compliance_enforcement_enabled: true }).eq("id", F.OX).select("id");
  if (enErr || (en || []).length !== 1) throw new Error("enable enforcement: " + (enErr ? enErr.message : "0 rows"));
  const req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true)).data;
  const K1 = await cgv("K1"), K2 = await cgv("K2"), K3 = await cgv("K3"); F.cCaregivers.push(K1, K2, K3);
  for (const g of [K1, K2]) for (const t of req) await must(F.hrX.c, "enter_caregiver_credential", { _caregiver_id: g, _credential_type_id: t.id, _effective_date: await dbDay(-30), _expiry_date: await dbDay(300) });
  const setupClient = async (tag, trained, units) => {
    const [id] = await ins("clients", [cl(tag)]); F.cClients.push(id);
    const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: id, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(300) } });
    await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: [{ seq: 1, goal_text: "Goal", objectives: [{ letter: "A", seq: 1, objective_text: "Obj", service_type: "cls", responsible_party: "this_agency" }] }] });
    await must(F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "Fixture CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(-1), _signed_at: await dbNow() });
    if (trained.length) await must(F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: await dbDay(-60), _location: "Office",
      _records: await Promise.all(trained.map(async (g) => ({ caregiver_id: g, training_date: await dbDay(-1) }))) });
    let auth = null;
    if (units) auth = await must(F.mgrX.c, "create_service_authorization", { _client_id: id, _service_type: "cls", _auth_number: `C-${tag}-${RUN}`, _units_authorized: units, _effective_date: await dbDay(-60), _expiration_date: await dbDay(60) });
    return { id, plan, auth };
  };

  // ---- R rules + Manual/Smart/Auto + bulk == single ----
  const CA = await setupClient("CA", [K1, K2], 40), CB = await setupClient("CB", [K1], null);
  const T = await sh(CA.id, 5, "09:00", "10:00"), TB = await sh(CB.id, 5, "11:00", "12:00");
  const rK1 = await hard(T, K1), rK3 = await hard(T, K3), rNoAuth = await hard(TB, K1);
  rec("R rules under enforcement: compliant passes; no credentials + untrained hard-blocks; no authorization hard-blocks",
    pass(rK1 === "" && rK3 === "credential_missing,training_missing" && rNoAuth === "authorization_missing"), `K1 [${rK1}]; K3 [${rK3}]; client without authorization [${rNoAuth}]`);
  const ms = {}; for (const m of ["manual", "ai_suggested", "auto_assigned"]) { const r = await ASSIGN(F.mgrX.c, T, K3, m); ms[m] = r.err ? (/Missing required credential/.test(r.err) ? "refused" : r.err.slice(0, 50)) : "ASSIGNED"; }
  const mc = await F.mgrX.c.functions.invoke("match-caregiver", { body: { shiftId: T } });
  const ids_ = (mc.data?.matches || []).map((m) => m.caregiver_id);
  rec("M Manual, Smart (match-caregiver edge function -> bulk) and Auto honour the rules",
    pass(Object.values(ms).every((x) => x === "refused") && !mc.error && ids_.includes(K1) && !ids_.includes(K3)),
    `${JSON.stringify(ms)}; match-caregiver ${mc.error ? "ERR " + (mc.error.context?.status || mc.error.message) : `K1 listed ${ids_.includes(K1)}, K3 listed ${ids_.includes(K3)}`}`);
  const bulk = (await rpc(F.mgrX.c, "check_assignment_eligibility_bulk", { _shift_id: T, _caregiver_ids: [K1, K2, K3] })).v || [];
  const same = []; for (const r of bulk) same.push(JSON.stringify(r.result) === JSON.stringify(await elig(T, r.caregiver_id)));
  rec("B bulk (client context once per shift) returns exactly the single-check result for every caregiver", pass(same.length === 3 && same.every(Boolean)), `${same.filter(Boolean).length}/3 identical`);

  // ---- U-p past demand ----
  const CP = await setupClient("CP", [K1], 8);
  const Fp = await sh(CP.id, 6, "09:00", "10:00"); const fa = await ASSIGN(F.mgrX.c, Fp, K1);
  const PP = await sh(CP.id, -2, "09:00", "10:00"), PQ = await sh(CP.id, -3, "09:00", "10:00");
  const p0 = (await proj(Fp)).projected; const pa = await ASSIGN(F.mgrX.c, PP, K1);
  const p1 = (await proj(Fp)).projected; const F5 = await sh(CP.id, 7, "09:00", "10:00"); const h5 = await hard(F5, K1);
  rec("U-p1 a past assigned shift without a note reduces projected units", pass(!fa.err && !pa.err && Number(p0) === 8 && Number(p1) === 4 && h5 === "units_short"),
    `F projected before ${p0}, after the past shift ${p1}; next future shift [${h5}]`);
  const pn = await rpc(F.mgrX.c, "create_progress_note_for_shift", { _shift_id: PP }); if (pn.v) (ids.progress_notes = ids.progress_notes || []).push(pn.v);
  const p2 = (await proj(Fp)).projected, h2 = await hard(Fp, K1);
  rec("U-p2 creating its note doesn't double count", pass(!pn.err && Number(p2) === 4 && h2 === ""), `note ${pn.err || "created"}; F projected ${p2} (double count would be 0); F [${h2}]`);
  const pqRef = await ASSIGN(F.mgrX.c, PQ, K1);
  await F.aaA.c.from("virtual_office").update({ compliance_enforcement_enabled: false }).eq("id", F.OX);
  const pqOk = await ASSIGN(F.mgrX.c, PQ, K1);
  await F.aaA.c.from("virtual_office").update({ compliance_enforcement_enabled: true }).eq("id", F.OX);
  const p3 = (await proj(Fp)).projected, h3 = await hard(Fp, K1);
  const rel = await rpc(F.mgrX.c, "release_shift_assignments", { _shift_ids: [PQ], _reason: "C after: cancel past shift" });
  const p4 = (await proj(Fp)).projected, h4 = await hard(Fp, K1);
  rec("U-p3 cancelling a past assigned shift frees its units (release_shift_assignments)",
    pass(/units/.test(pqRef.err || "") && !pqOk.err && Number(p3) === 0 && h3 === "units_short" && rel.v === 1 && Number(p4) === 4 && h4 === ""),
    `PQ under enforcement "${(pqRef.err || "accepted").slice(0, 50)}"; assigned with enforcement off -> F projected ${p3} [${h3}]; released ${rel.err || rel.v} -> F projected ${p4} [${h4}]`);

  // ---- owner fixes 1-3 ----
  const enforce = async (on) => { const { error } = await F.aaA.c.from("virtual_office").update({ compliance_enforcement_enabled: on }).eq("id", F.OX); if (error) throw new Error("enforce: " + error.message); };
  const assignLoose = async (s, g) => { await enforce(false); const r = await ASSIGN(F.mgrX.c, s, g); await enforce(true); if (r.err) throw new Error("assignLoose: " + r.err); };
  // U-f1 unplaced demand still counts
  const CF = await setupClient("CF", [K1], 6);
  const big = await sh(CF.id, -4, "06:00", "08:00"); await assignLoose(big, K1);   // 8 units, no note
  const small = await sh(CF.id, 4, "06:00", "06:30");                             // 2 units
  const fS = await hard(small, K1), pS = await proj(small);
  rec("U-f1 unplaced demand doesn't disappear: auth with 6 left, a past assigned 8-unit shift without a note, then a 2-unit shift -> units_short",
    pass(fS === "units_short" && Number(pS.projected) === 0), `2-unit shift [${fS}], projected ${pS.projected}`);
  // U-cut go-live cutover
  const CU = await setupClient("CU", [K1], 40);
  const oldS = await sh(CU.id, -10, "19:00", "20:00"); const oa = await ASSIGN(F.mgrX.c, oldS, K1); if (oa.err) throw new Error("old shift: " + oa.err);
  F.completedShifts = [oldS];
  const { error: c1e } = await admin.from("shift_assignments").update({ status: "completed" }).eq("shift_id", oldS);
  const { error: c2e } = await admin.from("shifts").update({ status: "completed" }).eq("id", oldS);
  if (c1e || c2e) throw new Error("complete fixture: " + (c1e || c2e).message);
  const FU = await sh(CU.id, 4, "19:00", "20:00");
  await setLive(-5); const pA = (await proj(FU)).projected;
  await setLive(-20); const pB = (await proj(FU)).projected;
  await setLive(-90);
  rec("U-cut a completed shift (no note) dated before the module was turned on is ignored; after go-live it would count",
    pass(Number(pA) === 40 && Number(pB) === 36), `go-live day -5: projected ${pA}; go-live day -20: projected ${pB}`);
  // OB opening balance
  const [CO] = await ins("clients", [cl("CO")]); F.cClients.push(CO);
  const d0 = await dbDay(-30), d1 = await dbDay(60);
  const AUob = (num, before) => rpc(F.mgrX.c, "create_service_authorization", { _client_id: CO, _service_type: "cls", _auth_number: `OB${num}-${RUN}`, _units_authorized: 40,
    _effective_date: d0, _expiration_date: d1, _units_used_before_caremuch: before });
  const ob = await AUob(1, 10);
  const obAvail = ob.v && Number((await admin.from("service_authorizations").select("units_available").eq("id", ob.v).single()).data.units_available);
  const obEv = ob.v && ((await admin.from("events").select("id, payload").eq("subject_id", ob.v).eq("event_type", "authorization_created")).data || []);
  (obEv || []).forEach((e) => evIds.add(e.id));
  const obNeg = await AUob(2, -1), obOver = await AUob(3, 41);
  rec("OB opening balance: 10 used before CareMuch on a 40-unit authorization -> 30 available (audited as a number); negative or over the authorized units refused",
    pass(!ob.err && obAvail === 30 && obEv.length === 1 && obEv[0].payload.units_used_before_caremuch === 10 && /between 0 and the units authorized/.test(obNeg.err || "") && /between 0 and the units authorized/.test(obOver.err || "")),
    `${ob.err || `available ${obAvail}; payload ${JSON.stringify(obEv && obEv[0] && obEv[0].payload)}`}; -1 "${(obNeg.err || "accepted").slice(0, 50)}"; 41 "${(obOver.err || "accepted").slice(0, 30)}"`);
  // PW / PR per-period caps (per_week = the office's billing week, Monday here)
  const nextMon = await pgRead(async (c) => (await c.query(`SELECT 8 - extract(isodow FROM (now() AT TIME ZONE 'America/New_York')::date)::int n`)).rows[0].n);
  const capClient = async (tag, units, cap) => { const x = await setupClient(tag, [K1], null);
    x.auth = await must(F.mgrX.c, "create_service_authorization", { _client_id: x.id, _service_type: "cls", _auth_number: `CAP-${tag}-${RUN}`, _units_authorized: units,
      _effective_date: await dbDay(-60), _expiration_date: await dbDay(60), _period_type: "per_week", _units_per_period: cap }); return x; };
  const CW = await capClient("CW", 200, 20);
  for (let k = 0; k < 4; k++) await must(F.mgrX.c, "assign_caregiver_to_shift", { _shift_id: await sh(CW.id, nextMon + k, "17:00", "18:00"), _caregiver_id: K1, _method: "manual", _notes: "C after", _override_reason: null });
  const w5 = await sh(CW.id, nextMon + 4, "17:00", "18:00"); const w5c = await hard(w5, K1); const w5a = await ASSIGN(F.mgrX.c, w5, K1);
  const w6 = await sh(CW.id, nextMon + 5, "17:00", "18:00"); const w6e = await elig(w6, K1);
  const w6c = (w6e.hard || []).map((x) => x.code).sort().join(","), w6d = ((w6e.hard || []).find((x) => x.code === "units_short_period") || {}).detail;
  const nw = await sh(CW.id, nextMon + 7, "17:00", "18:00"); const nwc = await hard(nw, K1);
  rec("PW weekly cap 20 with 16 pending: a 4-unit shift passes; a second 4-unit shift the same week is blocked (units_short_period); the same shift next week passes",
    pass(w5c === "" && !w5a.err && w6c === "units_short_period" && /needs 4 units; 0 left this week/.test(w6d || "") && nwc === ""),
    `5th [${w5c}] assigned ${!w5a.err}; 6th [${w6c}] "${w6d}"; next week [${nwc}]`);
  const CRV = await capClient("CRV", 100, 8);
  const lw = nextMon - 14;   // Monday of last week (entirely past)
  const notes = [];
  for (let k = 0; k < 3; k++) {
    const s = await sh(CRV.id, lw + k, "15:00", "16:00"); await assignLoose(s, F.G);
    const id = await must(F.mgrX.c, "create_progress_note_for_shift", { _shift_id: s }); (ids.progress_notes = ids.progress_notes || []).push(id);
    const st0 = (await admin.from("progress_notes").select("scheduled_start").eq("id", id).single()).data.scheduled_start;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: id, _header: { client_arrived_at: st0 }, _entries: [], _narrative_text: null });
    await must(F.cg.c, "submit_progress_note", { _note_id: id, _typed_signature: "ZZ G" }); notes.push(id);
  }
  const REV = (id) => rpc(F.mgrX.c, "review_progress_note", { _note_id: id, _billable: true, _non_billable_reason: null });
  const rv1 = await REV(notes[0]), rv2 = await REV(notes[1]), rv3 = await REV(notes[2]);
  const st3 = (await admin.from("progress_notes").select("status, authorization_id").eq("id", notes[2]).single()).data;
  const lw4 = await sh(CRV.id, lw + 3, "15:00", "16:00"); const lw4c = await hard(lw4, K1);
  rec("PR review refused when it would push the authorization over its weekly cap (note stays submitted); charged units count in the projection's week too",
    pass(!rv1.err && !rv2.err && /over the authorization's weekly cap \(4 units needed, 0 left this week\)/.test(rv3.err || "") && st3.status === "submitted" && st3.authorization_id === null && lw4c === "units_short_period"),
    `reviews 1-2 ${rv1.err || "ok"}/${rv2.err || "ok"}; 3rd "${(rv3.err || "accepted").slice(0, 100)}" -> ${st3.status}; another shift that week [${lw4c}]`);

  // ---- CC real concurrency: two managers, two caregivers, two shifts, one authorization ----
  const rounds = [];
  for (let k = 0; k < 3; k++) {
    const CC = await setupClient(`CC${k}`, [K1, K2], 6);
    const X1 = await sh(CC.id, 20 + k, "09:00", "10:00"), X2 = await sh(CC.id, 20 + k, "11:00", "12:00");
    const [r1, r2] = await Promise.all([ASSIGN(F.mgrX.c, X1, K1), ASSIGN(F.mgrAll.c, X2, K2)]);
    const active = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM public.shift_assignments WHERE shift_id = ANY($1::uuid[]) AND status <> 'cancelled'`, [[X1, X2]])).rows[0].n);
    const loser = [r1, r2].find((r) => r.err);
    rounds.push({ ok: [r1, r2].filter((r) => !r.err).length === 1 && active === 1 && /needs 4 units; 2 projected/.test(loser ? loser.err : ""), r1: r1.err ? "refused" : "ok", r2: r2.err ? "refused" : "ok", active, why: loser ? loser.err.slice(0, 70) : "none refused" });
  }
  rec("CC real concurrency: two managers assign two caregivers to two 4-unit shifts on one 6-unit authorization at the same time -> exactly one succeeds (3 rounds)",
    pass(rounds.every((r) => r.ok)), rounds.map((r, i) => `round ${i + 1}: mgrX ${r.r1}, mgrAll ${r.r2}, active ${r.active} ("${r.why}")`).join("; "));

  // ---- R6 caregiver-facing text ----
  const R6s = await sh(CB.id, 9, "09:00", "10:00");
  const side = ((await rpc(F.cg.c, "check_caregiver_shifts_eligibility", { _shift_ids: [R6s] })).v || [])[0];
  const pick = await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: R6s });
  const res = side ? (side.result || side) : {};
  const text = JSON.stringify(side || {}) + (pick.err || "");
  const leak = /ICHAT|HIPAA|authoriz|units|version|cls|respite|plan of service|\d+ of \d+/i;
  rec("R6 caregiver-facing shift list and pick-up show only generic text (not_bookable)", pass((res.hard || []).some((x) => x.code === "not_bookable") && !leak.test(text) && !!pick.err),
    `codes [${(res.hard || []).map((x) => x.code)}]; pick-up "${(pick.err || "accepted").slice(0, 70)}"; leak ${leak.test(text)}`);

  // ---- L retraining list ----
  await must(F.mgrX.c, "assign_caregiver_to_shift", { _shift_id: T, _caregiver_id: K1, _method: "manual", _notes: "C after", _override_reason: null });
  await must(F.mgrX.c, "renew_care_plan", { _care_plan_id: CA.plan });
  const lst = (await rpc(F.hrX.c, "list_caregivers_needing_retraining", { _office_id: F.OX })).v || [];
  const stillAssigned = (await admin.from("shifts").select("caregiver_id").eq("id", T).single()).data.caregiver_id === K1;
  rec("L after a renewal the shift stays assigned and the retraining list shows it", pass(stillAssigned && lst.some((x) => x.shift_id === T && x.caregiver_id === K1)), `still assigned ${stillAssigned}; listed ${lst.length}`);

  // ---- D denials ----
  const anon = createClient(URL_, ANON, opts);
  const D = { create_group_session: [{ _office_id: F.OX, _session_date: await dbDay(30), _start_time: "09:00", _end_time: "10:00", _staff_client_ratio: null, _max_clients: null }, [["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c], ["office-Y manager", F.mgrY.c]]],
    set_shift_group_session: [{ _shift_id: gsh[4], _group_session_id: g1.v }, [["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c], ["office-Y manager", F.mgrY.c]]],
    list_caregivers_needing_retraining: [{ _office_id: F.OX }, [["scheduler", F.schX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c], ["office-Y manager", F.mgrY.c]]] };
  const leaks = []; let n = 0;
  for (const [fn, [args, who]] of Object.entries(D)) for (const [label, c] of who) { const r = await rpc(c, fn, args); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${label}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
  rec("D every Phase C RPC refused outside its tier/scope", pass(leaks.length === 0), leaks.length ? leaks.join("; ") : `${n} denied calls refused`);
  const badA = audit.filter((a) => !a.ok);
  rec("A1 exactly one correlated event per group-session write, none for refused writes (subject id + type, DB-clock window)", pass(badA.length === 0),
    badA.length ? JSON.stringify(badA) : `${audit.length} calls (${audit.filter((a) => a.refused).length} refused)`);
}

async function teardownC(F) {
  if (!F || !F.cClients) return;
  for (const s of F.completedShifts || []) { await admin.from("shift_assignments").update({ status: "scheduled" }).eq("shift_id", s); await admin.from("shifts").update({ status: "open" }).eq("id", s); }
  for (const c of F.cClients) await admin.from("progress_notes").delete().eq("client_id", c);
  for (const s of F.shifts || []) { await admin.from("shift_assignments").delete().eq("shift_id", s); await admin.from("events").delete().eq("subject_id", s); }
  for (const g of F.groups || []) await admin.from("events").delete().eq("subject_id", g);
  for (const o of [F.OX, F.OY, F.OZ].filter(Boolean)) await admin.from("group_sessions").delete().eq("virtual_office_id", o);
  for (const g of F.cCaregivers || []) { await admin.from("plan_training_records").delete().eq("caregiver_id", g); await admin.from("caregiver_certifications").delete().eq("caregiver_id", g); }
  for (const c of F.cClients) { await admin.from("plan_training_forms").delete().eq("client_id", c); await admin.from("plan_inservice_forms").delete().eq("client_id", c);
    await admin.from("client_documents").delete().eq("client_id", c); await admin.from("care_plans").delete().eq("client_id", c); await admin.from("service_authorizations").delete().eq("client_id", c); }
  for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
  const left = [];
  for (const o of [F.OX, F.OY, F.OZ].filter(Boolean)) { const { data } = await admin.from("group_sessions").select("id").eq("virtual_office_id", o); if (data && data.length) left.push(`group_sessions ${o}`); }
  for (const c of F.cClients) for (const t of ["care_plans", "service_authorizations", "progress_notes"]) { const { data } = await admin.from(t).select("id").eq("client_id", c); if (data && data.length) left.push(`${t} for ${c}`); }
  for (const t of F.newCredTypes || []) { const { data } = await admin.from("credential_types").select("id").eq("id", t); if (data && data.length) left.push(`credential_type ${t}`); }
  log(`teardown C: ${F.cClients.length} clients, ${(F.cCaregivers || []).length} caregivers, ${(F.groups || []).length} group sessions, ${(F.newCredTypes || []).length} new credential types → remaining: ${left.length ? left.join("; ") : "NONE"}`);
}

(async () => {
  log(`=== Ripple Phase C tests — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    const nb = await noBreak(F);
    const base = JSON.parse(fs.readFileSync(path.join(BASELINE, "nobreak_before.json"), "utf8"));
    // before the push the function hashes must match too; after it they differ by design (the functions
    // were replaced), so the after-run compares every BEHAVIOURAL key and reports the hashes separately.
    const keys = Object.keys(base).filter((k) => LABEL === "before" || k !== "eligibility_fn");
    const diff = keys.filter((k) => base[k] !== nb[k]);
    rec(`NB1 assign paths + eligibility identical to the saved baseline (${LABEL === "before" ? "function hashes included, pre-push" : "behaviour, flags off"})`, pass(diff.length === 0),
      diff.length ? diff.map((k) => `${k}: base ${base[k]} now ${nb[k]}`).join("; ") : `identical (${keys.length} keys)`);
    if (LABEL !== "before") log(`   function hashes now (changed by design): ${nb.eligibility_fn}`);
    if (LABEL === "before") await beforeC(F); else await afterC(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    await teardownC(F); await teardownB2(F); await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shifts WHERE virtual_office_id = ANY($1::uuid[]))::int shifts,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR agency_id = $2::uuid)::int ev, (SELECT count(*) FROM auth.users WHERE email LIKE $3)::int users`, [[F.OX, F.OY, F.OZ], F.B, "%" + SUFFIX])).rows[0]);
      log(`C teardown re-query: shifts ${left.shifts}, events ${left.ev}, users ${left.users} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();