// UI S10 on DEV through real logins (mirrors pglite/ui-s10.cjs): the audited compliance enforcement switch
// (set_compliance_enforcement + one new event type) and what it changes in the existing, unchanged eligibility
// engine: off = care-plan checks advisory, Smart keeps the caregiver; on = the same checks hard, Smart (and so Auto)
// omits the caregiver, the assign RPC refuses, the caregiver sees only the generic 'not_bookable'; an office without
// the module is identical either way; refusals; the eligibility / assign / guard functions unchanged (md5); NB1.
// Usage: node tests/ripple/dev/ui-s10.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const CHECK_BEFORE = "2e1f625f440f78a943157be43556a314";           // md5(pg_get_constraintdef) of events_event_type_check before S10 (50 values)
const SCHED_MD5 = "4506edad364c57b83d5449906b30fb06";              // the ten functions below, as on DEV before S10 (Oct 6)
const SCHED = ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift", "caregiver_pick_up_shift",
  "caregiver_pickup_trade_shift", "cp_eligibility_core", "cp_shift_client_context", "guard_virtual_office_flags", "cp_safe_issue_list"];
const schedMd5 = () => pgRead(async (c) => (await c.query(`SELECT md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || COALESCE(p.proacl::text,''), '|' ORDER BY 1)) s
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [SCHED])).rows[0].s);
const checkInfo = () => pgRead(async (c) => (await c.query(`SELECT md5(pg_get_constraintdef(oid)) h, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`)).rows[0]);
const CARE = ["authorization_missing", "training_missing"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = 'set_compliance_enforcement'`)).rows);
  rec("ACL set_compliance_enforcement SECURITY DEFINER + authenticated only (no PUBLIC/anon), one overload", pass(acl.length === 1 && acl[0].d && /authenticated=X/.test(acl[0].acl) && !/(^|[{,])=X|anon=X/.test(acl[0].acl)), acl.map((f) => f.acl).join());
  const ck = await checkInfo(); const vals = ck.d.match(/'[a-z_]+'/g);
  rec("F0 events CHECK: 51 values incl. 'compliance_enforcement_changed'; the ten eligibility / assign / guard functions unchanged (md5 + ACL)",
    pass(vals.length === 51 && vals.includes("'compliance_enforcement_changed'") && (await schedMd5()) === SCHED_MD5), `${vals.length} values; sched ${await schedMd5()}`);

  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  // a CLS shift in OX (no plan, no authorization: training + authorization checks) and one in OY (module off: a Kind-Care office)
  const d = await dbDay(5);
  const mk = (office, client) => ins("shifts", { agency_id: A, virtual_office_id: office, client_id: client, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: d, start_time: "15:00", end_time: "16:00", duration_hours: 1, status: "open", is_demo: true });
  const SX = await mk(F.OX, F.CX), SY = await mk(F.OY, F.CY); F.b2shifts = [SX, SY];
  await ins("caregiver_skills", { caregiver_id: F.GY, care_type_code: "CLS0001", is_demo: true });
  const elig = async (s, g) => must(F.mgrAll.c, "check_assignment_eligibility", { _shift_id: s, _caregiver_id: g });
  const codes = (l) => (l || []).map((x) => x.code).sort().join(",");
  const care = (l) => (l || []).filter((x) => CARE.includes(x.code)).map((x) => x.code).sort().join(",");
  const smartHas = async (s, g) => { const r = await F.mgrAll.c.functions.invoke("match-caregiver", { body: { shiftId: s } }); if (r.error) return `ERR ${r.error.context?.status}`; return (r.data?.matches || []).some((m) => m.caregiver_id === g); };
  const cgHard = async () => { const r = await must(F.cg.c, "check_caregiver_shifts_eligibility", { _shift_ids: [SX] }); return (r[0]?.result?.hard || []); };
  const yView = async () => JSON.stringify(await elig(SY, F.GY)).replace(/"(weekly_hours|projected_weekly_hours)":[0-9.]+/g, "");

  const off = await elig(SX, F.G); const y0 = await yView();
  rec("E0 enforcement off (default): training + authorization checks are advisory, none hard; Smart (match-caregiver) keeps the caregiver; the caregiver isn't blocked by them",
    pass(care(off.advisory) === CARE.join() && care(off.hard) === "" && (await smartHas(SX, F.G)) === true && !(await cgHard()).some((x) => x.code === "not_bookable")),
    `advisory ${codes(off.advisory)}; hard ${codes(off.hard)}`);

  const t0 = new Date().toISOString();
  const on = await must(F.aaA.c, "set_compliance_enforcement", { _office_id: F.OX, _enabled: true });
  const flag = async (o) => (await admin.from("virtual_office").select("compliance_enforcement_enabled").eq("id", o).single()).data.compliance_enforcement_enabled;
  const evs = async () => ((await admin.from("events").select("payload, actor_id, subject_id, virtual_office_id").eq("event_type", "compliance_enforcement_changed").eq("virtual_office_id", F.OX).order("occurred_at")).data || []);
  const e1 = await evs();
  rec("E1 agency_admin turns enforcement on (the card's confirm): flag on; one event {enabled:true, was_enabled:false} with the actor and office, no PHI; the same value again writes nothing",
    pass(on.changed === true && (await flag(F.OX)) === true && e1.length === 1 && JSON.stringify(e1[0].payload) === '{"enabled":true,"was_enabled":false}' && e1[0].actor_id === F.aaA.id && e1[0].subject_id === F.OX
      && (await must(F.aaA.c, "set_compliance_enforcement", { _office_id: F.OX, _enabled: true })).changed === false && (await evs()).length === 1), JSON.stringify(e1.map((e) => e.payload)));

  const onR = await elig(SX, F.G);
  const bulk = await must(F.mgrAll.c, "check_assignment_eligibility_bulk", { _shift_id: SX, _caregiver_ids: [F.G] });
  const asg = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: SX, _caregiver_id: F.G, _method: "manual", _notes: "S10 test", _override_reason: "S10 test override" });
  const cg1 = await cgHard();
  rec("E2 enforcement on: the same checks are hard (eligible=false, so the dialog shows Blocked and disables Confirm); the bulk read too; Smart omits the caregiver (Auto takes Smart's best match, so it skips them); the assign RPC refuses even with an override reason",
    pass(care(onR.hard) === CARE.join() && onR.eligible === false && care(bulk[0].result.hard) === CARE.join() && (await smartHas(SX, F.G)) === false && !!asg.err),
    `hard ${codes(onR.hard)}; smart has G: ${await smartHas(SX, F.G)}; assign ${asg.err}`);
  const pick = await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: SX });
  rec("E3 caregiver side with enforcement on: only the generic 'not_bookable' (no plan / authorization detail); pick-up refused with the generic text",
    pass(cg1.some((x) => x.code === "not_bookable") && !cg1.some((x) => CARE.includes(x.code)) && !/plan|authoriz|units/i.test(JSON.stringify(cg1.filter((x) => x.code === "not_bookable"))) && !!pick.err && /can't be booked yet/.test(pick.err)),
    `caregiver ${codes(cg1)}; pick-up ${String(pick.err).slice(0, 90)}`);
  const y1 = await yView();
  rec("K1 an office without the module (Kind Care) is identical with enforcement on elsewhere: same eligibility result for its shift, no care-plan codes",
    pass(y0 === y1 && !/training_missing|authorization_|units_short|credential_missing/.test(y1)), y1.slice(0, 160));

  const refusals = [];
  for (const [who, c] of [["mgrX", F.mgrX.c], ["mgrAll", F.mgrAll.c], ["schX", F.schX.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["cl", F.cl.c], ["aaB", F.aaB.c], ["anon", anon]]) {
    const r = await rpc(c, "set_compliance_enforcement", { _office_id: F.OX, _enabled: false });
    if (r.err && DENY.test(r.err)) refusals.push(who); else log(`  not refused: ${who} ${r.err || JSON.stringify(r.v)}`);
  }
  const direct = await F.mgrX.c.from("virtual_office").update({ compliance_enforcement_enabled: false }).eq("id", F.OX).select("id");
  rec("R1 managers (office and all), scheduler, hr_staff, caregiver, client, the other agency's admin and anon are refused generically; a manager's direct UPDATE still fails (guard unchanged); the flag stays on",
    pass(refusals.length === 8 && (!!direct.error || (direct.data || []).length === 0) && (await flag(F.OX)) === true), `${refusals.length}/8; direct ${direct.error ? direct.error.message.slice(0, 80) : `${(direct.data || []).length} rows`}`);
  const mod = await rpc(F.aaA.c, "set_compliance_enforcement", { _office_id: F.OY, _enabled: true });
  rec("M1 turning enforcement on for an office without the care-plan module is refused with a clear message", pass(!!mod.err && /module/.test(mod.err) && (await flag(F.OY)) === false), mod.err);

  const offR = await must(F.sysA.c, "set_compliance_enforcement", { _office_id: F.OX, _enabled: false });
  const back = await elig(SX, F.G); const e2 = await evs();
  rec("E4 system_admin of the agency turns it off: audited {enabled:false, was_enabled:true}; checks advisory again; Smart keeps the caregiver again",
    pass(offR.changed === true && (await flag(F.OX)) === false && e2.length === 2 && JSON.stringify(e2[1].payload) === '{"enabled":false,"was_enabled":true}' && e2[1].actor_id === F.sysA.id
      && care(back.advisory) === CARE.join() && care(back.hard) === "" && (await smartHas(SX, F.G)) === true), JSON.stringify(e2.map((e) => e.payload)));
  F.t0 = t0;
}

(async () => {
  log(`=== UI S10 eligibility + enforcement switch — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const ck = await checkInfo();
      const fn = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'set_compliance_enforcement'`)).rows[0].n);
      rec("B0 before S10: no set_compliance_enforcement; the events CHECK the rollback restores (md5, 50 values); the ten eligibility / assign / guard functions (md5)",
        pass(fn === 0 && ck.h === CHECK_BEFORE && ck.d.match(/'[a-z_]+'/g).length === 50 && (await schedMd5()) === SCHED_MD5), `fn ${fn}; check ${ck.h}; sched ${await schedMd5()}`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]))::int ev,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($2::uuid[]))::int shifts, (SELECT count(*) FROM public.virtual_office WHERE id = ANY($1::uuid[]))::int offices`, [[F.OX, F.OY, F.OZ], F.b2shifts || []])).rows[0]);
      log(`S10 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
