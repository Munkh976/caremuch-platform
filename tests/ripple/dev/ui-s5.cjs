// UI S5 backend on DEV: would_bump_training_version vs what upsert_care_plan_goals does, measure edits
// never bump, case-management objectives refuse measures, denials, ACL, NB1 (mirrors pglite/ui-s5.cjs).
// Usage: node tests/ripple/dev/ui-s5.cjs <before|after>
// DEV run: disposable fixtures, verified teardown (additive slice push rule, owner Oct 5).
const { A, REF, LABEL, RUN, admin, log, rec, pass, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts, dbNow } = require("./lib.cjs");

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = 'would_bump_training_version'`)).rows);
  rec("ACL would_bump_training_version SECURITY DEFINER + authenticated, no PUBLIC/anon", pass(acl.length === 1 && acl[0].d && /authenticated=X/.test(acl[0].acl) && !/(^|[{,])=X|anon=X/.test(acl[0].acl)), acl.map((a) => a.acl).join());
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  const goals = [{ seq: 1, goal_text: "Build community skills", objectives: [
    { seq: 1, letter: "A", objective_text: "Order at a cafe", staff_instructions: "Prompt once", service_type: "cls", responsible_party: "this_agency" },
    { seq: 2, letter: "B", objective_text: "Arrange transport", responsible_party: "case_management" }] }];
  const p1 = await must(F.mgrX.c, "would_bump_training_version", { _care_plan_id: plan, _goals: goals });
  const r1 = await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: goals });
  rec("S5-a before any training: changed, no bump predicted, the save keeps v1", pass(p1.changed && !p1.would_bump && r1.training_version === 1), `${JSON.stringify(p1)}; saved v${r1.training_version}`);
  const objs = (await admin.from("care_plan_objectives").select("id, letter, seq, objective_text, staff_instructions, service_type, responsible_party, goal_id").order("seq")).data
    .filter((o) => o.objective_text === "Order at a cafe" || o.objective_text === "Arrange transport");
  const gid = objs[0].goal_id;
  const tree = () => [{ id: gid, seq: 1, goal_text: "Build community skills", objectives: objs.map((o) => Object.fromEntries(Object.entries({ id: o.id, letter: o.letter, seq: o.seq,
    objective_text: o.objective_text, staff_instructions: o.staff_instructions, service_type: o.service_type, responsible_party: o.responsible_party }).filter(([, v]) => v !== null))) }];
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(0), _signed_at: await dbNow() });
  const same = await must(F.mgrX.c, "would_bump_training_version", { _care_plan_id: plan, _goals: tree() });
  const edited = tree(); edited[0].objectives[0].staff_instructions = "Prompt twice, then model";
  const p2 = await must(F.mgrX.c, "would_bump_training_version", { _care_plan_id: plan, _goals: edited });
  const r2 = await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: edited });
  rec("S5-b after training: the unchanged tree predicts no bump; an Instructions edit predicts a bump and the save bumps to v2",
    pass(!same.changed && !same.would_bump && p2.would_bump && r2.training_version === 2), `same ${JSON.stringify(same)}; edit ${JSON.stringify(p2)}; saved v${r2.training_version}`);
  const mt = (await admin.from("measure_types").select("id").is("agency_id", null).eq("kind", "yes_no_na").limit(1)).data[0].id;
  const m1 = await rpc(F.mgrX.c, "set_objective_measures", { _objective_id: objs[0].id, _measures: [{ measure_type_id: mt, prompt_text: "Ordered without help?" }] });
  const tv = (await admin.from("care_plans").select("training_version").eq("id", plan).single()).data.training_version;
  const mCM = await rpc(F.mgrX.c, "set_objective_measures", { _objective_id: objs[1].id, _measures: [{ measure_type_id: mt, prompt_text: "x" }] });
  rec("S5-c a measure edit never bumps; a case-management objective is refused measures", pass(!m1.err && tv === 2 && /Only objectives this agency delivers/.test(mCM.err || "")), `measures ${m1.err || "ok"}; v${tv}; CM "${(mCM.err || "ACCEPTED").slice(0, 50)}"`);
  const anon = createClient(URL_, ANON, opts); const dl = []; let dn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    const r = await rpc(c, "would_bump_training_version", { _care_plan_id: plan, _goals: [] }); dn++; if (!r.err || !DENY.test(r.err)) dl.push(`${label}: ${r.err || "ALLOWED"}`); }
  rec("S5-d preview refused for scheduler, hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", pass(dl.length === 0), dl.join("; ") || `${dn} refused`);
}

(async () => {
  log(`=== UI S5 backend — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const n = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'would_bump_training_version'`)).rows[0].n);
      rec("B0 would_bump_training_version is absent before the push", pass(n === 0), `${n}/1 present`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) { for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "care_plans"]) await admin.from(t).delete().eq("client_id", F.CX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t); }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.care_plans WHERE client_id = $1)::int plans,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [F.CX, [F.OX, F.OY, F.OZ]])).rows[0]);
      log(`S5 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
