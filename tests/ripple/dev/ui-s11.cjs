// UI S11 on DEV through real logins (mirrors pglite/ui-s11.cjs): get_enforcement_readiness — upcoming shifts the
// compliance switch would block, by reason, equal to the existing eligibility reads; the same counts with the switch on;
// manager / agency_admin of the office only; the eligibility / assign functions unchanged (md5); NB1.
// Usage: node tests/ripple/dev/ui-s11.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const SCHED_MD5 = "4506edad364c57b83d5449906b30fb06";   // the ten eligibility / assign / guard functions, unchanged since S10
const SCHED = ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift", "caregiver_pick_up_shift",
  "caregiver_pickup_trade_shift", "cp_eligibility_core", "cp_shift_client_context", "guard_virtual_office_flags", "cp_safe_issue_list"];
const schedMd5 = () => pgRead(async (c) => (await c.query(`SELECT md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || COALESCE(p.proacl::text,''), '|' ORDER BY 1)) s
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [SCHED])).rows[0].s);
const CODES = ["credential_missing", "training_missing", "authorization_missing", "authorization_expired", "units_short", "units_short_period"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = 'get_enforcement_readiness'`)).rows);
  rec("ACL get_enforcement_readiness SECURITY DEFINER + authenticated only (no PUBLIC/anon), one overload", pass(acl.length === 1 && acl[0].d && /authenticated=X/.test(acl[0].acl) && !/(^|[{,])=X|anon=X/.test(acl[0].acl)), acl.map((f) => f.acl).join());
  rec("F0 the ten eligibility / assign / guard functions unchanged (md5 + ACL)", pass((await schedMd5()) === SCHED_MD5), await schedMd5());

  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-5), expiration_date: await dbDay(300) } });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-S11-${RUN}`, _units_authorized: 6, _effective_date: await dbDay(-5), _expiration_date: await dbDay(90) });
  const mk = async (k, status = "open") => ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(k), start_time: "15:00", end_time: "16:00", duration_hours: 1, status, is_demo: true });
  const S = { a1: await mk(1), a2: await mk(2), u3: await mk(3), c4: await mk(4, "cancelled"), out: await mk(14) }; F.b2shifts = Object.values(S);
  for (const k of ["a1", "a2"]) await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: S[k], _caregiver_id: F.G, _method: "manual", _notes: "S11 test", _override_reason: "S11 test override" });
  const expect = { by: {}, block: 0 };
  for (const k of ["a1", "a2"]) {
    const e = await must(F.mgrAll.c, "check_assignment_eligibility", { _shift_id: S[k], _caregiver_id: F.G });
    const codes = [...new Set([...e.hard, ...e.advisory].map((x) => x.code).filter((c) => CODES.includes(c)))];
    if (codes.length) expect.block++; for (const c of codes) expect.by[c] = (expect.by[c] || 0) + 1;
  }
  // the unassigned shift: what any caregiver would meet at client level = the bulk read's authorization / units codes for one caregiver
  const b = await must(F.mgrAll.c, "check_assignment_eligibility_bulk", { _shift_id: S.u3, _caregiver_ids: [F.G] });
  const uc = [...new Set([...b[0].result.hard, ...b[0].result.advisory].map((x) => x.code).filter((c) => c.startsWith("authorization_") || c.startsWith("units_short")))];
  if (uc.length) expect.block++; for (const c of uc) expect.by[c] = (expect.by[c] || 0) + 1;
  const sameBy = (a, b2) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b2).sort());
  const r0 = await must(F.mgrX.c, "get_enforcement_readiness", { _office_id: F.OX });
  rec("E0 switch off: shifts in today .. today + 13 (cancelled and day-14 excluded) = 3 checked; would_block and the breakdown equal the existing eligibility reads",
    pass(r0.enforcement === false && r0.shifts_checked === 3 && r0.would_block === expect.block && sameBy(r0.by_reason, expect.by) && !r0.shifts.some((x) => x.shift_id === S.out || x.shift_id === S.c4)),
    `checked ${r0.shifts_checked}; block ${r0.would_block}/${expect.block}; ${JSON.stringify(r0.by_reason)} vs ${JSON.stringify(expect.by)}`);
  rec("N1 rows: names, dates and codes only (no clinical text)", pass(r0.shifts.every((x) => Object.keys(x).sort().join() === "caregiver_id,caregiver_name,client_first_name,client_id,client_last_initial,codes,shift_date,shift_id,start_time")), JSON.stringify(r0.shifts[0]).slice(0, 200));
  await must(F.aaA.c, "set_compliance_enforcement", { _office_id: F.OX, _enabled: true });
  const r1 = await must(F.mgrAll.c, "get_enforcement_readiness", { _office_id: F.OX });
  await must(F.aaA.c, "set_compliance_enforcement", { _office_id: F.OX, _enabled: false });
  rec("E1 switch on: the same counts (codes now hard); switched back off", pass(r1.enforcement === true && r1.would_block === r0.would_block && sameBy(r1.by_reason, r0.by_reason)), JSON.stringify(r1.by_reason));
  const ok = []; for (const [w, c] of [["mgrX", F.mgrX.c], ["mgrAll", F.mgrAll.c], ["aaA", F.aaA.c]]) { const r = await rpc(c, "get_enforcement_readiness", { _office_id: F.OX }); if (!r.err) ok.push(w); }
  const refused = [];
  for (const [w, c] of [["mgrY", F.mgrY.c], ["schX", F.schX.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["cl", F.cl.c], ["aaB", F.aaB.c], ["sysA", F.sysA.c], ["anon", anon]]) {
    const r = await rpc(c, "get_enforcement_readiness", { _office_id: F.OX }); if (r.err && DENY.test(r.err)) refused.push(w); else log(`  not refused: ${w} ${r.err || ""}`); }
  rec("R1 manager (office and all) and agency_admin read it; the other office's manager, scheduler, hr_staff, caregiver, client, other agency's admin, system_admin and anon are refused generically",
    pass(ok.length === 3 && refused.length === 8), `ok ${ok}; refused ${refused.length}/8`);
}

(async () => {
  log(`=== UI S11 dashboard compliance (enforcement readiness) — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const fn = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'get_enforcement_readiness'`)).rows[0].n);
      rec("B0 before S11: no get_enforcement_readiness; the eligibility / assign / guard functions as after S10 (md5)", pass(fn === 0 && (await schedMd5()) === SCHED_MD5), `fn ${fn}`);
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
      log(`S11 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
