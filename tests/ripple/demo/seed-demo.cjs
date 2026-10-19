// Seeds the persistent Ripple demo on DEV: its own agency "Ripple Effects – Demo Agency" with the office "Ripple Effects – Demo"
// (owner-approved data write, Oct 6; own agency per the owner's decision (b)).
// Usage: node tests/ripple/demo/seed-demo.cjs [--apply | --reset] [--as-of YYYY-MM-DD]
//   default  DRY RUN, read-only: the planned rows per table and what exists now.
//   --apply  creates the demo office (refuses if it already exists).
//   --reset  tears the demo office down (teardown-demo's count-checked transaction) and seeds it again.
//   --as-of  the demo day (default: today in the office time zone). Every date is relative to it, so the office can be
//            seeded the day before for the next day's demo. It can't be earlier than today, and every visit that gets a
//            note must already be over by the DB clock (checked before anything is touched).
// Every state of the demo is deliberate (Oct 19 rebuild for the Oct 20 demo; verify-demo checks each one with exact
// counts): every past visit has a note except the listed cases; exactly 2 overdue (Ben's returned note, Ana's
// respite visit with no note); 1 note waiting for review (Mia, last Wednesday); Ana's CLS visit on the demo day at 08:00
// has no note yet (written live). Every write goes through the RPC the UI uses where one exists, signed in as the demo
// user who would do it; tables without an RPC (the office, users, caregivers, clients, shifts, skills, case number) are
// written the way the UI's own pages do, with is_demo = true. All names, goals and objectives are fictional.
const D = require("./demo-lib.cjs");
const { admin, pgRead, TZ } = D;
const APPLY = process.argv.includes("--apply"), RESET = process.argv.includes("--reset");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const log = (...a) => console.log(...a);

// ---- the scenario (also drives the dry-run plan) ----
const PLAN = {
  agency: 1, virtual_office: 1, profiles: 9, credential_types: "the default catalog", user_roles: 9, caregivers: 5, caregiver_skills: 10, clients: 5,
  form_templates: 10, care_plans: 6, service_authorizations: 6, group_sessions: 2,
};
// Visits, by day offset from the demo week's Sunday (W0; billing week Sunday–Saturday). note: reviewed | submitted |
// returned | none. "D" = the demo day itself. Times are office time.
const ZOE = "zoe", MAX = "max", NOAH = "noah", ELLA = "ella";
const CLS = "CLS0001", RESP = "RESP0001";
const WEEK_BEFORE = [   // billed and locked
  [ZOE, -13, "09:00", "10:00", CLS, "ana"], [ZOE, -11, "09:00", "10:00", CLS, "ben"], [ZOE, -9, "09:00", "10:00", CLS, "ana"],
  [MAX, -12, "14:00", "16:00", RESP, "mia"],
  [NOAH, -12, "13:00", "14:00", CLS, "leo"], [NOAH, -10, "13:00", "14:00", CLS, "leo"],
  [ELLA, -13, "11:00", "13:00", RESP, "ivy"], [ELLA, -11, "11:00", "13:00", RESP, "ivy"],
].map(([c, k, s, e, code, who]) => ({ c, k, s, e, code, who, note: "reviewed", week: "before" }));
const LAST_WEEK = [     // not built: every state the review and the bill need
  { c: ZOE, k: -6, s: "09:00", e: "10:00", code: CLS, who: "ana", note: "reviewed" },
  { c: ZOE, k: -5, s: "09:00", e: "10:00", code: CLS, who: "ben", note: "reviewed", lateMin: 20 },      // 09:20 arrival: 2 of 4
  { c: ZOE, k: -4, s: "09:00", e: "10:00", code: CLS, who: "mia", note: "submitted" },                  // waiting for review
  { c: ZOE, k: -3, s: "09:00", e: "10:00", code: CLS, who: "ana", note: "reviewed", earlyMin: 10 },     // 09:50 end: 3 of 4
  { c: ZOE, k: -2, s: "09:00", e: "10:00", code: CLS, who: "ben", note: "returned" },                   // overdue #1
  { c: MAX, k: -5, s: "14:00", e: "16:00", code: RESP, who: "mia", note: "reviewed" },
  { c: MAX, k: -3, s: "14:00", e: "16:00", code: RESP, who: "ana", note: "none" },                      // overdue #2 (Ana's)
  { c: NOAH, k: -5, s: "13:00", e: "14:00", code: CLS, who: "leo", note: "reviewed" },
  { c: NOAH, k: -3, s: "13:00", e: "14:00", code: CLS, who: "leo", note: "reviewed" },
  { c: ELLA, k: -6, s: "11:00", e: "13:00", code: RESP, who: "ivy", note: "reviewed" },
  { c: ELLA, k: -4, s: "11:00", e: "13:00", code: RESP, who: "ivy", note: "reviewed" },
  // CLS group session 1:2 with Ben: Zoe + Noah, both notes reviewed
  { c: ZOE, k: -4, s: "11:00", e: "12:00", code: CLS, who: "ben", note: "reviewed", group: "past" },
  { c: NOAH, k: -4, s: "11:00", e: "12:00", code: CLS, who: "ben", note: "reviewed", group: "past" },
].map((v) => ({ ...v, week: "last" }));
// the weekly pattern of the current week (before the demo day: notes reviewed) and the next two weeks (no notes)
function pattern(k) {
  const dow = ((k % 7) + 7) % 7, out = [];   // 0 = Sunday
  if (dow === 1 || dow === 3 || dow === 5) out.push({ c: ZOE, s: "09:00", e: "10:00", code: CLS, who: dow === 3 && k >= 7 && k < 14 ? "mia" : dow === 3 ? "ben" : dow === 1 && k < 7 ? "ben" : "ana" });
  if (dow === 4 && k >= 7 && k < 14) out.push({ c: ZOE, s: "09:00", e: "10:00", code: CLS, who: null });  // unassigned: the live assign
  if (dow === 2) out.push({ c: MAX, s: "14:00", e: "16:00", code: RESP, who: "ana" });
  if (dow === 4) out.push({ c: MAX, s: "14:00", e: "16:00", code: RESP, who: "mia" });
  if (dow === 2 || dow === 4) out.push({ c: NOAH, s: "13:00", e: "14:00", code: CLS, who: "leo" });
  if (dow === 1 || dow === 3) out.push({ c: ELLA, s: "11:00", e: "13:00", code: RESP, who: "ivy" });
  return out.map((v) => ({ ...v, k }));
}
function visits(dOff) {   // dOff = the demo day's offset from W0 (0..6)
  const v = [...WEEK_BEFORE, ...LAST_WEEK];
  for (let k = 0; k < dOff; k++) for (const x of pattern(k)) v.push({ ...x, note: "reviewed", week: "this" });
  v.push({ c: ZOE, k: dOff, s: "08:00", e: "09:00", code: CLS, who: "ana", note: "none", week: "this", live: true });   // written live
  for (let k = dOff + 1; k <= 20; k++) for (const x of pattern(k)) v.push({ ...x, note: "none", week: "future" });
  // next Tuesday: a CLS group session 1:2 with Ana (Zoe + Noah)
  for (const c of [ZOE, NOAH]) v.push({ c, k: 9, s: "10:00", e: "11:00", code: CLS, who: "ana", note: "none", week: "future", group: "next" });
  return v;
}

async function dates() {
  const r = await pgRead(async (c) => (await c.query(`SELECT (now() AT TIME ZONE $1)::date::text today, extract(hour FROM now() AT TIME ZONE $1)::int AS hr, now() AS now`, [TZ])).rows[0]);
  const asOf = arg("--as-of") || r.today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of must be YYYY-MM-DD");
  if (asOf < r.today) throw new Error(`--as-of ${asOf} is before today (${r.today}): past visits would have no notes`);
  const w = await pgRead(async (c) => (await c.query(`SELECT ($1::date - (extract(isodow FROM $1::date)::int % 7))::text w0, (extract(isodow FROM $1::date)::int % 7) doff`, [asOf])).rows[0]);
  const vs = visits(w.doff);
  // every visit that gets a note must be over by the DB clock (a caregiver can only open / submit a started visit)
  const last = vs.filter((v) => v.note !== "none").map((v) => ({ v, d: null }));
  const ends = await pgRead(async (c) => (await c.query(`SELECT max((($1::date + k) + e::time) AT TIME ZONE $2) last_end, max((($1::date + k) + e::time) AT TIME ZONE $2) <= now() ok
    FROM unnest($3::int[], $4::text[]) x(k, e)`, [w.w0, TZ, last.map((x) => x.v.k), last.map((x) => x.v.e)])).rows[0]);
  return { ...r, asOf, W0: w.w0, dOff: w.doff, vs, lastEnd: ends.last_end, endsOk: ends.ok };
}

async function main() {
  log(`=== seed-demo — ${RESET ? "RESET" : APPLY ? "APPLY" : "DRY RUN (read-only)"} ===`);
  const C = await dates();
  log(`demo day ${C.asOf} (today ${C.today}); billing week from ${C.W0}; latest visit with a note ends ${new Date(C.lastEnd).toISOString()} (${C.endsOk ? "over" : "NOT over yet"})`);
  const existing = await D.collect();
  log(`demo rows now: ${D.total(existing.ids)} (+ ${existing.authUsers.length} auth users)`);
  if (!APPLY && !RESET) {
    log("planned (main tables):"); for (const [t, n] of Object.entries(PLAN)) log(`  ${t.padEnd(26)} ${n}`);
    const by = (f) => C.vs.filter(f).length;
    log(`  visits: ${C.vs.length} (week before ${by((v) => v.week === "before")}, last week ${by((v) => v.week === "last")}, this week before the demo day ${by((v) => v.week === "this" && !v.live)}, demo day 1, future ${by((v) => v.week === "future")}); unassigned ${by((v) => !v.who)}`);
    log(`passwords: ${D.ENV_PW ? "RIPPLE_DEMO_PASSWORD is set" : "RIPPLE_DEMO_PASSWORD is NOT set -> users would be left without a usable password"}`);
    log(existing.authUsers.length || D.total(existing.ids) ? "the demo exists: use --reset to rebuild it" : "no demo yet: --apply creates it");
    return;
  }
  if (!C.endsOk) throw new Error(`REFUSED before any change: the last visit that gets a note ends ${new Date(C.lastEnd).toISOString()}; seed after that`);
  if (C.hr >= 20) throw new Error("REFUSED before any change: after 8 pm office time the UTC date is already tomorrow (the dashboard's 'today'); seed in the morning");
  if (RESET && (D.total(existing.ids) || existing.authUsers.length)) {
    const r = await D.deleteAll(existing, "reset");
    log(`reset: removed ${r.deleted} rows + ${r.authDeleted} auth users; left ${r.left} rows, ${r.authLeft} auth users`);
    if (r.left || r.authLeft) throw new Error("reset teardown left rows");
  } else if (APPLY && (D.total(existing.ids) || existing.authUsers.length)) {
    throw new Error("the demo office already exists: use --reset");
  }
  await seed(C);
  const after = await D.collect();
  log("seeded rows per table:"); for (const [t, n] of Object.entries(D.counts(after.ids))) if (n) log(`  ${t.padEnd(26)} ${n}`);
  log(`  ${"auth users".padEnd(26)} ${after.authUsers.length}`);
  log(`  total rows: ${D.total(after.ids)}`);
}

