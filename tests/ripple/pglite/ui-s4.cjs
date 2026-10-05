// UI S4 backend on PGlite: per-authorization projection (same FIFO as cp_projected_units), units table,
// G2 risk bands, W2 correct_service_authorization (three refusals, audit, reason), set_care_plan_rows,
// denials and ACLs. Usage: node tests/ripple/pglite/ui-s4.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
const S4 = "20261014120100_ui_s4_authorizations.sql";
let seq = 0; const nid = () => H.U(9000 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S4); const { db, q, day, call, must } = t;
  await H.applyFiles(db, [S4]);
  const { CX, G, OX } = H;
  const shift = async (clientId, off, start, end, assigned = true) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5::time,$6::time,$7,'open', extract(epoch FROM ($6::time - $5::time))/3600)`, [id, H.A, clientId, await day(off), start, end, OX]);
    if (assigned) await db.query(`INSERT INTO shift_assignments (shift_id, caregiver_id, status) VALUES ($1,$2,'scheduled')`, [id, G]);
    return id; };
  const note = async (authId, off, units, status = "reviewed") => { const id = nid();
    await db.query(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, authorization_id, note_kind, service_type, service_date, units_scheduled, billable, status)
      VALUES ($1,$2,$3,$4,$5,$6,'cls','cls',$7::date,$8,true,$9::progress_note_status)`, [id, H.A, OX, CX, G, authId, await day(off), units, status]); return id; };
  const AUTH = "SELECT create_service_authorization($1,'cls',$2,$3,$4::date,$5::date,15,NULL,NULL,NULL,$6::auth_period_type,$7,NULL,'{}'::jsonb,$8)";
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) })]);

  // ================= projection + units table =================
  const a1 = await must("mgrX", AUTH, [CX, "ZZ-A1", 40, await day(-30), await day(20), null, null, 10]);   // 30 available
  const a2 = await must("mgrX", AUTH, [CX, "ZZ-A2", 100, await day(-30), await day(200), null, null, 0]);
  const s1 = await shift(CX, 5, "09:00", "10:00"); await shift(CX, 6, "09:00", "11:00"); await shift(CX, 30, "09:00", "10:00"); await shift(CX, 7, "09:00", "10:00", false);
  const tab = (await must("mgrX", "SELECT get_client_authorizations($1)", [CX])).authorizations;
  const r1 = tab.find((x) => x.id === a1), r2 = tab.find((x) => x.id === a2);
  const cp = (await q("SELECT cp_projected_units($1,'cls',$2::date,0,NULL) v", [CX, await day(20)]))[0].v;
  rec("P1 units table: opening balance counts as used (40 auth, 10 before CareMuch -> used 10); assigned shifts are pending FIFO on the earliest-expiring authorization; an unassigned shift isn't; a shift after A1's expiry goes to A2",
    r1.units_used === 10 && r1.units_pending === 12 && r1.units_left === 18 && r2.units_pending === 4 && r2.units_left === 96 && r1.status === "active",
    `A1 used ${r1.units_used} pending ${r1.units_pending} left ${r1.units_left}; A2 pending ${r2.units_pending} left ${r2.units_left}`);
  rec("P2 the projection equals cp_projected_units for the same date (A1 projected left)", !!cp && Number(cp.projected) === r1.units_left && cp.authorization_id === a1, JSON.stringify(cp));
  // period cap: A3 per_week 8 (weekly cap left this week)
  const CP2 = H.U(402); await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Pia','Second',$3)`, [CP2, H.A, OX]);
  const a3 = await must("mgrX", AUTH, [CP2, "ZZ-A3", 200, await day(-30), await day(100), "per_week", 8, 0]);
  const t3 = (await must("schX", "SELECT get_client_authorizations($1)", [CP2])).authorizations[0];
  rec("P3 per-week cap with no demand: period_left = 8; a scheduler (authorization tier) may read the units table", t3.id === a3 && Number(t3.period_left) === 8, `period_left ${t3.period_left}`);

  // ================= G2 risk =================
  const CR = H.U(403); await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Rita','Risk',$3)`, [CR, H.A, OX]);
  const offs = [61, 60, 31, 30, 29, 0, -1]; const ra = {};
  for (const o of offs) ra[o] = await must("mgrX", AUTH, [CR, `ZZ-R${o}`, 20, await day(-100), await day(o), null, null, 0]);
  await shift(CR, 0, "09:00", "10:00");   // 4 units today -> charged to R0 (earliest valid that fits... R0 expires today)
  const risk = await must("mgrX", "SELECT list_authorization_risk($1,60)", [OX]);
  const band = (o) => (risk.find((x) => x.authorization_id === ra[o]) || {}).band;
  const r0 = risk.find((x) => x.authorization_id === ra[0]);
  rec("G2-a bands: 61 not listed, 60 yellow, 31 yellow, 30 red, 29 red, 0 red, expired not listed; client shown as first name + initial",
    band(61) === undefined && band(60) === "yellow" && band(31) === "yellow" && band(30) === "red" && band(29) === "red" && band(0) === "red" && band(-1) === undefined
      && r0.client_name === "Rita R.", offs.map((o) => `${o}=${band(o) || "-"}`).join(" "));
  rec("G2-b units at risk = projected left that no assigned shift uses before expiry (20 - 4 assigned today = 16; 16 units = 4 h)",
    r0.units_pending === 4 && r0.units_at_risk === 16 && Number(r0.hours_at_risk) === 4 && risk.find((x) => x.authorization_id === ra[60]).units_at_risk === 20,
    `R0 pending ${r0.units_pending} at risk ${r0.units_at_risk} (${r0.hours_at_risk} h)`);

  // ================= W2 correct =================
  const COR = "SELECT correct_service_authorization($1,$2::jsonb,$3)";
  await note(a1, -3, 12);   // 12 units charged to A1 (reviewed); A1 used = 12 + 10
  const below = await call("mgrX", COR, [a1, JSON.stringify({ units_authorized: 21 }), "typo"]);
  const okUnits = await call("mgrX", COR, [a1, JSON.stringify({ units_authorized: 22 }), "corrected from the paper authorization"]);
  const avail = (await q(`SELECT units_available FROM service_authorizations WHERE id = $1`, [a1]))[0].units_available;
  rec("W2-a units below charged + opening balance refused (21 < 12 + 10); exactly 22 accepted and units_available re-derived (0)",
    /can't go below the 12 units already charged plus the 10/.test(below.err || "") && !okUnits.err && Number(avail) === 0, `${(below.err || "ACCEPTED").slice(0, 90)}; 22: ${okUnits.err || "ok"}; available ${avail}`);
  const dates = await call("mgrX", COR, [a1, JSON.stringify({ effective_date: await day(-2) }), "dates"]);
  const datesOk = await call("mgrX", COR, [a1, JSON.stringify({ effective_date: await day(-3), expiration_date: await day(25) }), "dates fixed"]);
  rec("W2-b dates that leave out a reviewed visit refused; dates still covering it accepted",
    /leave out a reviewed or billed visit/.test(dates.err || "") && !datesOk.err, `${(dates.err || "ACCEPTED").slice(0, 80)}; covering: ${datesOk.err || "ok"}`);
  const capBad = await call("mgrX", COR, [a1, JSON.stringify({ period_type: "per_week", units_per_period: 8 }), "cap"]);
  const capOk = await call("mgrX", COR, [a1, JSON.stringify({ period_type: "per_week", units_per_period: 12 }), "cap from the auth letter"]);
  rec("W2-c a weekly cap that the week's charged units (12) already exceed is refused (8); 12 accepted",
    /already charged exceed this cap/.test(capBad.err || "") && !capOk.err, `${(capBad.err || "ACCEPTED").slice(0, 80)}; 12: ${capOk.err || "ok"}`);
  const misc = [await call("mgrX", COR, [a1, JSON.stringify({ units_authorized: 30 }), " "]), await call("mgrX", COR, [a1, JSON.stringify({ service_type: "respite" }), "x"]),
    await call("mgrX", COR, [a1, JSON.stringify({ units_authorized: 22 }), "same"]), await call("mgrX", COR, [a1, JSON.stringify({ auth_number: "zz-a2" }), "dup"]),
    await call("mgrX", COR, [a1, JSON.stringify({ units_used_before_caremuch: 50 }), "open"])];
  rec("W2-d reason required; service type can't be corrected; no-op refused; duplicate number refused (case-insensitive); opening balance above units refused",
    /reason/.test(misc[0].err || "") && /can't be corrected here/.test(misc[1].err || "") && /Nothing to change/.test(misc[2].err || "") && /already exists/.test(misc[3].err || "") && /between 0 and the units/.test(misc[4].err || ""),
    misc.map((x) => (x.err || "ACCEPTED").slice(0, 40)).join(" | "));
  const ev = await q(`SELECT payload, actor_id, virtual_office_id FROM events WHERE event_type = 'authorization_corrected' AND subject_id = $1 ORDER BY occurred_at`, [a1]);
  rec("W2-e every accepted correction is audited (changed fields + reason, actor, office); refused ones are not",
    ev.length === 3 && ev[0].payload.reason === "corrected from the paper authorization" && JSON.stringify(ev[0].payload.changed) === '["units_authorized"]'
      && JSON.stringify(ev[1].payload.changed) === '["effective_date","expiration_date"]' && ev.every((e) => e.actor_id === H.users.mgrX && e.virtual_office_id === OX),
    ev.map((e) => JSON.stringify(e.payload.changed)).join(" "));
  const wl = []; let wn = 0;
  for (const w of ["schX", "hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, COR, [a2, JSON.stringify({ units_authorized: 99 }), "x"]); wn++; if (!r.err || !H.DENY.test(r.err)) wl.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("W2-f correction refused for scheduler, hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", wl.length === 0, wl.join("; ") || `${wn} refused`);

  // ================= IPOS child rows =================
  const ROWS = "SELECT set_care_plan_rows($1,$2,$3::jsonb)";
  const tv0 = (await q(`SELECT training_version FROM care_plans WHERE id = $1`, [plan]))[0].training_version;
  await must("mgrX", ROWS, [plan, "care_plan_attendee", JSON.stringify([{ name: "Ann", relationship: "Mother", attended: true }, { name: "Bo", relationship: "Case manager" }])]);
  const att = await q(`SELECT id, name FROM care_plan_attendees WHERE care_plan_id = $1 ORDER BY name`, [plan]);
  await must("mgrX", ROWS, [plan, "care_plan_attendee", JSON.stringify([{ id: att[0].id, name: "Ann B", relationship: "Mother", attended: true, contributed: true }])]);
  const att2 = await q(`SELECT id, name, contributed FROM care_plan_attendees WHERE care_plan_id = $1`, [plan]);
  await must("mgrX", ROWS, [plan, "care_plan_external_service", JSON.stringify([{ provider_program: "CMH", service: "Respite", units_text: "8/month", effective_date: await day(0) }])]);
  await must("mgrX", ROWS, [plan, "care_plan_need", JSON.stringify([{ source: "michicans", domain: "Safety", item_text: "x" }])]);
  const need = (await q(`SELECT item_kind FROM care_plan_needs WHERE care_plan_id = $1`, [plan]))[0];
  rec("R-a rows are added, updated by id (same row), and dropped when left out; defaults fill required columns (item_kind 'need'); training_version untouched",
    att2.length === 1 && att2[0].id === att[0].id && att2[0].name === "Ann B" && att2[0].contributed === true && need.item_kind === "need"
      && (await q(`SELECT count(*)::int n FROM care_plan_external_services WHERE care_plan_id = $1`, [plan]))[0].n === 1
      && (await q(`SELECT training_version FROM care_plans WHERE id = $1`, [plan]))[0].training_version === tv0,
    `attendees ${att2.map((a) => a.name).join(",")}; need kind ${need.item_kind}`);
  const CY = H.U(404); await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Yan','Other',$3)`, [CY, H.A, H.OY]);
  const planY = await must("mgrY", "SELECT create_care_plan($1,'initial',$2::jsonb)", [CY, JSON.stringify({ effective_date: await day(0), expiration_date: await day(300) })]);
  await must("mgrY", ROWS, [planY, "care_plan_attendee", JSON.stringify([{ name: "Y1" }])]);
  const yRow = (await q(`SELECT id FROM care_plan_attendees WHERE care_plan_id = $1`, [planY]))[0].id;
  const bad = [await call("mgrX", ROWS, [plan, "care_plan_attendee", JSON.stringify([{ id: yRow, name: "steal" }])]), await call("mgrX", ROWS, [plan, "care_plan_attendee", JSON.stringify([{ ssn: "x" }])]),
    await call("mgrX", ROWS, [plan, "care_plan_goal", "[]"]), await call("mgrX", ROWS, [plan, "care_plan_need", JSON.stringify([{ domain: "x" }])]),
    await call("mgrX", ROWS, [plan, "care_plan_natural_support", JSON.stringify([{ support_type: "friend" }])])];
  rec("R-b another plan's row id refused (generic); unknown column, goals (own RPC), missing required column, invalid enum refused; the other plan's row is untouched",
    H.DENY.test(bad[0].err || "") && /Unknown column/.test(bad[1].err || "") && /Unknown plan section/.test(bad[2].err || "") && /required/.test(bad[3].err || "") && /invalid value/.test(bad[4].err || "")
      && (await q(`SELECT name FROM care_plan_attendees WHERE id = $1`, [yRow]))[0].name === "Y1", bad.map((x) => (x.err || "ACCEPTED").slice(0, 35)).join(" | "));
  const rl = []; let rn = 0;
  for (const w of ["schX", "hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, ROWS, [plan, "care_plan_attendee", "[]"]); rn++; if (!r.err || !H.DENY.test(r.err)) rl.push(`${w}: ${r.err || "ALLOWED"}`); }
  await must("mgrX", "SELECT renew_care_plan($1)", [plan]);
  const sup = await call("mgrX", ROWS, [plan, "care_plan_attendee", "[]"]);
  const evRows = (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'care_plan_updated' AND subject_id = $1 AND payload ? 'section'`, [plan]))[0].n;
  rec("R-c refused for scheduler, hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; a superseded plan is read-only; each write audited (care_plan_updated, section + count)",
    rl.length === 0 && /Only the active plan/.test(sup.err || "") && evRows === 4, `${rl.join("; ") || `${rn} refused`}; superseded "${sup.err || "ACCEPTED"}"; events ${evRows}`);

  // ================= read denials + ACL =================
  const dl = []; let dn = 0;
  for (const w of ["hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) {
    for (const [sql, p] of [["SELECT get_client_authorizations($1)", [CX]], ["SELECT list_authorization_risk($1,60)", [OX]]]) { const r = await call(w, sql, p); dn++; if (!r.err || !H.DENY.test(r.err)) dl.push(`${w} ${sql.slice(7, 30)}: ${r.err || "ALLOWED"}`); } }
  const schRisk = await call("schX", "SELECT list_authorization_risk($1,60)", [OX]);
  rec("D reads refused for hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; scheduler allowed (authorization tier)", dl.length === 0 && !schRisk.err, dl.join("; ") || `${dn} refused`);
  const acl = await H.aclCheck(q, ["get_client_authorizations", "list_authorization_risk", "correct_service_authorization", "set_care_plan_rows", "cp_authorization_projection", "cp_plan_row_spec"]);
  rec("ACL 4 RPCs SECURITY DEFINER + authenticated, no PUBLIC/anon; the 2 internal helpers have no API role", acl.ok, acl.detail);
  void s1;
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });
