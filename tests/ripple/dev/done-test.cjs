// Ripple care-plan module — Phase D3 end-to-end done-test (schema plan §8: both done-tests plus the
// rollout regression), one scenario on DEV with disposable fixtures; every time from the DB clock.
// Usage: node tests/ripple/dev/done-test.cjs
//   1 module on for "Ripple-X" -> shells -> client -> the 8 onboarding items until onboarded
//   2 credentials (hr + one manager override) -> in-service -> training v1 -> enforcement on
//   3 Manual / Smart (match-caregiver) / Auto; untrained, missing-credential, over-cap-week blocked
//   4 visits -> notes (on time, +5:01 late 4->3, respite; one returned + resubmitted); reviews FIFO
//     across two authorizations; weekly cap respected
//   5 weekly batch -> approve clean rows + one individually -> billed -> billed notes locked
//   6 template versions: IPOS v2 publish, instance pinned, narrative edit, upgrade, spine guard
//   7 renewal -> training_version 2 -> blocked / stays assigned / retraining list / retrain
//   8 isolation: office-Y manager and agency-B admin see and touch nothing
//   9 rollout regression on REAL data, read-only + the Kind-Care-like fixture office
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, URL_, ANON, RUN, admin, opts, createClient, ids, log, rec, pass, ins, dbNow, reportSkew, pgRead, setup, checkNoBreak,
  DENY, setupB1, rpc, evIds, dbDay, teardownB1, teardown, closeDb, summary } = require("./lib.cjs");

