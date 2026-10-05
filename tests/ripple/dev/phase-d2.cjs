// Ripple care-plan module — Phase D2 (client onboarding status: get_client_onboarding_status,
// list_clients_onboarding) on DEV.
// Usage: node tests/ripple/dev/phase-d2.cjs <before|after>
//   before: the D2 functions are absent; records the definitions of every scheduling/units function
//           D2 must not touch (baseline/phase_d_untouched_before.json)
//   after : each of the 8 items flips on its own; onboarded only when all pass; renewal -> expired;
//           list shape; scope/role denials; ACLs; the untouched functions are byte-identical; NB1
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, URL_, ANON, LABEL, RUN, admin, opts, createClient, fs, path, BASELINE, ids, log, rec, pass, ins,
  reportSkew, pgRead, setup, checkNoBreak, DENY, setupB1, rpc, evIds, dbDay, teardownB1, teardown, closeDb, summary } = require("./lib.cjs");

const D2_FUNCS = ["cp_client_onboarding", "get_client_onboarding_status", "list_clients_onboarding"];
const UNTOUCHED = ["check_assignment_eligibility", "cp_eligibility_core", "check_assignment_eligibility_bulk", "assign_caregiver_to_shift",
  "check_caregiver_shifts_eligibility", "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments",
  "cp_projected_units", "cp_shift_client_context", "review_progress_note", "create_service_authorization", "cp_derive_authorization_units"];
const UNTOUCHED_FILE = path.join(BASELINE, "phase_d_untouched_before.json");
const KEYS = ["ipos", "assessment", "inservice", "client_forms", "safety_behavior_plan", "training", "authorization", "cls_note_setup"];
const defs = () => pgRead(async (c) => Object.fromEntries((await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) || ' ' || COALESCE(p.proacl::text, '') h
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [UNTOUCHED])).rows.map((r) => [r.proname, r.h])));

async function beforeD2() {
  const n = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [D2_FUNCS])).rows[0].n);
  const d = await defs();
  fs.writeFileSync(UNTOUCHED_FILE, JSON.stringify(d, null, 1) + "\n");
  rec("B0 D2 functions absent before push; definitions of the untouched functions recorded", pass(n === 0 && Object.keys(d).length === UNTOUCHED.length),
    `D2 functions ${n}/3; recorded ${Object.keys(d).length}/${UNTOUCHED.length}`);
}

async function afterD2(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  // catalog + ACL + untouched
  const st = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, p.provolatile v,
      COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [D2_FUNCS])).rows);
  const bad = st.filter((f) => /PUBLIC|anon|\(default\)/.test(f.g) || (f.proname === "cp_client_onboarding" ? (f.d || /authenticated/.test(f.g)) : !(f.d && /authenticated/.test(f.g))));
  rec("ACL 2 RPCs SECURITY DEFINER + authenticated only; the evaluator has no API role; all STABLE", pass(st.length === 3 && bad.length === 0 && st.every((f) => f.v === "s")),
    st.map((f) => `${f.proname} definer=${f.d} ${f.g}`).join("; "));
  const before = JSON.parse(fs.readFileSync(UNTOUCHED_FILE, "utf8")), now = await defs();
  // functions a LATER approved migration changed on purpose (compared against the pre-D2 snapshot)
  const LATER = { assign_caregiver_to_shift: "S-OFF-1 (20261011120000)", release_shift_assignments: "S-OFF-1 (20261011120000)",
    cp_projected_units: "W2 void (20261015120000)", review_progress_note: "W2 void (20261015120000)", create_service_authorization: "W2 void (20261015120000)" };
  const changed = UNTOUCHED.filter((k) => before[k] !== now[k]);
  const unexplained = changed.filter((k) => !LATER[k]);
  rec("U D2 changed none of the scheduling / units functions (definition + ACL hash; differences allowed only where a later approved migration changed the function)",
    pass(unexplained.length === 0), changed.length ? `changed: ${changed.map((k) => `${k}${LATER[k] ? " by " + LATER[k] : " UNEXPLAINED"}`).join(", ")}; ${UNTOUCHED.length - changed.length} identical` : `${UNTOUCHED.length} identical`);

  // fixture: module on for office X; clients X1 (walked through), X2 (left empty), XY (office Y)
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  const ctBefore = F.ctBefore;
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !ctBefore.has(id));
  const cl = (tag, office) => ({ agency_id: A, virtual_office_id: office, first_name: "ZZ", last_name: `${tag} ${RUN}`, phone: "555-0180", address: "4 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  const [X1, X2] = await ins("clients", [cl("D2-X1", F.OX), cl("D2-X2", F.OX)]); const XY = await ins("clients", cl("D2-XY", F.OY));
  F.dClients = [X1, X2, XY];
  const status = async (c) => must(F.mgrX.c, "get_client_onboarding_status", { _client_id: c });
  const map = (s) => Object.fromEntries(s.items.map((i) => [i.key, i.status]));
  let cur = await status(X1); const s0 = map(cur), flips = [];
  const step = async (label, fn, expect) => {
    await fn(); const nxt = await status(X1); const a = map(cur), b = map(nxt);
    const changed = KEYS.filter((k) => a[k] !== b[k]);
    flips.push({ label, ok: JSON.stringify(changed) === JSON.stringify(Object.keys(expect)) && Object.entries(expect).every(([k, v]) => b[k] === v),
      changed: changed.map((k) => `${k}:${a[k]}->${b[k]}`).join(","), onboarded: nxt.onboarded });
    cur = nxt;
  };
  const doc = async (t, s, na = null, exp = null) => must(F.mgrX.c, "upsert_client_document", { _client_id: X1, _doc_type: t, _status: s, _not_applicable_reason: na, _expiration_date: exp });
  let plan = null;
  await step("1 IPOS", async () => { plan = await must(F.mgrX.c, "create_care_plan", { _client_id: X1, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(300) } }); }, { ipos: "complete" });
  await step("8a goals, this_agency objective without a measure", () => must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: [{ seq: 1, goal_text: "Goal",
    objectives: [{ letter: "A", seq: 1, objective_text: "Obj", service_type: "cls", responsible_party: "this_agency" }, { letter: "B", seq: 2, objective_text: "CM", responsible_party: "case_management" }] }] }), {});
  await step("8b a measure on it (CLS note set up)", async () => {
    const ob = (await admin.from("care_plan_objectives").select("id, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", plan).eq("responsible_party", "this_agency").single()).data.id;
    const mt = (await admin.from("measure_types").select("id").is("agency_id", null).eq("kind", "yes_no_na").limit(1).single()).data.id;
    await must(F.mgrX.c, "set_objective_measures", { _objective_id: ob, _measures: [{ measure_type_id: mt, prompt_text: "Participated?" }] }); }, { cls_note_setup: "complete" });
  await step("2 assessment", () => doc("assessment", "complete"), { assessment: "complete" });
  await step("3 in-service at the current version", async () => must(F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "Fixture CM", _program_lead_id: F.mgrX.id,
    _trained_on: await dbDay(-1), _signed_at: await (async () => (await pgRead(async (c) => (await c.query("SELECT now() t")).rows[0].t)).toISOString())() }), { inservice: "complete" });
  await step("4a four of five client forms", async () => { for (const t of ["consent", "insurance", "emergency_contacts", "allergies"]) await doc(t, "complete"); }, {});
  await step("4b fifth not applicable", () => doc("release_of_information", "not_applicable", "No outside party"), { client_forms: "complete" });
  await step("5 safety/behavior plan not applicable", () => doc("safety_behavior_plan", "not_applicable", "No plan in the IPOS"), { safety_behavior_plan: "not_applicable" });
  await step("6 a caregiver trained (Q8)", async () => must(F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: await dbDay(-60),
    _location: "Office", _records: [{ caregiver_id: F.G, training_date: await dbDay(-1) }] }), { training: "complete" });
  const beforeLast = cur.onboarded;
  await step("7 authorization valid today", async () => must(F.mgrX.c, "create_service_authorization", { _client_id: X1, _service_type: "cls", _auth_number: `D2-${RUN}`,
    _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) }), { authorization: "complete" });
  const onboardedNow = cur.onboarded;
  await step("E1 assessment expired", async () => doc("assessment", "complete", null, await dbDay(-1)), { assessment: "expired" });
  await step("E2 assessment renewed", () => doc("assessment", "complete"), { assessment: "complete" });
  for (const f of flips) rec(`F${f.label.split(" ")[0]} ${f.label}`, pass(f.ok), `changed [${f.changed || "none"}]; onboarded ${f.onboarded}`);
  rec("O1 all 8 missing at the start; onboarded only when all 8 pass", pass(KEYS.every((k) => s0[k] === "missing") && beforeLast === false && onboardedNow === true
    && flips.find((f) => f.label.startsWith("E1")).onboarded === false && flips.find((f) => f.label.startsWith("E2")).onboarded === true), `before the 8th ${beforeLast}; after ${onboardedNow}`);
  await must(F.mgrX.c, "renew_care_plan", { _care_plan_id: plan });
  const rn = await status(X1), rm = map(rn);
  rec("E5 renewal: in-service and training read 'expired' until redone at the new version", pass(rm.inservice === "expired" && rm.training === "expired" && rm.ipos === "complete" && rn.onboarded === false), JSON.stringify(rm));
  const lst = await must(F.mgrX.c, "list_clients_onboarding", { _office_id: F.OX });
  const mine = lst.filter((x) => [X1, X2, XY].includes(x.client_id));
  rec("L list: the office's active clients (fixture X1, X2; not office Y's), same 8-item shape", pass(mine.length === 2 && mine.every((x) => x.items.length === 8) && !lst.some((x) => x.client_id === XY)),
    `${lst.length} clients in office X (fixture ${mine.length})`);
  const okP = []; for (const c of [F.mgrX.c, F.mgrAll.c, F.aaA.c]) okP.push(!(await rpc(c, "get_client_onboarding_status", { _client_id: X1 })).err && !(await rpc(c, "list_clients_onboarding", { _office_id: F.OX })).err);
  rec("P office manager, agency-wide manager and agency_admin can read", pass(okP.every(Boolean)), JSON.stringify(okP));
  const anon = createClient(URL_, ANON, opts); const leaks = []; let n = 0;
  for (const [fn, args] of [["get_client_onboarding_status", { _client_id: X1 }], ["list_clients_onboarding", { _office_id: F.OX }], ["get_client_onboarding_status", { _client_id: "00000000-0000-0000-0000-000000000999" }]])
    for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
      const r = await rpc(c, fn, args); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${label}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
  rec("D scheduler, hr_staff, caregiver, client, anon, other-office manager, agency-B admin, system_admin refused; unknown client refused the same way", pass(leaks.length === 0), leaks.length ? leaks.join("; ") : `${n} denied calls refused`);
}

