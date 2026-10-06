// S10 on PGlite (20261023120000): the audited compliance enforcement switch. events CHECK = the 50 earlier values +
// 'compliance_enforcement_changed'; set_compliance_enforcement for agency_admin / system_admin of the office's agency
// only (generic refusal for everyone else), module required to turn it on, same value = no event; audit payload
// without PHI; check_assignment_eligibility (unchanged) flips the care-plan checks advisory -> hard and back; the
// bulk read (Smart) and the caregiver read (Available Shifts: 'not_bookable') follow; the direct-update guard
// trigger and every scheduling function are unchanged.
// Usage: node tests/ripple/pglite/ui-s10.cjs   (local, no network)
const H = require("./harness.cjs");
const S10 = "20261023120000_s10_compliance_enforcement_switch.sql";
const SCHED = ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift",
  "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "cp_eligibility_core", "cp_shift_client_context", "guard_virtual_office_flags"];

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S10); const { db, q, call, must } = t;
  const { A, OX, OZ, CX, G, users } = H;
  const checkVals = async () => (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`))[0].d.match(/'[a-z_]+'/g).map((s) => s.slice(1, -1));
  const fnMd5 = async () => (await q(`SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || COALESCE(p.proacl::text,''), ' | ' ORDER BY 1) s
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`, [SCHED]))[0].s;
  const before = await checkVals(); const schedBefore = await fnMd5();
  await H.applyFiles(db, [S10]);
  const after = await checkVals();
  rec("F0 events CHECK = the 50 earlier values exactly + 'compliance_enforcement_changed'; eligibility, assign paths and the flag guard trigger unchanged (md5 + ACL)",
    before.length === 50 && after.length === 51 && before.every((v) => after.includes(v)) && after.filter((v) => !before.includes(v)).join() === "compliance_enforcement_changed"
      && (await fnMd5()) === schedBefore, `${before.length} -> ${after.length}; sched ${schedBefore === (await fnMd5()) ? "same" : "CHANGED"}`);
  const acl = await H.aclCheck(q, ["set_compliance_enforcement"]);
  rec("ACL set_compliance_enforcement SECURITY DEFINER + authenticated, no PUBLIC/anon, one overload", acl.ok, acl.detail);

  // a CLS shift in OX for the fixture client with no plan and no authorization: training_missing + authorization_missing
  const shift = H.U(9801);
  await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
    VALUES ($1,$2,$3,'CLS0001',(now() AT TIME ZONE 'America/New_York')::date + 3,'09:00','10:00',$4,'open',1)`, [shift, A, CX, OX]);
  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1,'CLS0001')`, [G]);
  const elig = async () => (await call("mgrX", "SELECT check_assignment_eligibility($1,$2)", [shift, G])).v;
  const bulk = async () => (await call("mgrX", "SELECT result FROM check_assignment_eligibility_bulk($1, ARRAY[$2]::uuid[])", [shift, G])).v;
  const cgView = async () => (await call("cg", "SELECT result FROM check_caregiver_shifts_eligibility(ARRAY[$1]::uuid[])", [shift])).v;
  const codes = (list) => (list || []).map((x) => x.code).sort().join(",");
  const CARE = "authorization_missing,credential_missing,training_missing";
  const off0 = await elig(); const cg0 = await cgView();
  rec("E0 enforcement off (default): the care-plan checks are advisory (training, credential, authorization), none hard; the caregiver isn't blocked (advisories aren't shown on Available Shifts)",
    codes(off0.advisory.filter((x) => CARE.includes(x.code))) === CARE && !off0.hard.some((x) => CARE.includes(x.code)) && !(cg0.hard || []).some((x) => x.code === "not_bookable") && cg0.eligible !== false,
    `advisory ${codes(off0.advisory)}; hard ${codes(off0.hard)}`);

  const ev = async () => (await q(`SELECT payload FROM events WHERE event_type = 'compliance_enforcement_changed' ORDER BY occurred_at, id`)).map((r) => r.payload);
  const on = await must("aaA", "SELECT set_compliance_enforcement($1, true)", [OX]);
  const flag = async (o) => (await q("SELECT compliance_enforcement_enabled e FROM virtual_office WHERE id = $1", [o]))[0].e;
  const ev1 = await ev();
  rec("E1 agency_admin turns enforcement on: flag on, one audit event {enabled:true, was_enabled:false} (ids only); the same value again = no change, no event",
    on.changed === true && (await flag(OX)) === true && ev1.length === 1 && ev1[0].enabled === true && ev1[0].was_enabled === false && Object.keys(ev1[0]).sort().join() === "enabled,was_enabled"
      && (await must("aaA", "SELECT set_compliance_enforcement($1, true)", [OX])).changed === false && (await ev()).length === 1,
    `${JSON.stringify(on)}; events ${JSON.stringify(await ev())}`);
  const on1 = await elig(); const b1 = await bulk(); const cg1 = await cgView();
  rec("E2 enforcement on: the same checks are hard (Blocked, eligible=false); the bulk read Smart / Auto filter on has them hard too; the caregiver sees only the generic 'not_bookable' (no client detail)",
    codes(on1.hard.filter((x) => CARE.includes(x.code))) === CARE && on1.eligible === false && codes(b1.hard.filter((x) => CARE.includes(x.code))) === CARE
      && cg1.hard.some((x) => x.code === "not_bookable") && !cg1.hard.some((x) => ["training_missing", "authorization_missing"].includes(x.code)) && !/plan|authorization|units/i.test(JSON.stringify(cg1.hard.filter((x) => x.code === "not_bookable"))),
    `hard ${codes(on1.hard)}; bulk ${codes(b1.hard)}; caregiver ${codes(cg1.hard)}`);
  const pick = await call("cg", "SELECT caregiver_pick_up_shift($1)", [shift]);
  rec("E3 with enforcement on the caregiver's pick-up is refused with the generic text", !!pick.err && /can't be booked yet/.test(pick.err), pick.err);

  const refused = [];
  for (const who of ["mgrX", "mgrA", "schX", "hrX", "cg", "cl", "aaB", "anon"]) {
    const r = await call(who, "SELECT set_compliance_enforcement($1, false)", [OX]);
    if (r.err && H.DENY.test(r.err)) refused.push(who); else console.log("  not refused:", who, r.err || JSON.stringify(r.v));
  }
  const ghost = await call("aaA", "SELECT set_compliance_enforcement($1, false)", [H.U(999999)]);
  rec("R1 refused (generic) for manager (office and all), scheduler, hr_staff, caregiver, client, the other agency's admin, anon, and an unknown office; the flag stays on",
    refused.length === 8 && !!ghost.err && H.DENY.test(ghost.err) && (await flag(OX)) === true, `${refused.length}/8 refused; ghost ${ghost.err}`);
  const direct = await call("mgrX", "UPDATE virtual_office SET compliance_enforcement_enabled = false WHERE id = $1 RETURNING id", [OX]);
  rec("G1 the existing direct-update path is unchanged: a manager's direct UPDATE of the flag is still refused by the guard trigger (or RLS)",
    (!!direct.err || !direct.v) && (await flag(OX)) === true, direct.err || `rows ${direct.rows?.length}`);

  const modOff = await call("aaB", "SELECT set_compliance_enforcement($1, true)", [OZ]);
  rec("M1 turning enforcement on for an office without the care-plan module is refused with a clear message", !!modOff.err && /module/.test(modOff.err), modOff.err);

  const sys = await must("sysA", "SELECT set_compliance_enforcement($1, false)", [OX]);
  const off2 = await elig(); const ev2 = await ev();
  rec("E4 system_admin of the agency turns it off: audited {enabled:false, was_enabled:true}; the checks are advisory again (Confirm enabled, unchanged behaviour)",
    sys.changed === true && (await flag(OX)) === false && ev2.length === 2 && ev2[1].enabled === false && ev2[1].was_enabled === true
      && codes(off2.advisory.filter((x) => CARE.includes(x.code))) === CARE && !off2.hard.some((x) => CARE.includes(x.code)),
    `events ${JSON.stringify(ev2)}; advisory ${codes(off2.advisory)}`);
  const actor = (await q(`SELECT DISTINCT actor_id::text a FROM events WHERE event_type = 'compliance_enforcement_changed' ORDER BY 1`)).map((r) => r.a).sort().join();
  rec("AU1 audit rows carry the actor and the office, nothing else", actor === [users.aaA, users.sysA].sort().join()
    && (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'compliance_enforcement_changed' AND (virtual_office_id <> $1 OR subject_id <> $1 OR agency_id <> $2)`, [OX, A]))[0].n === 0, actor);
  done();
})().catch((e) => { console.error(e); process.exit(1); });
