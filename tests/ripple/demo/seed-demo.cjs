// Seeds the persistent Ripple demo office on DEV ("Ripple Effects – Demo", owner-approved data write, Oct 6).
// Usage: node tests/ripple/demo/seed-demo.cjs [--apply | --reset]
//   default  DRY RUN, read-only: the planned rows per table and what exists now.
//   --apply  creates the demo office (refuses if it already exists).
//   --reset  tears the demo office down (teardown-demo's count-checked transaction) and seeds it again, so it is back
//            at its starting state (dates are relative to the DB clock: "last week" is always last week).
// Every write goes through the RPC the UI uses where one exists, signed in as the demo user who would do it; tables
// without an RPC (the office, users, caregivers, clients, shifts, skills, case number) are written the way the UI's
// own pages do, with is_demo = true. All names, goals and objectives are fictional and written for this demo.
const D = require("./demo-lib.cjs");
const { admin, pgRead, A, TZ } = D;
const APPLY = process.argv.includes("--apply"), RESET = process.argv.includes("--reset");
const log = (...a) => console.log(...a);

// ---- the scenario (also drives the dry-run plan) ----
const PLAN = {
  virtual_office: 1, profiles: 7, user_roles: 7, caregivers: 3, caregiver_skills: 6, clients: 3,
  form_templates: 10, care_plans: 4, service_authorizations: 4, group_sessions: 1,
};

async function main() {
  log(`=== seed-demo — ${RESET ? "RESET" : APPLY ? "APPLY" : "DRY RUN (read-only)"} ===`);
  const existing = await D.collect();
  log(`demo rows now: ${D.total(existing.ids)} (+ ${existing.authUsers.length} auth users)`);
  if (!APPLY && !RESET) {
    log("planned (main tables):"); for (const [t, n] of Object.entries(PLAN)) log(`  ${t.padEnd(26)} ${n}`);
    log("  + shifts / assignments / progress notes / reviews / one billed bill / credentials / goals / measures / documents / training (see the scenario in tests/ripple/demo/README)");
    log(`passwords: ${D.ENV_PW ? "RIPPLE_DEMO_PASSWORD is set" : "RIPPLE_DEMO_PASSWORD is NOT set -> users would be left without a usable password"}`);
    log(existing.authUsers.length || D.total(existing.ids) ? "the demo exists: use --reset to rebuild it" : "no demo yet: --apply creates it");
    return;
  }
  if (RESET && (D.total(existing.ids) || existing.authUsers.length)) {
    const r = await D.deleteAll(existing, "reset");
    log(`reset: removed ${r.deleted} rows + ${r.authDeleted} auth users; left ${r.left} rows, ${r.authLeft} auth users`);
    if (r.left || r.authLeft) throw new Error("reset teardown left rows");
  } else if (APPLY && (D.total(existing.ids) || existing.authUsers.length)) {
    throw new Error("the demo office already exists: use --reset");
  }
  await seed();
  const after = await D.collect();
  log("seeded rows per table:"); for (const [t, n] of Object.entries(D.counts(after.ids))) if (n) log(`  ${t.padEnd(26)} ${n}`);
  log(`  ${"auth users".padEnd(26)} ${after.authUsers.length}`);
  log(`  total rows: ${D.total(after.ids)}`);
}

// =============================================================================================
async function seed() {
  await D.closeDb();   // fresh read connection
  const must = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
  const one = async (t, row) => { const { data, error } = await admin.from(t).insert(row).select("id").single(); if (error) throw new Error(`${t}: ${error.message}`); return data.id; };
  const clock = await pgRead(async (c) => (await c.query(`SELECT d::text today, (d - (extract(isodow FROM d)::int - 1))::text w0, now() AS now,
    extract(hour FROM now() AT TIME ZONE $1)::int AS hour FROM (SELECT (now() AT TIME ZONE $1)::date d) x`, [TZ])).rows[0]);
  const at = async (base, k) => pgRead(async (c) => (await c.query(`SELECT ($1::date + $2::int)::text d`, [base, k])).rows[0].d);
  const W0 = clock.w0, TODAY = clock.today;
  const day = (k) => at(W0, k);                 // k days after this Monday (negative = earlier weeks)
  log(`clock: today ${TODAY}, this week from ${W0} (office time zone ${TZ})`);

  // ---- office + users ----
  const OFF = await one("virtual_office", { agency_id: A, name: D.OFFICE_NAME, code: D.OFFICE_CODE, timezone: TZ, city: "Portage", state: "MI", is_demo: true });
  const U = {};
  for (const u of D.USERS) {
    const mail = D.email(D.slug(u));
    const { data, error } = await admin.auth.admin.createUser({ email: mail, email_confirm: true, user_metadata: { full_name: u.full, agency_id: A },
      ...(D.ENV_PW ? { password: D.ENV_PW } : {}) });
    if (error) throw new Error(`user ${u.key}: ${error.message}`);
    const id = data.user.id;
    const { error: pe } = await admin.from("profiles").upsert({ id, email: mail, full_name: u.full, agency_id: A, virtual_office_id: OFF, office_restricted: u.restricted });
    if (pe) throw new Error(`profile ${u.key}: ${pe.message}`);
    const { error: re } = await admin.from("user_roles").insert({ user_id: id, role: u.role, agency_id: A }); if (re) throw new Error(`role ${u.key}: ${re.message}`);
    U[u.key] = { id, mail, full: u.full };
  }
  for (const k of Object.keys(U)) U[k].c = await D.session(U[k].id, U[k].mail);
  const { pat, sam, jordan } = U;

  // ---- Flow 1: office setup (module on, shells, credential catalog) ----
  await must(sam.c, "seed_office_care_plan_defaults", { _office_id: OFF });
  // go-live date before the demo history (no RPC sets it; the server stamps "now" when the module is turned on)
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: `${await day(-28)}T08:00:00-04:00` }).eq("id", OFF);
  const shell = async (kind, name, fields, extra = {}) => {
    const v = await must(pat.c, "save_template_draft", { _template_id: null, _office_id: OFF, _kind: kind, _name: name, _intake_doc_type: extra.doc || null,
      _is_required_for_client: extra.doc ? true : null, _sections: [], _note_layout: extra.layout || null, _fields: fields, _service_type: extra.svc || null });
    const t = (await admin.from("form_template_versions").select("template_id").eq("id", v).single()).data.template_id;
    await must(pat.c, "publish_template_version", { _template_id: t }); return t;
  };
  await shell("ipos", "IPOS – Individual Plan of Service", [
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals and objectives", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "important_to", label: "What is important to the person", field_type: "longtext", storage: "field_value" },
    { field_key: "strengths", label: "Strengths and interests", field_type: "longtext", storage: "field_value" }]);
  const noteFields = [{ field_key: "service_date", label: "Date", field_type: "date", storage: "spine_column", writes_to_entity: "progress_note", writes_to_column: "service_date" },
    { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "progress_note_entry" }];
  await shell("progress_note", "CLS Progress Note", noteFields, { layout: { billing_footer: { enabled: true } }, svc: "cls" });
  await shell("progress_note", "Respite Progress Note", noteFields, { layout: { billing_footer: { enabled: true }, narrative: true }, svc: "respite" });
  const DOCS = { assessment: "Intake – Assessment", consent: "Intake – Consent to Services", insurance: "Intake – Insurance", emergency_contacts: "Intake – Emergency Contacts",
    allergies: "Intake – Allergies", release_of_information: "Intake – Release of Information", safety_behavior_plan: "Intake – Safety / Behavior Plan" };
  for (const [d, name] of Object.entries(DOCS)) await shell("intake", name, [{ field_key: "notes", label: "Notes", field_type: "longtext", storage: "field_value" }], { doc: d });

  // ---- caregivers + credentials (HR) ----
  const CG = {};
  for (const [k, first, last] of [["ana", "Ana", "Brooks"], ["ben", "Ben", "Carter"], ["mia", "Mia", "Lopez"]]) {
    CG[k] = await one("caregivers", { agency_id: A, virtual_office_id: OFF, user_id: U[k].id, first_name: first, last_name: last, email: `${first}.${last}@example.com`.toLowerCase(), phone: "555-0140", city: "Portage", state: "MI", is_active: true, is_demo: true });
    const { error } = await admin.from("caregiver_skills").insert([{ caregiver_id: CG[k], care_type_code: "CLS0001", is_demo: true }, { caregiver_id: CG[k], care_type_code: "RESP0001", is_demo: true }]);
    if (error) throw new Error(`skills: ${error.message}`);
  }
  const req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true).order("name")).data;
  const cred = async (g, t, eff, exp) => must(jordan.c, "enter_caregiver_credential", { _caregiver_id: g, _credential_type_id: t, _effective_date: eff, _expiry_date: exp, _certification_number: null });
  const e300 = await day(300), eff = await day(-60);
  for (const t of req) await cred(CG.ana, t.id, eff, e300);
  for (const [i, t] of req.entries()) await cred(CG.ben, t.id, eff, i === 0 ? await at(TODAY, 45) : i === 1 ? await at(TODAY, 20) : e300);   // yellow, red
  for (const t of req.slice(1)) await cred(CG.mia, t.id, eff, e300);                                                                      // the first one lapses later (★)

  // ---- clients ----
  const CL = {};
  for (const [k, first, last, cn, addr] of [["zoe", "Zoe", "Nguyen", "DEMO-1001", "12 Maple Ct"], ["max", "Max", "Ortiz", "DEMO-1002", "48 Birch Ln"], ["lily", "Lily", "Park", "DEMO-1003", "7 Cedar Way"]]) {
    CL[k] = await one("clients", { agency_id: A, virtual_office_id: OFF, first_name: first, last_name: last, phone: "555-0150", address: addr, city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
    await admin.from("clients").update({ case_number: cn }).eq("id", CL[k]);   // the Case number dialog writes the same column
  }
  const mt = Object.fromEntries(((await admin.from("measure_types").select("id, kind, default_options").is("agency_id", null).eq("is_active", true)).data || []).map((m) => [m.kind, m]));
  const objId = async (plan, letter) => (await admin.from("care_plan_objectives").select("id, letter, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", plan).eq("letter", letter).single()).data.id;
  const doc = (client, t, st, na = null) => must(pat.c, "upsert_client_document", { _client_id: client, _doc_type: t, _status: st, _not_applicable_reason: na });
  const allDocs = async (client) => { for (const t of ["assessment", "consent", "insurance", "emergency_contacts", "allergies", "release_of_information"]) await doc(client, t, "complete");
    await doc(client, "safety_behavior_plan", "not_applicable", "No safety or behavior plan in the IPOS"); };
  const auth = (client, svc, num, units, from, to, per = null, cap = null) => must(pat.c, "create_service_authorization", { _client_id: client, _service_type: svc, _auth_number: num,
    _units_authorized: units, _effective_date: from, _expiration_date: to, _service_code: svc === "cls" ? "H2015" : "T1005", _period_type: per, _units_per_period: cap });

  // Flow 2: Zoe — IPOS, goals with data questions, documents, in-service, training v1, two CLS authorizations (FIFO + weekly cap)
  const planZ = await must(pat.c, "create_care_plan", { _client_id: CL.zoe, _plan_type: "initial", _header: { effective_date: await day(-56), expiration_date: await day(300) },
    _field_values: { important_to: "Seeing her friends at the library, music, and choosing her own outings.", strengths: "Friendly, curious, remembers routes around town." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planZ, _goals: [
    { seq: 1, goal_text: "Zoe will build independence in her morning routine.", objectives: [
      { seq: 1, letter: "A", objective_text: "Zoe will brush her teeth with no more than one verbal prompt.", staff_instructions: "Lay out the toothbrush and paste. Model once, then wait ten seconds before prompting.", service_type: "cls", responsible_party: "this_agency" }] },
    { seq: 2, goal_text: "Zoe will take part in community activities she chooses.", objectives: [
      { seq: 1, letter: "B", objective_text: "Zoe will choose and join one community outing each visit.", staff_instructions: "Offer two choices and let Zoe lead the way. Note how she chose.", service_type: "cls", responsible_party: "this_agency" },
      { seq: 2, letter: "C", objective_text: "Case manager will review bus pass options with the family.", responsible_party: "case_management" }] },
    { seq: 3, goal_text: "Zoe will practice handling money safely.", objectives: [
      { seq: 1, letter: "D", objective_text: "Zoe will count change for a purchase under $10.", staff_instructions: "Use real coins at the store. Praise each correct count; help only if she asks.", service_type: "cls", responsible_party: "this_agency" }] }] });
  const opt = (k, fallback) => (Array.isArray(mt[k]?.default_options) && mt[k].default_options.length ? mt[k].default_options : fallback);
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planZ, "A"), _measures: [
    { measure_type_id: mt.prompt_level.id, seq: 1, prompt_text: "Highest prompt level used", options: opt("prompt_level", ["Independent", "Verbal", "Gestural", "Physical"]) },
    { measure_type_id: mt.graded_steps.id, seq: 2, prompt_text: "Steps completed", options: opt("graded_steps", ["Get supplies", "Brush", "Rinse", "Put away"]) }] });
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planZ, "B"), _measures: [
    { measure_type_id: mt.yes_no_na.id, seq: 1, prompt_text: "Took part in the outing?" },
    { measure_type_id: mt.short_answer.id, seq: 2, prompt_text: "Where did Zoe choose to go?" },
    { measure_type_id: mt.narrative.id, seq: 3, prompt_text: "How did Zoe make her choice?" }] });
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planZ, "D"), _measures: [
    { measure_type_id: mt.trials.id, seq: 1, prompt_text: "Counted the change correctly", trial_count: 3 },
    { measure_type_id: mt.tally.id, seq: 2, prompt_text: "Times Zoe asked for help" }] });
  await allDocs(CL.zoe);
  const t54 = await day(-54);
  await must(jordan.c, "record_inservice_form", { _care_plan_id: planZ, _case_manager_name: "Robin Hale (case manager)", _program_lead_id: pat.id, _trained_on: await day(-55), _signed_at: clock.now });
  await must(jordan.c, "record_training_form", { _care_plan_id: planZ, _plan_document_type: "ipos_initial", _plan_effective_date: await day(-56), _location: "Demo office",
    _records: ["ana", "ben", "mia"].map((k) => ({ caregiver_id: CG[k], training_date: t54 })) });
  await auth(CL.zoe, "cls", "DEMO-AUTH-1001-A", 20, await day(-56), await day(20));
  await auth(CL.zoe, "cls", "DEMO-AUTH-1001-B", 400, await day(-56), await day(150), "per_week", 16);

  // Max — respite only
  const planM = await must(pat.c, "create_care_plan", { _client_id: CL.max, _plan_type: "initial", _header: { effective_date: await day(-56), expiration_date: await day(300) },
    _field_values: { important_to: "Quiet time with board games and his dog.", strengths: "Patient, great at card games." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planM, _goals: [{ seq: 1, goal_text: "Max will spend relaxed, safe time at home while his family takes a break.", objectives: [
    { seq: 1, letter: "A", objective_text: "Max will choose an activity at the start of each respite visit.", staff_instructions: "Offer the game shelf and a walk with the dog.", service_type: "respite", responsible_party: "this_agency" }] }] });
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planM, "A"), _measures: [{ measure_type_id: mt.yes_no_na.id, seq: 1, prompt_text: "Chose an activity?" }] });
  await allDocs(CL.max);
  await must(jordan.c, "record_inservice_form", { _care_plan_id: planM, _case_manager_name: "Robin Hale (case manager)", _program_lead_id: pat.id, _trained_on: await day(-55), _signed_at: clock.now });
  await must(jordan.c, "record_training_form", { _care_plan_id: planM, _plan_document_type: "ipos_initial", _plan_effective_date: await day(-56), _location: "Demo office",
    _records: ["ana", "mia"].map((k) => ({ caregiver_id: CG[k], training_date: t54 })) });
  await auth(CL.max, "respite", "DEMO-AUTH-1002-R", 120, await day(-56), await day(120));

  // Lily — onboarding 5 of 8 (in-service, training and the note set-up still missing)
  const planL = await must(pat.c, "create_care_plan", { _client_id: CL.lily, _plan_type: "initial", _header: { effective_date: await day(-7), expiration_date: await day(358) },
    _field_values: { important_to: "Art class and cooking simple meals.", strengths: "Creative, likes clear step-by-step lists." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planL, _goals: [{ seq: 1, goal_text: "Lily will prepare a simple lunch on her own.", objectives: [
    { seq: 1, letter: "A", objective_text: "Lily will follow a picture recipe for a sandwich.", staff_instructions: "Point to each picture step; wait before helping.", service_type: "cls", responsible_party: "this_agency" }] }] });
  await allDocs(CL.lily);
  await auth(CL.lily, "cls", "DEMO-AUTH-1003-A", 80, await day(-7), await day(120));

  // ---- shifts, assignments, notes (Flows 3–5) ----
  const shift = async (client, d, start, end, code = "CLS0001") => one("shifts", { agency_id: A, virtual_office_id: OFF, client_id: client, order_title: code === "CLS0001" ? "Community Living Supports" : "Respite",
    care_type_code: code, shift_date: d, start_time: start, end_time: end, duration_hours: (Number(end.slice(0, 2)) - Number(start.slice(0, 2))), status: "open", is_demo: true });
  const assign = async (s, g) => {
    let r = await pat.c.rpc("assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: null, _override_reason: null });
    if (r.error && /override/i.test(r.error.message)) r = await pat.c.rpc("assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: null, _override_reason: "Scheduled with the family" });
    if (r.error) throw new Error(`assign: ${r.error.message}`);
  };
  const answer = (m) => ({ yes_no_na: { value: "Yes" }, prompt_level: { value: (m.options || [])[1] ?? (m.options || [])[0] }, graded_steps: { steps: [1, 2, 3] }, tally: { count: 1 },
    trials: { trials: Array.from({ length: m.trial_count || 0 }, (_, i) => ({ value: i === 1 ? "No" : "Yes" })) }, short_answer: { value: "Public library" },
    narrative: { value: "Zoe compared the two options and picked the library to return her book." } }[m.kind]);
  const note = async (s, who, { lateMin = 0, submit = true } = {}) => {
    const c = U[who].c;
    const n = await must(c, "create_progress_note_for_shift", { _shift_id: s });
    const v = await must(c, "get_progress_note_for_caregiver", { _note_id: n });
    const row = (await admin.from("progress_notes").select("scheduled_start, scheduled_end, note_kind").eq("id", n).single()).data;
    const entries = (v.entries || []).filter((e) => (e.measures || []).length).map((e) => ({ entry_id: e.entry_id,
      data: Object.fromEntries(e.measures.filter((m) => m.kind !== "staff_note").map((m) => [m.measure_id, answer(m)])) }));
    await must(c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(row.scheduled_start) + lateMin * 60000).toISOString(),
      actual_end: row.scheduled_end, location: row.note_kind === "respite" ? "Family home" : "Community", staff_client_ratio: "1:1" }, _entries: entries,
      _narrative_text: row.note_kind === "respite" ? "Max chose a card game, then we walked the dog around the block. He was calm and cheerful." : null });
    if (submit) await must(c, "submit_progress_note", { _note_id: n, _typed_signature: U[who].full });
    return n;
  };
  const review = (n) => must(pat.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  const S = {};
  // week before last (W0-14 .. W0-8): billed
  const wb = [];
  for (const [k, d, who] of [["zb1", -14, "ana"], ["zb2", -12, "ben"], ["zb3", -10, "ana"]]) { S[k] = await shift(CL.zoe, await day(d), "09:00", "10:00"); await assign(S[k], CG[who]); wb.push([S[k], who]); }
  S.mb1 = await shift(CL.max, await day(-13), "14:00", "16:00", "RESP0001"); await assign(S.mb1, CG.mia); wb.push([S.mb1, "mia"]);
  const nb = []; for (const [s, who] of wb) nb.push(await note(s, who));
  for (const n of nb) await review(n);
  const wsB = await day(-14);
  await must(pat.c, "build_billing_batch", { _office_id: OFF, _week_start: wsB });
  const wkB = await must(pat.c, "get_billing_week", { _office_id: OFF, _week_start: wsB });
  const bB = wkB.batches[0];
  await must(pat.c, "approve_batch_notes", { _batch_id: bB.id, _note_ids: bB.lines.flatMap((l) => l.notes.map((x) => x.note_id)) });
  await must(pat.c, "mark_batch_billed", { _batch_id: bB.id });
  // last week (W0-7 .. W0-1): reviewed except one Submitted, one Returned, one overdue (no note); one late arrival
  S.z1 = await shift(CL.zoe, await day(-7), "09:00", "10:00"); await assign(S.z1, CG.ana);
  S.z2 = await shift(CL.zoe, await day(-6), "09:00", "10:00"); await assign(S.z2, CG.ben);
  S.z3 = await shift(CL.zoe, await day(-5), "09:00", "10:00"); await assign(S.z3, CG.mia);
  S.z4 = await shift(CL.zoe, await day(-4), "09:00", "10:00"); await assign(S.z4, CG.ana);
  S.z5 = await shift(CL.zoe, await day(-3), "09:00", "10:00"); await assign(S.z5, CG.ben);
  S.m1 = await shift(CL.max, await day(-6), "14:00", "16:00", "RESP0001"); await assign(S.m1, CG.mia);
  S.m2 = await shift(CL.max, await day(-4), "14:00", "16:00", "RESP0001"); await assign(S.m2, CG.ana);   // overdue: no note
  const n1 = await note(S.z1, "ana"), n2 = await note(S.z2, "ben", { lateMin: 7 }), n3 = await note(S.z3, "mia"), n4 = await note(S.z4, "ana"), n5 = await note(S.z5, "ben"), nm1 = await note(S.m1, "mia");
  for (const n of [n1, n2, nm1, n4]) await review(n);   // date order -> FIFO: authorization A first, then B
  await must(pat.c, "return_progress_note", { _note_id: n5, _reason: "Please add how Zoe counted the change at the store." });
  // this week + the next two weeks
  const upcoming = [];
  if (clock.hour >= 7) { S.today = await shift(CL.zoe, TODAY, "06:00", "07:00"); await assign(S.today, CG.ana); await note(S.today, "ana", { submit: false }); }   // a draft
  else log("before 07:00 office time: today's draft visit is skipped");
  for (let k = 0; k <= 20; k++) {
    const d = await day(k); if (d <= TODAY) continue;
    const dow = k % 7;   // 0 = Monday
    if (dow === 0 || dow === 2 || dow === 4) upcoming.push(["zoe", d, "09:00", "10:00", "CLS0001", dow === 2 && k >= 7 && k < 14 ? "mia" : dow === 2 ? "ben" : "ana"]);
    if (dow === 3 && k >= 7 && k < 14) upcoming.push(["zoe", d, "09:00", "10:00", "CLS0001", null]);          // left unassigned for the live assign
    if (dow === 1) upcoming.push(["max", d, "14:00", "16:00", "RESP0001", "ana"]);
    if (dow === 3) upcoming.push(["max", d, "14:00", "16:00", "RESP0001", "mia"]);
  }
  for (const [c, d, s, e, code, who] of upcoming) { const id = await shift(CL[c], d, s, e, code); if (who) await assign(id, CG[who]); if (c === "zoe" && !who) S.open = id; }
  // a CLS group session 1:2 (Zoe + Lily) next Tuesday with Ana
  const gd = await day(8);
  const gs = await must(pat.c, "create_group_session", { _office_id: OFF, _session_date: gd, _start_time: "10:00", _end_time: "11:00", _staff_client_ratio: "1:2", _max_clients: 2 });
  for (const c of ["zoe", "lily"]) { const id = await shift(CL[c], gd, "10:00", "11:00"); await must(pat.c, "set_shift_group_session", { _shift_id: id, _group_session_id: gs }); await assign(id, CG.ana); }

  // Zoe's renewal -> IPOS v2; in-service v2; Ana and Ben retrained, Mia not (her next Zoe visit needs retraining)
  const planZ2 = await must(pat.c, "renew_care_plan", { _care_plan_id: planZ });
  await must(jordan.c, "record_inservice_form", { _care_plan_id: planZ2, _case_manager_name: "Robin Hale (case manager)", _program_lead_id: pat.id, _trained_on: TODAY, _signed_at: clock.now });
  await must(jordan.c, "record_training_form", { _care_plan_id: planZ2, _plan_document_type: "ipos_annual", _plan_effective_date: null, _location: "Demo office",
    _records: ["ana", "ben"].map((k) => ({ caregiver_id: CG[k], training_date: TODAY })) });
  // Mia's first required credential is entered as lapsed (★ overdue) after her visits were scheduled
  await cred(CG.mia, req[0].id, await at(TODAY, -400), await at(TODAY, -5));
  // enforcement stays OFF so the demo can switch it on live
  log(D.lockPasswords ? await D.lockPasswords(Object.values(U).map((u) => u.id)) : "");
  log(`office ${D.OFFICE_NAME}: module on, enforcement off; plans Zoe v2 / Max / Lily; the week before last billed (${wsB}); last week not built`);
}

main().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());