// =============================================================================================
async function seed(C) {
  await D.closeDb();   // fresh read connection
  const must = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
  const one = async (t, row) => { const { data, error } = await admin.from(t).insert(row).select("id").single(); if (error) throw new Error(`${t}: ${error.message}`); return data.id; };
  const now = (await pgRead(async (c) => (await c.query(`SELECT now() AS now`)).rows[0])).now;
  const at = async (base, k) => pgRead(async (c) => (await c.query(`SELECT ($1::date + $2::int)::text d`, [base, k])).rows[0].d);
  const W0 = C.W0, DAY = C.asOf, TODAY = C.today;   // DAY = the demo day; TODAY = the DB date (training / signatures can't be later)
  const day = (k) => at(W0, k);                 // k days after the demo week's Sunday (billing week Sun–Sat; Monday = 1)
  log(`clock: today ${TODAY}, demo day ${DAY}, billing week (Sun–Sat) from ${W0} (office time zone ${TZ})`);

  // ---- the demo agency (no RPC creates an agency; the test fixtures insert it the same way) + office + users ----
  const A = await one("agency", { agency_name: D.AGENCY_NAME, city: "Portage", state: "MI", is_active: true });
  // Ripple's billing week is Sunday–Saturday (Q11): the existing per-office setting, ISO day 7 = Sunday
  const OFF = await one("virtual_office", { agency_id: A, name: D.OFFICE_NAME, code: D.OFFICE_CODE, timezone: TZ, city: "Portage", state: "MI", billing_week_start: 7, is_demo: true });
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
  for (const [k, first, last] of [["ana", "Ana", "Brooks"], ["ben", "Ben", "Carter"], ["mia", "Mia", "Lopez"], ["leo", "Leo", "Grant"], ["ivy", "Ivy", "Chen"]]) {
    CG[k] = await one("caregivers", { agency_id: A, virtual_office_id: OFF, user_id: U[k].id, first_name: first, last_name: last, email: `${first}.${last}@example.com`.toLowerCase(), phone: "555-0140", city: "Portage", state: "MI", is_active: true, is_demo: true });
    const { error } = await admin.from("caregiver_skills").insert([{ caregiver_id: CG[k], care_type_code: CLS, is_demo: true }, { caregiver_id: CG[k], care_type_code: RESP, is_demo: true }]);
    if (error) throw new Error(`skills: ${error.message}`);
  }
  const req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true).order("name")).data;
  const cred = async (g, t, eff, exp) => must(jordan.c, "enter_caregiver_credential", { _caregiver_id: g, _credential_type_id: t, _effective_date: eff, _expiry_date: exp, _certification_number: null });
  const e300 = await at(DAY, 300), eff = await at(DAY, -60);
  for (const k of ["ana", "leo", "ivy"]) for (const t of req) await cred(CG[k], t.id, eff, e300);                              // all green
  for (const [i, t] of req.entries()) await cred(CG.ben, t.id, eff, i === 0 ? await at(DAY, 45) : i === 1 ? await at(DAY, 20) : e300);   // yellow, red
  for (const t of req.slice(1)) await cred(CG.mia, t.id, eff, e300);                                                                     // the first one lapses later (★)

  // ---- clients ----
  const CL = {};
  for (const [k, first, last, cn, addr] of [["zoe", "Zoe", "Nguyen", "DEMO-1001", "12 Maple Ct"], ["max", "Max", "Ortiz", "DEMO-1002", "48 Birch Ln"], ["lily", "Lily", "Park", "DEMO-1003", "7 Cedar Way"],
    ["noah", "Noah", "Kim", "DEMO-1004", "31 Elm St"], ["ella", "Ella", "Shaw", "DEMO-1005", "5 Willow Dr"]]) {
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
  const t54 = await day(-54);
  const inservice = (plan, on) => must(jordan.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "Robin Hale (case manager)", _program_lead_id: pat.id, _trained_on: on, _signed_at: now });
  const train = (plan, type, eff0, who, on) => must(jordan.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: type, _plan_effective_date: eff0, _location: "Demo office",
    _records: who.map((k) => ({ caregiver_id: CG[k], training_date: on })) });

  // Flow 2: Zoe — IPOS, goals with data questions, documents, in-service, training v1, two CLS authorizations
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
  await inservice(planZ, await day(-55));
  await train(planZ, "ipos_initial", await day(-56), ["ana", "ben", "mia"], t54);
  // A: expires 12 days after the demo day with more units than the scheduled visits use -> units at risk; B: healthy, 16 per week
  await auth(CL.zoe, "cls", "DEMO-AUTH-1001-A", 90, await day(-56), await at(DAY, 12));
  await auth(CL.zoe, "cls", "DEMO-AUTH-1001-B", 400, await day(-56), await at(DAY, 150), "per_week", 16);

  // Max — respite only
  const planM = await must(pat.c, "create_care_plan", { _client_id: CL.max, _plan_type: "initial", _header: { effective_date: await day(-56), expiration_date: await day(300) },
    _field_values: { important_to: "Quiet time with board games and his dog.", strengths: "Patient, great at card games." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planM, _goals: [{ seq: 1, goal_text: "Max will spend relaxed, safe time at home while his family takes a break.", objectives: [
    { seq: 1, letter: "A", objective_text: "Max will choose an activity at the start of each respite visit.", staff_instructions: "Offer the game shelf and a walk with the dog.", service_type: "respite", responsible_party: "this_agency" }] }] });
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planM, "A"), _measures: [{ measure_type_id: mt.yes_no_na.id, seq: 1, prompt_text: "Chose an activity?" }] });
  await allDocs(CL.max);
  await inservice(planM, await day(-55));
  await train(planM, "ipos_initial", await day(-56), ["ana", "mia"], t54);
  await auth(CL.max, "respite", "DEMO-AUTH-1002-R", 120, await day(-56), await at(DAY, 105));

  // Lily — onboarding 5 of 8 (in-service, training and the note set-up still missing); no visits
  const planL = await must(pat.c, "create_care_plan", { _client_id: CL.lily, _plan_type: "initial", _header: { effective_date: await at(DAY, -7), expiration_date: await at(DAY, 358) },
    _field_values: { important_to: "Art class and cooking simple meals.", strengths: "Creative, likes clear step-by-step lists." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planL, _goals: [{ seq: 1, goal_text: "Lily will prepare a simple lunch on her own.", objectives: [
    { seq: 1, letter: "A", objective_text: "Lily will follow a picture recipe for a sandwich.", staff_instructions: "Point to each picture step; wait before helping.", service_type: "cls", responsible_party: "this_agency" }] }] });
  await allDocs(CL.lily);
  await auth(CL.lily, "cls", "DEMO-AUTH-1003-A", 80, await at(DAY, -7), await at(DAY, 120));

  // background clients (fully onboarded): Noah — CLS (the group sessions with Zoe); Ella — respite
  const planN = await must(pat.c, "create_care_plan", { _client_id: CL.noah, _plan_type: "initial", _header: { effective_date: await day(-56), expiration_date: await day(300) },
    _field_values: { important_to: "Basketball at the community center and time with his brother.", strengths: "Energetic, good with schedules." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planN, _goals: [{ seq: 1, goal_text: "Noah will use the bus to get to the community center.", objectives: [
    { seq: 1, letter: "A", objective_text: "Noah will read the bus timetable and pick the right bus.", staff_instructions: "Let Noah find the time first; confirm before you leave.", service_type: "cls", responsible_party: "this_agency" }] }] });
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planN, "A"), _measures: [
    { measure_type_id: mt.yes_no_na.id, seq: 1, prompt_text: "Picked the right bus?" }, { measure_type_id: mt.tally.id, seq: 2, prompt_text: "Prompts needed" }] });
  await allDocs(CL.noah);
  await inservice(planN, await day(-55));
  await train(planN, "ipos_initial", await day(-56), ["ana", "ben", "leo"], t54);
  await auth(CL.noah, "cls", "DEMO-AUTH-1004-A", 300, await day(-56), await at(DAY, 150));
  const planE = await must(pat.c, "create_care_plan", { _client_id: CL.ella, _plan_type: "initial", _header: { effective_date: await day(-56), expiration_date: await day(300) },
    _field_values: { important_to: "Gardening and audiobooks.", strengths: "Calm, enjoys conversation." } });
  await must(pat.c, "upsert_care_plan_goals", { _care_plan_id: planE, _goals: [{ seq: 1, goal_text: "Ella will enjoy calm, safe time at home while her parents are out.", objectives: [
    { seq: 1, letter: "A", objective_text: "Ella will pick a quiet activity at the start of the visit.", staff_instructions: "Offer the garden or an audiobook.", service_type: "respite", responsible_party: "this_agency" }] }] });
  await must(pat.c, "set_objective_measures", { _objective_id: await objId(planE, "A"), _measures: [{ measure_type_id: mt.yes_no_na.id, seq: 1, prompt_text: "Chose an activity?" }] });
  await allDocs(CL.ella);
  await inservice(planE, await day(-55));
  await train(planE, "ipos_initial", await day(-56), ["ivy"], t54);
  await auth(CL.ella, "respite", "DEMO-AUTH-1005-R", 300, await day(-56), await at(DAY, 150));

  // ---- shifts, assignments, notes (Flows 3–5) ----
  const hours = (s, e) => (Number(e.slice(0, 2)) * 60 + Number(e.slice(3, 5)) - Number(s.slice(0, 2)) * 60 - Number(s.slice(3, 5))) / 60;
  const shift = async (client, d, start, end, code) => one("shifts", { agency_id: A, virtual_office_id: OFF, client_id: client, order_title: code === CLS ? "Community Living Supports" : "Respite",
    care_type_code: code, shift_date: d, start_time: start, end_time: end, duration_hours: hours(start, end), status: "open", is_demo: true });
  const assign = async (s, g) => {
    let r = await pat.c.rpc("assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: null, _override_reason: null });
    if (r.error && /override/i.test(r.error.message)) r = await pat.c.rpc("assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: null, _override_reason: "Scheduled with the family" });
    if (r.error) throw new Error(`assign: ${r.error.message}`);
  };
  const NARR = { max: "Max chose a card game, then we walked the dog around the block. He was calm and cheerful.", ella: "Ella picked an audiobook, then we watered the garden together. Calm, relaxed visit." };
  const answer = (m) => ({ yes_no_na: { value: "Yes" }, prompt_level: { value: (m.options || [])[1] ?? (m.options || [])[0] }, graded_steps: { steps: [1, 2, 3] }, tally: { count: 1 },
    trials: { trials: Array.from({ length: m.trial_count || 0 }, (_, i) => ({ value: i === 1 ? "No" : "Yes" })) }, short_answer: { value: "Public library" },
    narrative: { value: "Zoe compared the two options and picked the library to return her book." } }[m.kind]);
  const note = async (s, v) => {
    const c = U[v.who].c;
    const n = await must(c, "create_progress_note_for_shift", { _shift_id: s });
    const nv = await must(c, "get_progress_note_for_caregiver", { _note_id: n });
    const row = (await admin.from("progress_notes").select("scheduled_start, scheduled_end, note_kind").eq("id", n).single()).data;
    const entries = (nv.entries || []).filter((e) => (e.measures || []).length).map((e) => ({ entry_id: e.entry_id,
      data: Object.fromEntries(e.measures.filter((m) => m.kind !== "staff_note").map((m) => [m.measure_id, answer(m)])) }));
    await must(c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(row.scheduled_start) + (v.lateMin || 0) * 60000).toISOString(),
      actual_end: new Date(Date.parse(row.scheduled_end) - (v.earlyMin || 0) * 60000).toISOString(), location: row.note_kind === "respite" ? "Family home" : "Community", staff_client_ratio: v.group ? "1:2" : "1:1" }, _entries: entries,
      _narrative_text: row.note_kind === "respite" ? NARR[v.c] : null });
    await must(c, "submit_progress_note", { _note_id: n, _typed_signature: U[v.who].full });
    return n;
  };
  const review = (n) => must(pat.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  // group sessions first (a shift joins its session before it is assigned)
  const GS = {};
  for (const [g, k, s, e] of [["past", -4, "11:00", "12:00"], ["next", 9, "10:00", "11:00"]])
    GS[g] = await must(pat.c, "create_group_session", { _office_id: OFF, _session_date: await day(k), _start_time: s, _end_time: e, _staff_client_ratio: "1:2", _max_clients: 2 });
  // every visit in date order, then the notes in date order (review order = FIFO order on the authorizations)
  const sorted = [...C.vs].sort((a, b) => a.k - b.k || a.s.localeCompare(b.s));
  for (const v of sorted) {
    v.id = await shift(CL[v.c], await day(v.k), v.s, v.e, v.code);
    if (v.group) await must(pat.c, "set_shift_group_session", { _shift_id: v.id, _group_session_id: GS[v.group] });
    if (v.who) await assign(v.id, CG[v.who]);
  }
  const noted = sorted.filter((v) => v.note !== "none");
  for (const v of noted) v.nid = await note(v.id, v);
  // the week before: reviewed, built, approved, billed (locked)
  for (const v of noted.filter((x) => x.week === "before")) await review(v.nid);
  const wsB = await day(-14);
  await must(pat.c, "build_billing_batch", { _office_id: OFF, _week_start: wsB });
  const wkB = await must(pat.c, "get_billing_week", { _office_id: OFF, _week_start: wsB });
  const bB = wkB.batches[0];
  await must(pat.c, "approve_batch_notes", { _batch_id: bB.id, _note_ids: bB.lines.flatMap((l) => l.notes.map((x) => x.note_id)) });
  await must(pat.c, "mark_batch_billed", { _batch_id: bB.id });
  // last week and this week: reviewed, except Mia's Wednesday (submitted) and Ben's Friday (returned)
  for (const v of noted.filter((x) => x.week !== "before" && x.note === "reviewed")) await review(v.nid);
  for (const v of noted.filter((x) => x.note === "returned")) await must(pat.c, "return_progress_note", { _note_id: v.nid, _reason: "Please add how Zoe counted the change at the store." });

  // Zoe's renewal -> IPOS v2; in-service v2; Ana and Ben retrained, Mia not (her next Zoe visit needs retraining)
  const planZ2 = await must(pat.c, "renew_care_plan", { _care_plan_id: planZ });
  await inservice(planZ2, TODAY);
  await train(planZ2, "ipos_annual", null, ["ana", "ben"], TODAY);
  // Mia's first required credential is entered as lapsed (★ overdue) after her visits were scheduled
  await cred(CG.mia, req[0].id, await at(DAY, -400), await at(DAY, -5));
  // enforcement stays OFF so the demo can switch it on live
  log(await D.lockPasswords(Object.values(U).map((u) => u.id)));
  log(`office ${D.OFFICE_NAME}: module on, enforcement off; ${sorted.length} visits, ${noted.length} notes; the week before billed (${wsB}); last week not built; Ana's visit on ${DAY} 08:00 has no note`);
}

main().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());