async function teardownD(F) {
  if (!F || !F.dClients) return;
  for (const c of F.dClients) { await admin.from("plan_training_forms").delete().eq("client_id", c); await admin.from("plan_inservice_forms").delete().eq("client_id", c);
    await admin.from("client_documents").delete().eq("client_id", c); await admin.from("care_plans").delete().eq("client_id", c); await admin.from("service_authorizations").delete().eq("client_id", c); }
  for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
  const left = [];
  for (const c of F.dClients) for (const t of ["care_plans", "service_authorizations", "client_documents", "plan_inservice_forms", "plan_training_forms"]) {
    const { data } = await admin.from(t).select("id").eq("client_id", c); if (data && data.length) left.push(`${t} for ${c}`); }
  log(`teardown D2: ${F.dClients.length} clients, ${(F.newCredTypes || []).length} new credential types → remaining: ${left.length ? left.join("; ") : "NONE"}`);
}

(async () => {
  log(`=== Ripple Phase D2 tests — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") await beforeD2();
    F = await setup(); await setupB1(F);
    F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
    await checkNoBreak(F);
    if (LABEL !== "before") await afterD2(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    await teardownD(F); await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.clients WHERE virtual_office_id = ANY($1::uuid[]))::int clients,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR agency_id = $2::uuid)::int ev`, [[F.OX, F.OY, F.OZ], F.B])).rows[0]);
      log(`D2 teardown re-query: clients ${left.clients}, events ${left.ev} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
