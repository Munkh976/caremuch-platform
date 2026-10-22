// Auto-assign + Smart Assign scoring on PGlite: 20261030130000. Catalog (additive; events CHECK 57 + 2), ACLs, office
// weights (defaults, validation, agency admin only, audited), the score identical to match-caregiver's for default
// weights (a port of its code is the reference), continuity and weight-0 reasons, the 4a gate, propose (read-only;
// same-date overlaps, weekly hours and units / period caps as running totals; hardest first; blocked reasons), commit
// (re-check, auto_assigned, one auto_assign_run), roles.
// Usage: node tests/ripple/pglite/auto-assign.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261030130000_auto_assign.sql", FIX = "20261030130100_auto_assign_commit_events.sql";
let seq = 0; const sid = () => H.U(9900 + ++seq);

// ---- reference: match-caregiver's scoring (supabase/functions/match-caregiver/index.ts), unchanged logic ----
function reference(shift, client, needs, careTypeNames, c, skills, avail, perf) {
  const W = { skillCoverage: 40, serviceArea: 25, availability: 15, reliability: 10, performance: 10 };
  const neededCodes = Array.from(new Set([shift.care_type_code, ...needs].filter(Boolean)));
  const keyFactors = [], warnings = [];
  const skillCodes = new Set(skills);
  const matchedCodes = neededCodes.filter((code) => skillCodes.has(code));
  const skillCoverageScore = matchedCodes.length / neededCodes.length;
  if (matchedCodes.length > 0) keyFactors.push(`Matches ${matchedCodes.length} of ${neededCodes.length} required care skills (${matchedCodes.map((x) => careTypeNames[x] || x).join(", ")})`);
  else warnings.push(`No matching skills on file for this shift's care requirements`);
  const zips = c.service_zipcodes || [], clientZip = client.zip_code ?? null;
  const serviceAreaScore = zips.length === 0 || !clientZip || zips.includes(clientZip) ? 1 : 0;
  if (serviceAreaScore === 0) warnings.push(`Outside service area (client zip ${clientZip} not in caregiver's service zip list)`);
  const shiftDow = new Date(`${shift.shift_date}T00:00:00Z`).getUTCDay();
  let availabilityScore = 1;
  if (avail.length > 0) {
    const covered = avail.some((a) => a.day_of_week === shiftDow && a.is_available !== false && a.start_time <= shift.start_time && a.end_time >= shift.end_time);
    availabilityScore = covered ? 1 : 0; if (!covered) warnings.push(`Outside declared availability for this shift's day/time`);
  }
  const reliability = c.reliability_score ?? 100;
  const reliabilityScore = Math.min(Math.max(reliability, 0), 100) / 100;
  if (reliability < 70) warnings.push(`Reliability score ${reliability} is below the 70 threshold`);
  let performanceScore = 1;
  if (perf?.avg_rating != null) {
    performanceScore = ((perf.avg_rating / 5) + ((perf.completion_rate ?? 100) / 100) + ((perf.on_time_rate ?? 100) / 100)) / 3;
    keyFactors.push(`Rated ${perf.avg_rating}/5.0 from ${perf.rating_count} shifts (completion ${perf.completion_rate}%, on-time ${perf.on_time_rate}%)`);
  } else keyFactors.push("New caregiver — not yet rated (scored neutrally)");
  const match_score = Math.round(W.skillCoverage * skillCoverageScore + W.serviceArea * serviceAreaScore + W.availability * availabilityScore + W.reliability * reliabilityScore + W.performance * performanceScore);
  return { match_score, key_factors: keyFactors, warnings };
}

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, call, must } = t;
  const { A, OX, OY, CX, G, TZ, users } = H;
  const at = async (k) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [k]))[0].d;
  const evVals = async () => [...(await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='events_event_type_check'`))[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  const before = await H.snap(db), ev0 = await evVals();
  await H.applyFiles(db, [MIG, FIX]);
  const after = await H.snap(db), ev1 = await evVals();
  const removed = before.filter((x) => !after.includes(x));
  rec("F0 catalog: additive (only the events CHECK replaced: 57 values kept + auto_assign_run, office_match_weights_changed)",
    removed.length === 1 && removed[0].startsWith("con:events.events_event_type_check") && ev0.length === 57 && ev1.length === 59 && ev0.every((v) => ev1.includes(v)), `-${removed.length}; events ${ev0.length} -> ${ev1.length}`);
  const API = ["set_office_match_weights", "suggest_caregivers", "propose_auto_assignments", "commit_auto_assignments"];
  const acl = await H.aclCheck(q, [...API, "cp_match_factors", "cp_office_match_weights", "cp_client_gate", "cp_shift_candidates", "cp_unassigned_shifts"]);
  rec("ACL 4 API functions SECURITY DEFINER, authenticated only; internal helpers no API role", acl.ok, acl.detail);

  // ---- office Y without the module: caregivers with different inputs ----
  await db.query(`UPDATE virtual_office SET care_plan_module_enabled = false, compliance_enforcement_enabled = false WHERE id = $1`, [OY]);
  await db.query(`UPDATE care_types SET name = 'Community Living Supports' WHERE code = 'CLS0001'`);
  const CY = H.U(450);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id, zip_code) VALUES ($1,$2,'Yara','Client',$3,'49002')`, [CY, A, OY]);
  await db.query(`INSERT INTO client_care_needs (client_id, care_type_code) VALUES ($1,'RESP0001')`, [CY]);
  const cg = {};
  const mk = async (k, first, extra) => { const id = H.U(460 + Object.keys(cg).length); cg[k] = id;
    await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active, service_zipcodes, reliability_score) VALUES ($1,$2,$3,'Y',$4,true,$5,$6)`,
      [id, A, first, OY, extra.zips || null, extra.rel ?? null]);
    for (const s of extra.skills || ["CLS0001"]) await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1,$2)`, [id, s]);
    for (const a of extra.avail || []) await db.query(`INSERT INTO caregiver_availability (caregiver_id, day_of_week, start_time, end_time, is_available) VALUES ($1,$2,$3,$4,true)`, [id, a[0], a[1], a[2]]);
    if (extra.perf) await db.query(`INSERT INTO caregiver_performance (caregiver_id, avg_rating, rating_count, completion_rate, on_time_rate) VALUES ($1,$2,$3,$4,$5)`, [id, ...extra.perf]);
  };
  const d5 = await at(5), dow5 = (await q(`SELECT extract(dow FROM $1::date)::int d`, [d5]))[0].d;
  await mk("ann", "Ann", { skills: ["CLS0001", "RESP0001"], perf: [4.5, 12, 100, 95] });
  await mk("bob", "Bob", { zips: ["49001"], rel: 65 });
  await mk("cat", "Cat", { avail: [[dow5, "08:00", "12:00"]], perf: [3.8, 5, 90, 80] });
  await mk("dan", "Dan", { avail: [[(dow5 + 1) % 7, "08:00", "12:00"]] });
  await mk("eve", "Eve", { zips: ["49002", "49003"], rel: 88 });
  const shift = async (k, s, e, extra = {}) => { const id = sid(); await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, group_session_id)
      VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,'open',$9,$10)`, [id, A, extra.client || CY, extra.code || "CLS0001", await at(k), s, e, extra.office || OY, extra.hours || 1, extra.group || null]); return id; };
  const S1 = await shift(5, "09:00", "10:00");
  const ref = {}; const sh = { shift_date: d5, start_time: "09:00:00", end_time: "10:00:00", care_type_code: "CLS0001" };
  for (const [k, id] of Object.entries(cg)) {
    const c = (await q(`SELECT service_zipcodes, reliability_score FROM caregivers WHERE id = $1`, [id]))[0];
    const skills = (await q(`SELECT care_type_code FROM caregiver_skills WHERE caregiver_id = $1`, [id])).map((r) => r.care_type_code);
    const av = (await q(`SELECT day_of_week, start_time::text start_time, end_time::text end_time, is_available FROM caregiver_availability WHERE caregiver_id = $1`, [id]));
    const p = (await q(`SELECT avg_rating::float8 avg_rating, rating_count::int rating_count, completion_rate::float8 completion_rate, on_time_rate::float8 on_time_rate FROM caregiver_performance WHERE caregiver_id = $1`, [id]))[0];
    ref[k] = reference(sh, { zip_code: "49002" }, ["RESP0001"], { CLS0001: "Community Living Supports", RESP0001: "Respite" }, c, skills, av, p);
  }
  const got = {};
  for (const [k, id] of Object.entries(cg)) got[k] = (await q(`SELECT cp_match_factors($1,$2,NULL,$3::date) m`, [S1, id, await at(0)]))[0].m;
  const diff = Object.keys(cg).filter((k) => got[k].score !== ref[k].match_score || JSON.stringify(got[k].key_factors) !== JSON.stringify(ref[k].key_factors) || JSON.stringify(got[k].warnings) !== JSON.stringify(ref[k].warnings));
  rec("S1 default weights: the score, key factors and warnings equal match-caregiver's (reference port) for 5 caregivers (skills 1/2 or 2/2, zip in / out, availability on / off the day, reliability 65 / 88, rated / new)",
    diff.length === 0, Object.keys(cg).map((k) => `${k} ${got[k].score}/${ref[k].match_score}`).join(" ") + (diff.length ? ` DIFF ${diff.map((k) => `${k}: ${JSON.stringify(got[k].key_factors)} vs ${JSON.stringify(ref[k].key_factors)} / ${JSON.stringify(got[k].warnings)} vs ${JSON.stringify(ref[k].warnings)}`).join(" | ")}` : ""));

  // ---- weights ----
  const W = { skills: 0, service_area: 0, availability: 30, reliability: 20, performance: 20, continuity: 30 };
  const bad = [];
  for (const w of [{ ...W, continuity: 29 }, { skills: 100 }, { ...W, availability: 30.5, reliability: 19.5 }, { ...W, skills: -10, continuity: 40 }]) { const r = await call("aaA", "SELECT set_office_match_weights($1,$2::jsonb)", [OY, JSON.stringify(w)]); if (/6 factors/.test(r.err || "")) bad.push(1); }
  const deny = []; for (const who of ["mgrY", "schX", "mgrA", "aaB", "cg", "anon"]) { const r = await call(who, "SELECT set_office_match_weights($1,$2::jsonb)", [OY, JSON.stringify(W)]); if (r.err && H.DENY.test(r.err)) deny.push(who); }
  const set = await call("aaA", "SELECT set_office_match_weights($1,$2::jsonb)", [OY, JSON.stringify(W)]);
  const auditW = (await q(`SELECT payload FROM events WHERE event_type = 'office_match_weights_changed' AND subject_id = $1`, [OY]));
  rec("W1 weights: invalid sets refused with the reason (sum 99, missing factors, decimals, negative); only the agency admin may set them (manager, scheduler, other agency, caregiver, anon refused); saved and audited with before / after",
    bad.length === 4 && deny.length === 6 && !set.err && set.v.continuity === 30 && auditW.length === 1 && auditW[0].payload.before.skills === 40 && auditW[0].payload.after.skills === 0,
    `bad ${bad.length}/4; deny ${deny.length}/6; ${JSON.stringify(set.v)}`);
  // continuity: Cat served Yara 3 times recently; Ann once 50 days ago
  const past = async (k, who) => { const id = await shift(k, "13:00", "14:00"); await db.query(`INSERT INTO shift_assignments (shift_id, caregiver_id, status) VALUES ($1,$2,'completed')`, [id, cg[who]]).catch(async () => {
      await db.query(`SELECT set_config('caremuch.assignment_ctx','1',false)`); await db.query(`INSERT INTO shift_assignments (shift_id, caregiver_id, status) VALUES ($1,$2,'completed')`, [id, cg[who]]); await db.query(`SELECT set_config('caremuch.assignment_ctx','',false)`); }); };
  for (const k of [-3, -10, -17]) await past(k, "cat");
  await past(-50, "ann");
  const sug = (await call("mgrA", "SELECT suggest_caregivers($1)", [S1]));
  const order = (sug.v?.matches || []).map((m) => m.caregiver.first_name);
  const catM = (sug.v?.matches || []).find((m) => m.caregiver.first_name === "Cat");
  const anyKf = (sug.v?.matches || []).flatMap((m) => m.key_factors);
  rec("S2 Ripple-style weights (skills 0, area 0, continuity on): Cat (3 visits in 60 days, available) ranks first with 'Served this client 3× in the last 60 days'; skills / service-area reasons are not shown (weight 0)",
    !sug.err && order[0] === "Cat" && catM.key_factors.some((k) => /Served this client 3× in the last 60 days/.test(k)) && !anyKf.some((k) => /required care skills/.test(k))
      && !(sug.v.matches || []).flatMap((m) => m.warnings).some((w) => /service area/.test(w)), `${sug.err || order.join(" > ")}; ${JSON.stringify(catM && catM.key_factors)}`);
  await call("aaA", "SELECT set_office_match_weights($1,NULL)", [OY]);
  rec("W2 setting NULL returns the office to the agency / default weights", (await q(`SELECT cp_office_match_weights($1) w`, [OY]))[0].w.skills === 40, "");

  // ---- gate (4a) ----
  const gi = (r) => q(`SELECT jsonb_array_length(cp_gate_issues($1::jsonb)) n`, [JSON.stringify(r)]).then((x) => x[0].n);
  const g1 = await gi({ hard: [], soft: [], advisory: [{ code: "training_missing" }, { code: "travel_buffer" }] }), g2 = await gi({ hard: [], soft: [{ code: "weekly_hours" }], advisory: [] }), g3 = await gi({ hard: [], soft: [], advisory: [{ code: "overtime_risk" }, { code: "preferred_caregiver" }] });
  const blockedClient = (await call("mgrX", "SELECT suggest_caregivers($1)", [await shift(6, "09:00", "10:00", { client: CX, office: OX })])).v;
  rec("G1 the gate drops care-plan advisory issues (training) and soft issues (weekly hours) but keeps other advisories (overtime risk, preferred caregiver); in a care-plan office a client not onboarded blocks every proposal",
    g1 === 1 && g2 === 1 && g3 === 0 && /^Client not onboarded \(\d+ of \d+\)$/.test(blockedClient.client_blocked || "") && blockedClient.matches.length === 0, `${g1}/${g2}/${g3}; ${blockedClient.client_blocked}`);

  // ---- propose: running totals in office Y (weekly cap 3 h for the test) ----
  await db.query(`UPDATE agency SET max_weekly_hours = 3 WHERE id = $1`, [A]);
  await db.query(`UPDATE caregivers SET is_active = false WHERE id = ANY($1)`, [[cg.bob, cg.dan, cg.eve]]);   // pool: Ann, Cat
  await db.query(`DELETE FROM caregiver_availability`);
  const sA = await shift(8, "09:00", "10:00"), sB = await shift(8, "09:30", "10:30"), sC = await shift(8, "11:00", "12:00"), sD = await shift(9, "09:00", "10:00"), sE = await shift(9, "11:00", "12:00");
  const evN = async () => (await q(`SELECT count(*)::int n FROM events`))[0].n;
  const asgN = async () => (await q(`SELECT count(*)::int n FROM shift_assignments WHERE status <> 'completed'`))[0].n;
  const e0 = await evN(), a0 = await asgN();
  const pr = await call("mgrA", "SELECT propose_auto_assignments($1,$2::date,$3::date)", [OY, await at(7), await at(10)]);
  const props = (pr.v?.proposals || []), byS = Object.fromEntries(props.map((p) => [p.shift_id, p.caregiver]));
  const blk = (pr.v?.blocked || []);
  rec("P1 propose is read-only (no assignment, no event written) and treats the set as a whole: two overlapping visits on the same day go to different caregivers, a non-overlapping visit the same day can go to the same one, a different date never conflicts; the weekly cap (3 h) stops a 4th hour",
    !pr.err && (await evN()) === e0 && (await asgN()) === a0 && byS[sA] && byS[sB] && byS[sA] !== byS[sB] && byS[sC] === byS[sA] && !!byS[sD] && (props.length + blk.length) === 5,
    `${pr.err || props.map((p) => `${p.shift_date.slice(5)} ${p.start_time.slice(0, 5)} ${p.caregiver} ${p.score}`).join(" | ")}; blocked ${blk.map((b) => `${b.start_time.slice(0, 5)}: ${b.reasons.join("; ")}`).join(" | ")}`);
  const cap = props.length === 5 && props.filter((p) => p.caregiver.startsWith("Ann")).length === 3 && props.filter((p) => p.caregiver.startsWith("Cat")).length === 2;
  rec("P2 the weekly cap is a running total over the whole set: Ann (best score) gets 3 one-hour visits, the others go to Cat", cap, props.map((p) => `${p.start_time.slice(0, 5)} ${p.caregiver}`).join(","));
  // ---- commit ----
  await db.query(`UPDATE caregivers SET is_active = false WHERE id = $1`, [cg.cat]);   // changed since the preview
  const cm = await call("mgrA", "SELECT commit_auto_assignments($1,$2::date,$3::date,$4::jsonb)", [OY, await at(7), await at(10), JSON.stringify(props.map((p) => ({ shift_id: p.shift_id, caregiver_id: p.caregiver_id })))]);
  const made = await q(`SELECT a.shift_id, a.assignment_method::text m FROM shift_assignments a WHERE a.status <> 'cancelled' AND a.status <> 'completed'`);
  const run = await q(`SELECT payload FROM events WHERE event_type = 'auto_assign_run'`);
  const sa = (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'shift_assigned'`))[0].n;
  rec("C1 commit re-checks each pick (a caregiver deactivated since the preview: both of her visits skipped with the reason), assigns the rest through the existing path (auto_assigned) and writes one auto_assign_run (counts and shift ids) and one shift_assigned per assignment",
    !cm.err && cm.v.assigned.length === made.length && made.every((m) => m.m === "auto_assigned") && run.length === 1 && run[0].payload.assigned === cm.v.assigned.length
      && run[0].payload.requested === props.length && cm.v.skipped.length === 2 && cm.v.skipped.every((s) => /Inactive/.test(s.reason)) && cm.v.assigned.length === 3 && sa === 3,
    `${cm.err || `assigned ${cm.v.assigned.length}, skipped ${JSON.stringify(cm.v.skipped).slice(0, 120)}`}; run ${JSON.stringify(run[0] && run[0].payload).slice(0, 120)}`);
  const rl = [];
  for (const who of ["hrX", "mgrX", "aaB", "cg", "cl", "anon"]) { const r = await call(who, "SELECT propose_auto_assignments($1,$2::date,$3::date)", [OY, await at(7), await at(10)]); if (r.err && H.DENY.test(r.err)) rl.push(who); }
  const sg = []; for (const who of ["hrX", "mgrX", "aaB", "cg", "anon"]) { const r = await call(who, "SELECT suggest_caregivers($1)", [S1]); if (r.err && H.DENY.test(r.err)) sg.push(who); }
  const schOk = await call("schX", "SELECT propose_auto_assignments($1,$2::date,$3::date)", [OX, await at(7), await at(10)]);
  const long = await call("mgrA", "SELECT propose_auto_assignments($1,$2::date,$3::date)", [OY, await at(0), await at(90)]);
  // ---- units and per-week caps as running totals (care-plan office X; enforcement off) ----
  // Test double: the client-onboarding gate (8 onboarding items) is replaced for this section only; everything else is real.
  await db.query(`CREATE OR REPLACE FUNCTION public.cp_client_gate(_client_id uuid, _office_id uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$`);
  await db.query(`UPDATE agency SET max_weekly_hours = 40 WHERE id = $1`, [A]);
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  const G2x = H.U(480);
  await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,'Gus','X',$3,true)`, [G2x, A, OX]);
  for (const g of [G, G2x]) await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1,'CLS0001')`, [g]);
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  await must("mgrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [plan, users.mgrX, await at(-5)]);
  const m4 = await at(-4);
  await must("mgrX", "SELECT record_training_form($1,'ipos_initial',NULL,NULL,$2::jsonb,'{}'::jsonb)", [plan, JSON.stringify([G, G2x].map((g) => ({ caregiver_id: g, training_date: m4, trainer_name: "Pat", signed_date: m4 })))]);
  const types = (await q(`SELECT id FROM credential_types WHERE agency_id = $1 AND required AND is_active`, [A])).map((r) => r.id);
  for (const g of [G, G2x]) for (const ct of types) await must("hrX", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date,NULL)", [g, ct, await at(-30), await at(300)]);
  await must("mgrX", "SELECT create_service_authorization(_client_id => $1, _service_type => 'cls', _auth_number => 'AUTH-AA', _units_authorized => 100, _effective_date => $2::date, _expiration_date => $3::date, _period_type => 'per_week', _units_per_period => 8)",
    [CX, await at(-30), await at(60)]);
  const wk = await q(`SELECT d::date::text d FROM generate_series(((now() AT TIME ZONE '${TZ}')::date + 7 - extract(isodow FROM (now() AT TIME ZONE '${TZ}')::date)::int + 1), ((now() AT TIME ZONE '${TZ}')::date + 7 - extract(isodow FROM (now() AT TIME ZONE '${TZ}')::date)::int + 3), interval '1 day') d`);
  const ux = [];
  for (const r of wk) { const id = sid(); ux.push(id); await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours) VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'open',1)`, [id, A, CX, r.d, OX]); }
  await db.query(`UPDATE shifts SET status = 'cancelled' WHERE virtual_office_id = $1 AND NOT (id = ANY($2::uuid[]))`, [OX, ux]);   // the G1 visit of the same week
  const pu = await call("mgrX", "SELECT propose_auto_assignments($1,$2::date,$3::date)", [OX, wk[0].d, wk[2].d]);
  const pp = (pu.v?.proposals || []).filter((p) => ux.includes(p.shift_id)), pb = (pu.v?.blocked || []).filter((b) => ux.includes(b.shift_id));
  rec("U1 units: with a per-week cap of 8 units (two 1-hour CLS visits) the set proposes exactly 2 of the 3 visits that week; the 3rd is blocked with the units reason (the projection counts the earlier picks)",
    !pu.err && pp.length === 2 && pb.length === 1 && /period cap|units/i.test(pb[0].reasons.join(" ")), `${pu.err || `${pp.length} proposed; blocked: ${pb.map((b) => b.reasons.join("; ")).join(" | ")}`}`);
  rec("R1 roles: the office scheduler may propose (office X); propose refused for HR, office-X manager (office Y), other agency, caregiver, client, anon; Smart suggestions likewise; a period over two months is refused with the reason",
    rl.length === 6 && sg.length === 5 && /two months/.test(long.err || "") && !schOk.err, `${rl.length}/6; ${sg.length}/5; ${long.err}; scheduler office X ${schOk.err || "ok"}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });
