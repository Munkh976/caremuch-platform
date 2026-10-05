// UI S6 backend on DEV: training-tier reads (no clinical content), training order, renewal ->
// retraining -> back, denials, ACLs, NB1 (mirrors pglite/ui-s6.cjs through real logins).
// Usage: node tests/ripple/dev/ui-s6.cjs <before|after>
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const NEW_FNS = ["get_client_training_context", "list_client_training_status"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [NEW_FNS])).rows);
  rec("ACL 2 reads SECURITY DEFINER + authenticated, no PUBLIC/anon", pass(acl.length === 2 && acl.every((f) => f.d && /authenticated=X/.test(f.acl) && !/(^|[{,])=X|anon=X/.test(f.acl))), acl.map((f) => f.acl).join(" "));
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300), discharge_criteria: "CLINICAL-DISCHARGE" } });
  await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: [{ seq: 1, goal_text: "CLINICAL-GOAL", objectives: [{ seq: 1, objective_text: "CLINICAL-OBJ", staff_instructions: "CLINICAL-INSTR", service_type: "cls", responsible_party: "this_agency" }] }] });
  const ctx0 = await must(F.hrX.c, "get_client_training_context", { _client_id: F.CX });
  const hrPlans = (await F.hrX.c.from("care_plans").select("id")).data || [];
  rec("T1 hr_staff: plan spine only, no clinical text; still no care_plans rows through RLS",
    pass(!/CLINICAL-/.test(JSON.stringify(ctx0)) && ctx0.plan && ctx0.plan.training_version === 1 && hrPlans.length === 0), `clinical ${/CLINICAL-/.test(JSON.stringify(ctx0)) ? "LEAKED" : "absent"}; hr plans ${hrPlans.length}`);
  const today = await dbDay(0);
  const early = await rpc(F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null, _records: [{ caregiver_id: F.G, training_date: today }] });
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "ZZ CM", _program_lead_id: F.mgrX.id, _trained_on: today, _signed_at: await dbNow() });
  await must(F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: "Office", _records: [{ caregiver_id: F.G, training_date: today, training_method: "outside_pcp" }] });
  const ctx1 = await must(F.hrX.c, "get_client_training_context", { _client_id: F.CX });
  const g1 = ctx1.caregivers.find((x) => x.caregiver_id === F.G);
  rec("T2 training refused before the in-service; succeeds after; G trained at the current version",
    pass(/in-service form for this plan version first/.test(early.err || "") && g1.trained_current && ctx1.training_forms.length === 1), `early "${(early.err || "ACCEPTED").slice(0, 50)}"; trained ${g1.trained_current}`);
  const p2 = await must(F.mgrX.c, "renew_care_plan", { _care_plan_id: plan });
  const ctx2 = await must(F.hrX.c, "get_client_training_context", { _client_id: F.CX });
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: p2, _case_manager_name: "ZZ CM", _program_lead_id: F.aaA.id, _trained_on: today, _signed_at: await dbNow() });
  await must(F.hrX.c, "record_training_form", { _care_plan_id: p2, _plan_document_type: "ipos_annual", _plan_effective_date: null, _location: null, _records: [{ caregiver_id: F.G, training_date: today }] });
  const ctx3 = await must(F.hrX.c, "get_client_training_context", { _client_id: F.CX });
  const st = (await must(F.hrX.c, "list_client_training_status", { _office_id: F.OX })).find((r) => r.client_id === F.CX);
  rec("T3 renewal: G needs retraining (trained v1, current v2); after in-service + training at v2 back to trained; status list shows v2 with the in-service current",
    pass(!ctx2.caregivers.find((x) => x.caregiver_id === F.G).trained_current && ctx3.caregivers.find((x) => x.caregiver_id === F.G).trained_current && st && st.training_version === 2 && st.inservice_current),
    `after renewal ${ctx2.caregivers.find((x) => x.caregiver_id === F.G).trained_current}; after retraining ${ctx3.caregivers.find((x) => x.caregiver_id === F.G).trained_current}; status ${JSON.stringify(st)}`);
  const dl = []; let dn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    for (const [fn, args] of [["get_client_training_context", { _client_id: F.CX }], ["list_client_training_status", { _office_id: F.OX }]]) { const r = await rpc(c, fn, args); dn++; if (!r.err || !DENY.test(r.err)) dl.push(`${label}->${fn}: ${r.err || "ALLOWED"}`); } }
  rec("T4 both reads refused for scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", pass(dl.length === 0), dl.join("; ") || `${dn} refused`);
  F.planClients = [F.CX];
}

(async () => {
  log(`=== UI S6 backend — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const n = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [NEW_FNS])).rows[0].n);
      rec("B0 the 2 new reads are absent before the push", pass(n === 0), `${n}/2 present`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) { for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "care_plans"]) await admin.from(t).delete().eq("client_id", F.CX);
      await admin.from("caregiver_certifications").delete().eq("caregiver_id", F.G);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t); }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.care_plans WHERE client_id = $1)::int plans,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [F.CX, [F.OX, F.OY, F.OZ]])).rows[0]);
      log(`S6 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