const TZ = "America/New_York";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function scenario(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const S = F.d3 = { clients: [], caregivers: [], templates: [], shifts: [] };
  const sh = async (client, off, start, end, code = "CLS0001") => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: client, order_title: `ZZ ${RUN}`,
    care_type_code: code, shift_date: await dbDay(off), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true }); F.shifts.push(id); return id; };
  const ASSIGN = (c, s, g, m = "manual") => rpc(c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: m, _notes: "D3", _override_reason: null });
  const elig = async (s, g) => (await rpc(F.mgrX.c, "check_assignment_eligibility", { _shift_id: s, _caregiver_id: g })).v;
  const hard = async (s, g) => ((await elig(s, g)).hard || []).map((x) => x.code).sort().join(",");
  const tplOf = async (verId) => (await admin.from("form_template_versions").select("template_id").eq("id", verId).single()).data.template_id;
  const nowIso = async () => (await pgRead(async (c) => (await c.query("SELECT now() t")).rows[0].t)).toISOString();
  const nextMon = await pgRead(async (c) => (await c.query(`SELECT 8 - extract(isodow FROM (now() AT TIME ZONE '${TZ}')::date)::int n`)).rows[0].n);

  // ================= 1. module on -> shells -> client -> onboarded =================
  await admin.from("virtual_office").update({ name: `ZZ Ripple-X ${RUN}` }).eq("id", F.OX);
  await admin.from("virtual_office").update({ name: `ZZ KindCare-Y ${RUN}` }).eq("id", F.OY);
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  const en = await rpc(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const vo = (await admin.from("virtual_office").select("care_plan_module_enabled, compliance_enforcement_enabled, care_plan_module_enabled_at").eq("id", F.OX).single()).data;
  rec("S1.1 agency admin turns the module on for Ripple-X (go-live stamped; enforcement still off)", pass(!en.err && vo.care_plan_module_enabled && !vo.compliance_enforcement_enabled && !!vo.care_plan_module_enabled_at),
    `${en.err || JSON.stringify(en.v)}; go-live ${vo.care_plan_module_enabled_at}`);
  const ipos = (extra = []) => [
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "hopes", label: "Hopes and dreams", field_type: "longtext", storage: "field_value", required: true }, ...extra];
  const noteFields = [{ field_key: "service_date", label: "Date", field_type: "date", storage: "spine_column", writes_to_entity: "progress_note", writes_to_column: "service_date" },
    { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "progress_note_entry" }];
  const shell = async (kind, name, fields, extra = {}) => {
    const v = await must(F.mgrX.c, "save_template_draft", { _template_id: null, _office_id: F.OX, _kind: kind, _name: `ZZ ${name} ${RUN}`, _intake_doc_type: extra.doc || null,
      _is_required_for_client: extra.doc ? true : null, _sections: [], _note_layout: extra.layout || null, _fields: fields, _service_type: extra.svc || null });
    const t = await tplOf(v); ids.form_templates = (ids.form_templates || []).concat(t); S.templates.push(t);
    await must(F.mgrX.c, "publish_template_version", { _template_id: t }); return t;
  };
  S.iposTpl = await shell("ipos", "IPOS", ipos());
  S.respiteTpl = await shell("progress_note", "Respite note", noteFields, { layout: { billing_footer: { enabled: true }, narrative: true }, svc: "respite" });
  S.clsTpl = await shell("progress_note", "CLS note", noteFields, { layout: { billing_footer: { enabled: true } }, svc: "cls" });
  const DOCS = ["assessment", "consent", "insurance", "emergency_contacts", "allergies", "release_of_information", "safety_behavior_plan"];
  for (const d of DOCS) await shell("intake", `intake ${d}`, [{ field_key: "notes", label: "Notes", field_type: "longtext", storage: "field_value" }], { doc: d });
  rec("S1.2 manager publishes the IPOS, respite-note, CLS-note and 7 intake shells", pass(S.templates.length === 10), `${S.templates.length} shells published`);
  const cl = (tag) => ({ agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `${tag} ${RUN}`, phone: "555-0190", address: "5 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  const [C] = await ins("clients", [cl("D3-C")]); S.clients.push(C);
  await ins("caregiver_skills", { caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true });
  const ob = async () => must(F.mgrX.c, "get_client_onboarding_status", { _client_id: C });
  const walk = []; const note = async (label) => { const s = await ob(); walk.push(`${label}: ${s.items.filter((i) => !["complete", "not_applicable"].includes(i.status)).length} open${s.onboarded ? " -> ONBOARDED" : ""}`); return s; };
  await note("start");
  S.plan = await must(F.mgrX.c, "create_care_plan", { _client_id: C, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(300) }, _field_values: { hopes: "Fixture hopes" } });
  ids.care_plans = (ids.care_plans || []).concat(S.plan); await note("IPOS");
  await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: S.plan, _goals: [{ seq: 1, goal_text: "Goal one", objectives: [
    { letter: "A", seq: 1, objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" },
    { letter: "B", seq: 2, objective_text: "CM follow-up", responsible_party: "case_management" }] }] });
  S.objA = (await admin.from("care_plan_objectives").select("id, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", S.plan).eq("responsible_party", "this_agency").single()).data.id;
  S.mt = (await admin.from("measure_types").select("id").is("agency_id", null).eq("kind", "yes_no_na").limit(1).single()).data.id;
  await must(F.mgrX.c, "set_objective_measures", { _objective_id: S.objA, _measures: [{ measure_type_id: S.mt, prompt_text: "Participated?" }] }); await note("CLS note set up");
  const doc = (t, st, na = null) => must(F.mgrX.c, "upsert_client_document", { _client_id: C, _doc_type: t, _status: st, _not_applicable_reason: na });
  await doc("assessment", "complete"); await note("assessment");
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: S.plan, _case_manager_name: "Fixture CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(-1), _signed_at: await nowIso() }); await note("in-service");
  for (const t of ["consent", "insurance", "emergency_contacts", "allergies", "release_of_information"]) await doc(t, "complete"); await note("client forms");
  await doc("safety_behavior_plan", "not_applicable", "No plan in the IPOS"); await note("safety/behavior plan N/A");
  await must(F.hrX.c, "record_training_form", { _care_plan_id: S.plan, _plan_document_type: "ipos_initial", _plan_effective_date: await dbDay(-60), _location: "Office",
    _records: [{ caregiver_id: F.G, training_date: await dbDay(-1) }] }); await note("training (G)");
  const AU = (svc, num, units, from, to, per = null, cap = null) => must(F.mgrX.c, "create_service_authorization", { _client_id: C, _service_type: svc, _auth_number: `D3-${num}-${RUN}`,
    _units_authorized: units, _effective_date: from, _expiration_date: to, _period_type: per, _units_per_period: cap });
  // A1 expires first (FIFO picks it first) and TODAY, so it covers yesterday's visits but no future week
  // (whatever the weekday: next Monday can be tomorrow)
  S.auth1 = await AU("cls", "A1", 4, await dbDay(-30), await dbDay(0));
  S.auth2 = await AU("cls", "A2", 200, await dbDay(-30), await dbDay(60), "per_week", 8); // "8 per week"
  S.authR = await AU("respite", "R1", 40, await dbDay(-30), await dbDay(60));
  const onb = await note("authorizations");
  rec("S1.3 client walked through the 8 onboarding items until onboarded = true", pass(onb.onboarded === true && walk[0].startsWith("start: 8 open")), walk.join(" | "));

  // ================= 2. credentials -> in-service -> training v1 -> enforcement on =================
  const req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true).order("name")).data;
  const cgv = async (tag) => { const id = await ins("caregivers", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `${tag} ${RUN}`, email: `sec-${tag.toLowerCase()}${(RUN).toLowerCase()}@caremuch-sectest.test`, phone: "555-0191", is_demo: true });
    await ins("caregiver_skills", [{ caregiver_id: id, care_type_code: "CLS0001", is_demo: true }, { caregiver_id: id, care_type_code: "RESP0001", is_demo: true }]); S.caregivers.push(id); return id; };
  const K2 = await cgv("D3K2"), K3 = await cgv("D3K3"); S.caregivers.push(F.G);
  const cred = (c, g, t, exp) => rpc(c, "enter_caregiver_credential", { _caregiver_id: g, _credential_type_id: t, _effective_date: null, _expiry_date: exp });
  const credErr = [];
  for (const g of [F.G, K2]) for (const t of req) { const r = await cred(F.hrX.c, g, t.id, await dbDay(300)); if (r.err) credErr.push(r.err); }
  for (const t of req.slice(1)) { const r = await cred(F.hrX.c, K3, t.id, await dbDay(300)); if (r.err) credErr.push(r.err); }   // K3: first required type missing
  const ovr = await cred(F.mgrX.c, F.G, req[0].id, await dbDay(250));                                                          // manager override
  const { data: certG } = await admin.from("caregiver_certifications").select("overridden_by").eq("caregiver_id", F.G).eq("credential_type_id", req[0].id).single();
  rec("S2.1 credentials entered by hr_staff; one manager override (recorded)", pass(credErr.length === 0 && !ovr.err && certG.overridden_by === F.mgrX.id),
    `${req.length} required types; errors ${credErr.length ? credErr.join("; ") : "none"}; override ${ovr.err || "ok"}`);
  const trK3 = await rpc(F.hrX.c, "record_training_form", { _care_plan_id: S.plan, _plan_document_type: "ipos_initial", _plan_effective_date: await dbDay(-60), _location: "Office",
    _records: [{ caregiver_id: K3, training_date: await dbDay(-1) }] });
  const tvRows = (await admin.from("plan_training_records").select("caregiver_id, training_version").eq("care_plan_id", S.plan)).data;
  const { error: enfErr } = await F.aaA.c.from("virtual_office").update({ compliance_enforcement_enabled: true }).eq("id", F.OX);
  rec("S2.2 in-service (onboarding item 3) + training at version 1 for G and K3 (K2 untrained); agency admin turns enforcement on",
    pass(!trK3.err && tvRows.length === 2 && tvRows.every((r) => r.training_version === 1) && !enfErr), `training rows ${tvRows.map((r) => `tv${r.training_version}`).join(",")}; enforcement ${enfErr ? enfErr.message : "on"}`);

  // ================= 3. Manual / Smart / Auto + blocks =================
  const W1 = nextMon, W2 = nextMon + 7;
  const m1 = await sh(C, W1, "09:00", "10:00"); const rM = await ASSIGN(F.mgrX.c, m1, F.G, "manual");
  const s1 = await sh(C, W1 + 1, "09:00", "10:00");
  const mc = await F.mgrX.c.functions.invoke("match-caregiver", { body: { shiftId: s1 } });
  const listed = (mc.data?.matches || []).map((m) => m.caregiver_id);
  const rS = listed.includes(F.G) ? await ASSIGN(F.mgrX.c, s1, F.G, "ai_suggested") : { err: "G not suggested" };
  const a1 = await sh(C, W1 + 2, "09:00", "10:00", "RESP0001"); const rA = await ASSIGN(F.mgrX.c, a1, F.G, "auto_assigned");
  rec("S3.1 CLS shift via Manual, CLS shift via Smart (match-caregiver suggests G; K2 and K3 filtered out), respite shift via Auto",
    pass(!rM.err && !mc.error && !rS.err && !rA.err && !listed.includes(K2) && !listed.includes(K3)),
    `manual ${rM.err || "ok"}; smart ${mc.error ? "ERR" : `suggested [G ${listed.includes(F.G)}, K2 ${listed.includes(K2)}, K3 ${listed.includes(K3)}]`} -> ${rS.err || "ok"}; auto ${rA.err || "ok"}`);
  const b1 = await sh(C, W2, "11:00", "12:00"); const hK2 = await hard(b1, K2), hK3 = await hard(b1, K3);
  const rK2 = await ASSIGN(F.mgrX.c, b1, K2, "manual"), rK3 = await ASSIGN(F.mgrX.c, b1, K3, "auto_assigned");
  const cap = await sh(C, W1 + 3, "09:00", "10:00"); const capE = await elig(cap, F.G);
  const capC = (capE.hard || []).map((x) => x.code).join(","), capD = ((capE.hard || [])[0] || {}).detail;
  const rCap = await ASSIGN(F.mgrX.c, cap, F.G, "manual");
  rec("S3.2 blocked with the right code: untrained caregiver (training_missing), missing credential (credential_missing), over-cap week (units_short_period)",
    pass(hK2 === "training_missing" && hK3 === "credential_missing" && !!rK2.err && !!rK3.err && capC === "units_short_period" && /needs 4 units; 0 left this week/.test(capD || "") && !!rCap.err),
    `K2 [${hK2}] assign ${rK2.err ? "refused" : "ACCEPTED"}; K3 [${hK3}] assign ${rK3.err ? "refused" : "ACCEPTED"}; third CLS shift that week [${capC}] "${capD}" assign ${rCap.err ? "refused" : "ACCEPTED"}`);

  // ================= 4. visits -> notes -> reviews =================
  const v = {};
  for (const [k, start, end, code] of [["n1", "07:00", "08:00", "CLS0001"], ["n2", "09:00", "10:00", "CLS0001"], ["n3", "11:00", "12:00", "CLS0001"], ["n4", "13:00", "14:00", "CLS0001"], ["r1", "15:00", "16:00", "RESP0001"]]) {
    v[k] = await sh(C, -1, start, end, code); const r = await ASSIGN(F.mgrX.c, v[k], F.G, "manual"); if (r.err) throw new Error(`visit ${k}: ${r.err}`);
  }
  const N = {};
  for (const k of Object.keys(v)) { N[k] = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: v[k] }); ids.progress_notes = (ids.progress_notes || []).concat(N[k]); }
  const row = async (id) => (await admin.from("progress_notes").select("*").eq("id", id).single()).data;
  const plus = (n, sec) => new Date(Date.parse(n.scheduled_start) + sec * 1000).toISOString();
  const fill = async (k, lateSec) => { const n = await row(N[k]);
    const { data: es } = await admin.from("progress_note_entries").select("id").eq("progress_note_id", N[k]);
    const ms = (await admin.from("objective_measures").select("id").eq("objective_id", S.objA).eq("is_active", true)).data.map((m) => m.id);
    await must(F.cg.c, "save_progress_note_draft", { _note_id: N[k], _header: { client_arrived_at: plus(n, lateSec), actual_end: (await admin.from("progress_notes").select("scheduled_end").eq("id", N[k]).single()).data.scheduled_end },
      _entries: es.map((e) => ({ entry_id: e.id, data: Object.fromEntries(ms.map((m) => [m, { value: "Yes" }])) })), _narrative_text: n.note_kind === "respite" ? "Fixture respite session." : null });
    await must(F.cg.c, "submit_progress_note", { _note_id: N[k], _typed_signature: "ZZ G" }); };
  await fill("n1", 0); await fill("n2", 301); await fill("n3", 59); await fill("n4", 0); await fill("r1", 0);   // n3 +0:59: on time at minute precision (no grace period, Oct 6)
  const ret = await rpc(F.mgrX.c, "return_progress_note", { _note_id: N.n2, _reason: "Please confirm the arrival time" });
  const afterRet = (await row(N.n2)).status;
  await fill("n2", 301);   // caregiver corrects and resubmits
  const n2 = await row(N.n2), n1r = await row(N.n1), r1r = await row(N.r1);
  rec("S4.1 notes: on time (4 units), +5:01 late (4 -> 3), respite (narrative); the late one returned and resubmitted",
    pass(n1r.units_used === 4 && !n1r.arrived_late && n2.arrived_late && n2.units_scheduled === 4 && n2.units_used === 3 && r1r.note_kind === "respite" && !ret.err && afterRet === "returned" && n2.status === "submitted" && n2.returned_count === 1),
    `n1 ${n1r.units_used}u; n2 late=${n2.arrived_late} ${n2.units_scheduled}->${n2.units_used}u, returned (${afterRet}) and resubmitted (${n2.status}, returned_count ${n2.returned_count}); respite kind ${r1r.note_kind}`);
  const n1t = (await row(N.n1)).template_id;
  rec("S4.1b note shells per service: the CLS note snapshots the CLS shell and the respite note the respite shell",
    pass(n1t === S.clsTpl && r1r.template_id === S.respiteTpl), `CLS note -> ${n1t === S.clsTpl ? "CLS shell" : n1t === S.respiteTpl ? "respite shell" : "other"}; respite note -> ${r1r.template_id === S.respiteTpl ? "respite shell" : r1r.template_id === S.clsTpl ? "CLS shell" : "other"}`);
  const REV = (k) => rpc(F.mgrX.c, "review_progress_note", { _note_id: N[k], _billable: true, _non_billable_reason: null });
  const R = {}; for (const k of ["n1", "n2", "n3", "n4", "r1"]) R[k] = await REV(k);
  const auth = async (k) => (await row(N[k])).authorization_id;
  const at = { n1: await auth("n1"), n2: await auth("n2"), n3: await auth("n3"), n4: await auth("n4"), r1: await auth("r1") };
  const n4s = (await row(N.n4)).status;
  rec("S4.2 reviews draw FIFO across two authorizations (n1 -> the earlier-expiring one; n2, n3 -> the next); the weekly cap (8) refuses n4 and it stays submitted; respite -> its own authorization",
    pass(!R.n1.err && !R.n2.err && !R.n3.err && !R.r1.err && at.n1 === S.auth1 && at.n2 === S.auth2 && at.n3 === S.auth2 && at.r1 === S.authR
      && /weekly cap \(4 units needed, 1 left this week\)/.test(R.n4.err || "") && n4s === "submitted" && at.n4 === null),
    `n1 -> ${at.n1 === S.auth1 ? "A1" : at.n1}; n2 -> ${at.n2 === S.auth2 ? "A2" : at.n2}; n3 -> ${at.n3 === S.auth2 ? "A2" : at.n3}; n4 "${(R.n4.err || "accepted").slice(0, 95)}" (${n4s}); respite -> ${at.r1 === S.authR ? "R1" : at.r1}`);
  const units = async (id) => Number((await admin.from("service_authorizations").select("units_available").eq("id", id).single()).data.units_available);
  rec("S4.3 authorization balances after the reviews", "INFO", `A1 ${await units(S.auth1)}/4, A2 ${await units(S.auth2)}/200, R1 ${await units(S.authR)}/40`);

  // ================= 5. weekly batch -> approvals -> billed -> locked =================
  const yday = await dbDay(-1);
  const wk = await pgRead(async (c) => (await c.query(`SELECT ($1::date - ((extract(isodow FROM $1::date)::int - 1 + 7) % 7))::text d`, [yday])).rows[0].d);
  const bb = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: wk }); S.batch = bb.batch_id;
  const exN4 = (bb.excluded || []).find((x) => x.note_id === N.n4);
  const clean = await must(F.mgrX.c, "approve_clean_rows", { _batch_id: S.batch });
  const indiv = await must(F.mgrX.c, "approve_batch_notes", { _batch_id: S.batch, _note_ids: [N.n2] });
  const billed = await rpc(F.mgrX.c, "mark_batch_billed", { _batch_id: S.batch });
  const st = {}; for (const k of ["n1", "n2", "n3", "r1"]) st[k] = (await row(N[k])).status;
  rec("S5.1 weekly batch: 4 reviewed notes in, n4 excluded (submitted, not reviewed); clean rows approved in bulk (3), the late/returned one individually; billed",
    pass(bb.included === 4 && exN4 && /submitted/.test(exN4.reason) && clean.approved === 3 && indiv.approved === 1 && !billed.err && Object.values(st).every((x) => x === "billed")),
    `included ${bb.included}; n4 excluded "${exN4 && exN4.reason}"; clean ${clean.approved}, individually ${indiv.approved}; billed ${billed.err || "ok"}; notes ${JSON.stringify(st)}`);
  const lockVoid = await rpc(F.mgrX.c, "void_progress_note", { _note_id: N.n1, _reason: "test" });
  const lockRet = await rpc(F.mgrX.c, "return_progress_note", { _note_id: N.n1, _reason: "test" });
  const lockEdit = await rpc(F.cg.c, "save_progress_note_draft", { _note_id: N.n1, _header: {}, _entries: [], _narrative_text: null });
  const lockDirect = await F.mgrX.c.from("progress_notes").update({ narrative_text: "x" }).eq("id", N.n1).select("id");
  const lockRebuild = await rpc(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: wk });
  rec("S5.2 billed notes and the billed batch are locked (void, return, caregiver edit, direct update, rebuild all refused)",
    pass(!!lockVoid.err && !!lockRet.err && !!lockEdit.err && (!!lockDirect.error || (lockDirect.data || []).length === 0) && !!lockRebuild.err),
    `void "${(lockVoid.err || "ok").slice(0, 40)}"; return "${(lockRet.err || "ok").slice(0, 40)}"; edit "${(lockEdit.err || "ok").slice(0, 40)}"; direct ${lockDirect.error ? "refused" : `${(lockDirect.data || []).length} rows`}; rebuild "${(lockRebuild.err || "ok").slice(0, 50)}"`);

  // ================= 6. template versions =================
  const p0 = (await admin.from("care_plans").select("template_id, template_version, field_snapshot").eq("id", S.plan).single()).data;
  const vcount = async () => (await admin.from("form_template_versions").select("id").eq("template_id", S.iposTpl)).data.length;
  await must(F.mgrX.c, "save_template_draft", { _template_id: S.iposTpl, _office_id: null, _kind: null, _name: null, _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: null,
    _fields: ipos([{ field_key: "strengths", label: "Strengths", field_type: "longtext", storage: "field_value" }]) });
  await must(F.mgrX.c, "publish_template_version", { _template_id: S.iposTpl });
  const p1 = (await admin.from("care_plans").select("template_version, field_snapshot").eq("id", S.plan).single()).data;
  const vBefore = await vcount();
  const narr = await rpc(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: S.plan, _field_values: { hopes: "Edited hopes" } });
  const vAfter = await vcount();
  const up = await rpc(F.mgrX.c, "upgrade_instance_template", { _instance_table: "care_plans", _instance_id: S.plan });
  const p2 = (await admin.from("care_plans").select("template_version, training_version").eq("id", S.plan).single()).data;
  const authShell = await rpc(F.mgrX.c, "save_template_draft", { _template_id: null, _office_id: F.OX, _kind: "authorization", _name: `ZZ auth ${RUN}`, _intake_doc_type: null, _is_required_for_client: null,
    _sections: [], _note_layout: null, _fields: [{ field_key: "units", label: "Units", field_type: "units", storage: "spine_column", writes_to_entity: "service_authorization", writes_to_column: "units_authorized" }] });
  const authTpl = authShell.v && await tplOf(authShell.v); if (authTpl) { ids.form_templates.push(authTpl); S.templates.push(authTpl); }
  const pubNoSpine = await rpc(F.mgrX.c, "publish_template_version", { _template_id: authTpl });
  rec("S6 IPOS v2 published -> the plan stays on v1 with its snapshot; a narrative edit creates no template version; explicit upgrade -> v2; a shell missing a required spine column can't publish",
    pass(p0.template_version === 1 && p1.template_version === 1 && JSON.stringify(p1.field_snapshot) === JSON.stringify(p0.field_snapshot) && !narr.err && vAfter === vBefore && !up.err && p2.template_version === 2
      && /required spine fields/.test(pubNoSpine.err || "")),
    `plan v${p0.template_version} -> after publish v${p1.template_version} (snapshot same ${JSON.stringify(p1.field_snapshot) === JSON.stringify(p0.field_snapshot)}); versions ${vBefore} -> ${vAfter} after narrative edit; upgrade ${up.err || "ok"} -> v${p2.template_version} (training_version ${p2.training_version}); spine guard "${(pubNoSpine.err || "published").slice(0, 60)}"`);

  // ================= 7. renewal -> retraining =================
  const tvBefore = p2.training_version;
  S.plan2 = await must(F.mgrX.c, "renew_care_plan", { _care_plan_id: S.plan }); ids.care_plans.push(S.plan2);
  const tv2 = (await admin.from("care_plans").select("training_version").eq("id", S.plan2).single()).data.training_version;
  const n7 = await sh(C, W2, "13:00", "14:00"); const blocked = await hard(n7, F.G);
  const still = (await admin.from("shifts").select("id, caregiver_id").in("id", [m1, s1, a1])).data;
  const lst = (await rpc(F.hrX.c, "list_caregivers_needing_retraining", { _office_id: F.OX })).v || [];
  const listedIds = lst.filter((x) => x.caregiver_id === F.G).map((x) => x.shift_id);
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: S.plan2, _case_manager_name: "Fixture CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(0), _signed_at: await nowIso() });
  await must(F.hrX.c, "record_training_form", { _care_plan_id: S.plan2, _plan_document_type: "ipos_annual", _plan_effective_date: await dbDay(-60), _location: "Office",
    _records: [{ caregiver_id: F.G, training_date: await dbDay(0) }] });
  const again = await hard(n7, F.G); const rAgain = await ASSIGN(F.mgrX.c, n7, F.G, "manual");
  const lst2 = (await rpc(F.hrX.c, "list_caregivers_needing_retraining", { _office_id: F.OX })).v || [];
  rec("S7 renewal with identical goals -> training_version +1; G blocked for a new shift (training_missing); already-assigned shifts stay assigned and are on the retraining list; after retraining G is assignable and off the list",
    pass(tv2 === tvBefore + 1 && blocked === "training_missing" && still.length === 3 && still.every((s) => s.caregiver_id === F.G)
      && [m1, s1, a1].every((s) => listedIds.includes(s)) && again === "" && !rAgain.err && !lst2.some((x) => x.caregiver_id === F.G)),
    `training_version ${tvBefore} -> ${tv2}; new shift [${blocked}]; assigned kept ${still.filter((s) => s.caregiver_id === F.G).length}/3; listed ${[m1, s1, a1].filter((s) => listedIds.includes(s)).length}/3; after retraining [${again}] assign ${rAgain.err || "ok"}; still listed ${lst2.some((x) => x.caregiver_id === F.G)}`);

  // ================= 8. isolation =================
  const reads = {}; const writes = [];
  for (const [label, c] of [["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c]]) {
    let seen = 0;
    for (const [t, col, val] of [["care_plans", "client_id", C], ["service_authorizations", "client_id", C], ["progress_notes", "client_id", C], ["client_documents", "client_id", C],
      ["plan_training_records", "client_id", C], ["plan_inservice_forms", "client_id", C], ["billing_batches", "id", S.batch], ["form_templates", "id", S.iposTpl], ["clients", "id", C]]) {
      const { data } = await c.from(t).select("id").eq(col, val); seen += (data || []).length; }
    reads[label] = seen;
    for (const [fn, args] of [["get_client_onboarding_status", { _client_id: C }], ["list_clients_onboarding", { _office_id: F.OX }], ["review_progress_note", { _note_id: N.n4, _billable: true, _non_billable_reason: null }],
      ["create_care_plan", { _client_id: C, _plan_type: "initial", _header: {} }], ["upsert_client_document", { _client_id: C, _doc_type: "consent", _status: "complete" }],
      ["get_billing_batch", { _batch_id: S.batch }], ["build_billing_batch", { _office_id: F.OX, _week_start: wk }], ["list_caregivers_needing_retraining", { _office_id: F.OX }],
      ["assign_caregiver_to_shift", { _shift_id: b1, _caregiver_id: F.G, _method: "manual", _notes: null, _override_reason: null }], ["create_group_session", { _office_id: F.OX, _session_date: await dbDay(30), _start_time: "09:00", _end_time: "10:00", _staff_client_ratio: null, _max_clients: null }]]) {
      const r = await rpc(c, fn, args); if (!r.err || !(DENY.test(r.err) || /another agency|agency staff/.test(r.err))) writes.push(`${label}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
    const { data: upd } = await c.from("care_plans").update({ status: "expired" }).eq("id", S.plan2).select("id"); if ((upd || []).length) writes.push(`${label} updated care_plans`);
  }
  rec("S8 isolation: the office-Y manager and the agency-B admin see none of Ripple-X's rows and every RPC / direct write is refused",
    pass(reads["office-Y manager"] === 0 && reads["agency-B admin"] === 0 && writes.length === 0), `rows seen ${JSON.stringify(reads)}; ${writes.length ? writes.join("; ") : "20 RPC calls + 2 direct updates refused"}`);

  // ================= 9. rollout regression (real data, read-only) =================
  // (the owner-approved persistent demo office, code RPLDEMO in its own demo agency, is not real data)
  const rr = await pgRead(async (c) => {
    const flagged = (await c.query(`SELECT count(*)::int n FROM public.virtual_office WHERE (compliance_enforcement_enabled OR care_plan_module_enabled) AND name NOT LIKE 'ZZ %' AND code IS DISTINCT FROM 'RPLDEMO'`)).rows[0].n;
    const grouped = (await c.query(`SELECT count(*)::int n FROM public.shifts s JOIN public.virtual_office vo ON vo.id = s.virtual_office_id WHERE s.group_session_id IS NOT NULL AND vo.name NOT LIKE 'ZZ %' AND vo.code IS DISTINCT FROM 'RPLDEMO'`)).rows[0].n;
    const pairs = (await c.query(`
      WITH sh AS (SELECT s.id, s.virtual_office_id FROM public.shifts s JOIN public.virtual_office vo ON vo.id = s.virtual_office_id
                   WHERE vo.name NOT LIKE 'ZZ %' AND vo.code IS DISTINCT FROM 'RPLDEMO' AND s.shift_date >= (now() AT TIME ZONE vo.timezone)::date AND s.status IS DISTINCT FROM 'cancelled'
                   ORDER BY s.shift_date, s.start_time, s.id LIMIT 30),
           pr AS (SELECT sh.id sid, cg.id cid FROM sh CROSS JOIN LATERAL (SELECT id FROM public.caregivers g WHERE g.virtual_office_id = sh.virtual_office_id ORDER BY g.id LIMIT 8) cg)
      SELECT sid, cid, public.check_assignment_eligibility(sid, cid) AS live, public.cp_eligibility_core(sid, cid, '{"rules": false}'::jsonb) AS off FROM pr`)).rows;
    return { flagged, grouped, pairs };
  });
  const differ = rr.pairs.filter((p) => JSON.stringify(p.live) !== JSON.stringify(p.off));
  const newCodes = rr.pairs.filter((p) => ["hard", "soft", "advisory"].some((k) => (p.live[k] || []).some((x) => /credential_missing|training_missing|authorization_|units_short|group_full|not_bookable/.test(x.code))));
  const shifts9 = new Set(rr.pairs.map((p) => p.sid)).size;
  rec("S9.1 rollout regression on REAL data (read-only): every real office has both flags false and no group links; on real upcoming shifts x candidate caregivers the live engine returns exactly today's result (no Phase C rule fires)",
    pass(rr.flagged === 0 && rr.grouped === 0 && rr.pairs.length > 0 && differ.length === 0 && newCodes.length === 0),
    `real offices flagged ${rr.flagged}; real grouped shifts ${rr.grouped}; ${rr.pairs.length} pairs over ${shifts9} shifts: differ from the rules-off result ${differ.length}, Phase C codes ${newCodes.length}`);
  const ky = await ins("shifts", { agency_id: A, virtual_office_id: F.OY, client_id: F.CY, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(W1), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
  F.shifts.push(ky);
  const kyr = await pgRead(async (c) => (await c.query(`SELECT public.check_assignment_eligibility($1, $2) live, public.cp_eligibility_core($1, $2, '{"rules": false}'::jsonb) off,
    (SELECT compliance_enforcement_enabled FROM public.virtual_office WHERE id = $3) x_enf`, [ky, F.GY, F.OX])).rows[0]);
  rec("S9.2 the fixture Kind-Care-like office (flags off) is unaffected while Ripple-X is enforcing", pass(kyr.x_enf === true && JSON.stringify(kyr.live) === JSON.stringify(kyr.off)),
    `Ripple-X enforcing ${kyr.x_enf}; Kind-Care-like result ${JSON.stringify({ eligible: kyr.live.eligible, hard: (kyr.live.hard || []).map((x) => x.code), advisory: (kyr.live.advisory || []).map((x) => x.code) })} = rules-off result`);
}

async function teardownD3(F) {
  if (!F || !F.d3) return;
  const S = F.d3;
  for (const c of S.clients) await admin.from("progress_notes").delete().eq("client_id", c);
  for (const s of F.shifts || []) { await admin.from("shift_assignments").delete().eq("shift_id", s); await admin.from("events").delete().eq("subject_id", s); }
  for (const o of [F.OX, F.OY, F.OZ].filter(Boolean)) await admin.from("billing_batches").delete().eq("virtual_office_id", o);
  for (const g of S.caregivers) { await admin.from("plan_training_records").delete().eq("caregiver_id", g); await admin.from("caregiver_certifications").delete().eq("caregiver_id", g); }
  for (const c of S.clients) { for (const t of ["plan_training_forms", "plan_inservice_forms", "client_documents", "care_plans", "service_authorizations"]) await admin.from(t).delete().eq("client_id", c); }
  for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
  const left = [];
  for (const c of S.clients) for (const t of ["progress_notes", "care_plans", "service_authorizations", "client_documents", "plan_inservice_forms", "plan_training_forms"]) {
    const { data } = await admin.from(t).select("id").eq("client_id", c); if (data && data.length) left.push(`${t} for ${c}`); }
  for (const o of [F.OX, F.OY, F.OZ].filter(Boolean)) { const { data } = await admin.from("billing_batches").select("id").eq("virtual_office_id", o); if (data && data.length) left.push(`billing_batches ${o}`); }
  log(`teardown D3: ${S.clients.length} client, ${S.caregivers.length} caregivers, ${S.templates.length} shells, ${(F.newCredTypes || []).length} new credential types → remaining: ${left.length ? left.join("; ") : "NONE"}`);
}

(async () => {
  log(`=== Ripple Phase D3 end-to-end done-test — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    await scenario(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 400)); }
  finally {
    await teardownD3(F); await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shifts WHERE virtual_office_id = ANY($1::uuid[]))::int shifts,
        (SELECT count(*) FROM public.clients WHERE virtual_office_id = ANY($1::uuid[]))::int clients,
        (SELECT count(*) FROM public.progress_notes WHERE virtual_office_id = ANY($1::uuid[]))::int notes,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR agency_id = $2::uuid)::int ev,
        (SELECT count(*) FROM public.form_templates WHERE name LIKE $3)::int shells,
        (SELECT count(*) FROM public.virtual_office WHERE id = ANY($1::uuid[]))::int offices`, [[F.OX, F.OY, F.OZ], F.B, `ZZ %${RUN}`])).rows[0]);
      log(`D3 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
