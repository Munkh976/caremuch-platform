// S11 on PGlite (20261024120000): get_enforcement_readiness — upcoming shifts (today .. today + 13, office zone) that the
// compliance switch would block, by reason; computed with the unchanged check_assignment_eligibility (assigned shifts)
// and the client-level context (unassigned); the same counts whether the switch is off (advisory) or on (hard);
// cancelled shifts and shifts outside the window aren't counted; no clinical text; manager / agency_admin of the office
// only; nothing else in the catalog changes.
// Usage: node tests/ripple/pglite/ui-s11.cjs   (local, no network)
const H = require("./harness.cjs");
const S11 = "20261024120000_s11_enforcement_readiness.sql";
let seq = 0; const nid = () => H.U(9700 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S11); const { db, q, call, must } = t;
  const { A, OX, CX, G } = H;
  const before = JSON.stringify(await H.snap(db));
  await H.applyFiles(db, [S11]);
  const after = await H.snap(db);
  const added = after.filter((x) => !JSON.parse(before).includes(x));
  rec("F0 the migration adds only get_enforcement_readiness (nothing else in the catalog changes)", added.length > 0 && added.every((x) => /get_enforcement_readiness/.test(x)) && JSON.parse(before).every((x) => after.includes(x)), `${added.length} new entries`);
  const acl = await H.aclCheck(q, ["get_enforcement_readiness"]);
  rec("ACL get_enforcement_readiness SECURITY DEFINER + authenticated, no PUBLIC/anon, one overload", acl.ok, acl.detail);

  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1,'CLS0001')`, [G]);
  const day = async (k) => (await q(`SELECT ((now() AT TIME ZONE 'America/New_York')::date + $1::int)::text d`, [k]))[0].d;
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-5), expiration_date: await day(300) }), "{}"]);
  await must("mgrX", "SELECT create_service_authorization($1,'cls','AUTH-S11',6,$2::date,$3::date)", [CX, await day(-5), await day(90)]);
  const sh = async (k, start, status = "open") => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5::time,($5::time + interval '1 hour')::time,$6,$7,1)`, [id, A, CX, await day(k), start, OX, status]); return id; };
  // assigned (Gina: not trained, no credentials) on day 1 and day 2; unassigned on day 3 (6 units authorized, 4 per shift: the 2nd
  // assigned shift already leaves the authorization short); a cancelled one; one on day 14 (outside today..today+13)
  const S = { a1: await sh(1, "09:00"), a2: await sh(2, "09:00"), u3: await sh(3, "09:00"), c4: await sh(4, "09:00", "cancelled"), out: await sh(14, "09:00") };
  for (const k of ["a1", "a2"]) await must("mgrA", "SELECT assign_caregiver_to_shift($1,$2,'manual','s11 fixture','s11 fixture override')", [S[k], G]);
  const CODES = ["credential_missing", "training_missing", "authorization_missing", "authorization_expired", "units_short", "units_short_period"];
  // expected, straight from the existing reads
  const expect = { by: {}, block: 0 };
  for (const k of ["a1", "a2"]) {
    const e = (await call("mgrA", "SELECT check_assignment_eligibility($1,$2)", [S[k], G])).v;
    const codes = [...new Set([...e.hard, ...e.advisory].map((x) => x.code).filter((c) => CODES.includes(c)))];
    if (codes.length) expect.block++; for (const c of codes) expect.by[c] = (expect.by[c] || 0) + 1;
  }
  const ctx = (await q("SELECT cp_shift_client_context($1) c", [S.u3]))[0].c;
  const uCode = { missing: "authorization_missing", expired: "authorization_expired", short: "units_short", short_period: "units_short_period" }[ctx.proj?.status];
  if (uCode) { expect.block++; expect.by[uCode] = (expect.by[uCode] || 0) + 1; }
  const r0 = (await call("mgrX", "SELECT get_enforcement_readiness($1)", [OX])).v;
  const sameBy = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  rec("E0 switch off: would_block and the breakdown by reason equal the existing eligibility reads (assigned: training + credential; unassigned: authorization units); 3 shifts checked (cancelled and day-14 shifts excluded)",
    r0.enforcement === false && r0.shifts_checked === 3 && r0.would_block === expect.block && sameBy(r0.by_reason, expect.by) && r0.days === 14 && !r0.shifts.some((x) => x.shift_id === S.out || x.shift_id === S.c4),
    `checked ${r0.shifts_checked}; block ${r0.would_block} (expected ${expect.block}); ${JSON.stringify(r0.by_reason)} vs ${JSON.stringify(expect.by)}`);
  rec("N1 rows carry names, dates and codes only (client first name + initial, caregiver name); no clinical text",
    r0.shifts.every((x) => Object.keys(x).sort().join() === "caregiver_id,caregiver_name,client_first_name,client_id,client_last_initial,codes,shift_date,shift_id,start_time") && r0.shifts[0].client_last_initial.length === 1,
    JSON.stringify(r0.shifts[0]));
  await must("aaA", "SELECT set_compliance_enforcement($1,true)", [OX]);
  const r1 = (await call("mgrX", "SELECT get_enforcement_readiness($1)", [OX])).v;
  rec("E1 switch on: the same counts (the codes are now hard), enforcement true", r1.enforcement === true && r1.would_block === r0.would_block && sameBy(r1.by_reason, r0.by_reason), JSON.stringify(r1.by_reason));
  await must("aaA", "SELECT set_compliance_enforcement($1,false)", [OX]);
  const r7 = (await call("mgrX", "SELECT get_enforcement_readiness($1, 3)", [OX])).v;
  rec("E2 a 3-day window checks today .. today + 2 only", r7.shifts_checked === 2 && r7.to === await day(2), `${r7.shifts_checked} checked, to ${r7.to}`);
  const ok = []; for (const who of ["mgrX", "mgrA", "aaA"]) { const r = await call(who, "SELECT get_enforcement_readiness($1)", [OX]); if (!r.err) ok.push(who); }
  const refused = []; for (const who of ["mgrY", "schX", "hrX", "cg", "cl", "aaB", "sysA", "anon"]) { const r = await call(who, "SELECT get_enforcement_readiness($1)", [OX]); if (r.err && H.DENY.test(r.err)) refused.push(who); else console.log("  not refused:", who, r.err || ""); }
  const ghost = await call("aaA", "SELECT get_enforcement_readiness($1)", [H.U(999999)]);
  rec("R1 manager (office and all) and agency_admin read it; the other office's manager, scheduler, hr_staff, caregiver, client, the other agency's admin, system_admin and anon are refused generically; an unknown office too",
    ok.length === 3 && refused.length === 8 && !!ghost.err && H.DENY.test(ghost.err), `ok ${ok}; refused ${refused.length}/8`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });
