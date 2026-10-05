// UI S6 follow-ups + S7 backend on PGlite:
//   clients.case_number (trimmed, 1..32, nullable; staff set it; the client self-update guard refuses it),
//   get_client_training_context + case_number and list_client_training_status + client_name (every other
//   key and value unchanged vs before the migration),
//   get_caregiver_clock (DB clock, office week start) and list_my_notes_due (own started shifts in module
//   offices after go-live; statuses, overdue, returned reason; exact keys), late arrival units, refusals, ACLs.
// Usage: node tests/ripple/pglite/ui-s7.cjs   (local, no network)
const fs = require("fs");
const path = require("path");
const H = require("./harness.cjs");
const CN = "20261017120000_ui_s6_case_number_training_names.sql", S7 = "20261018120000_ui_s7_caregiver_notes.sql";
let seq = 0; const nid = () => H.U(9800 + ++seq);
const ITEM_KEYS = "client_first_name,client_last_initial,due_at,end_time,note_status,overdue,returned_reason,scheduled_end,scheduled_start,service_type,shift_date,shift_id,start_time";

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(CN); const { db, q, day, call, must } = t;
  await db.exec(fs.readFileSync(path.join(__dirname, "stub_s7.sql"), "utf8"));
  const { CX, G, OX, OY, A, users } = H;
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) }), "{}"]);
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify([{ seq: 1, goal_text: "Goal one", objectives: [
    { seq: 1, letter: "A", objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" },
    { seq: 2, letter: "B", objective_text: "CM follow-up", responsible_party: "case_management" }] }])]);

  // ---------- (3)/(4) before vs after the case-number migration ----------
  const ctxB = (await call("hrX", "SELECT get_client_training_context($1)", [CX])).v;
  const stB = (await call("hrX", "SELECT list_client_training_status($1)", [OX])).v.find((r) => r.client_id === CX);
  await H.applyFiles(db, [CN]);
  const ctxA = (await call("hrX", "SELECT get_client_training_context($1)", [CX])).v;
  const stA = (await call("hrX", "SELECT list_client_training_status($1)", [OX])).v.find((r) => r.client_id === CX);
  const without = (o, k) => { const c = { ...o }; delete c[k]; return JSON.stringify(c); };
  rec("C0 training context = before + 'case_number' (null until set); status list = before + 'client_name' (full name); everything else identical",
    without(ctxA, "case_number") === JSON.stringify(ctxB) && ctxA.case_number === null && without(stA, "client_name") === JSON.stringify(stB)
      && stA.client_name === "Carla Fixture" && stA.client_short === "Carla F.",
    `context extra keys ${Object.keys(ctxA).filter((k) => !(k in ctxB))}; status extra ${Object.keys(stA).filter((k) => !(k in stB))}; client_name "${stA.client_name}"`);
  const setCase = async (v) => { try { await db.query("UPDATE clients SET case_number = $1 WHERE id = $2", [v, CX]); return "ok"; } catch (e) { return /clients_case_number_chk/.test(e.message) ? "check" : e.message; } };
  const cs = { pad: await setCase(" ISK-1 "), empty: await setCase(""), long: await setCase("X".repeat(33)), max: await setCase("X".repeat(32)), nul: await setCase(null), ok: await setCase("ISK-00123") };
  rec("C1 case_number CHECK: untrimmed, empty and 33 characters refused; 32 characters, NULL and 'ISK-00123' accepted",
    cs.pad === "check" && cs.empty === "check" && cs.long === "check" && cs.max === "ok" && cs.nul === "ok" && cs.ok === "ok", JSON.stringify(cs));
  const asClient = async (sql) => { const r = await call("cl", sql, [CX]); return r.err || "ALLOWED"; };
  const clCase = await asClient("UPDATE clients SET case_number = 'HACKED' WHERE id = $1");
  const clPhone = await asClient("UPDATE clients SET phone = '555-0199' WHERE id = $1");
  const mgrCase = await call("mgrX", "UPDATE clients SET case_number = 'ISK-00456' WHERE id = $1", [CX]);
  const now = (await q("SELECT case_number, phone FROM clients WHERE id = $1", [CX]))[0];
  rec("C2 the client cannot change case_number (M-SEC-2 allow-list, function unchanged) but can still change the phone; staff can set it",
    /Only your contact details can be changed here/.test(clCase) && clPhone === "ALLOWED" && !mgrCase.err && now.case_number === "ISK-00456" && now.phone === "555-0199",
    `client case_number: ${clCase}; client phone: ${clPhone}; staff: ${mgrCase.err || "ok"}; stored ${now.case_number}`);
  const ctxC = (await call("hrX", "SELECT get_client_training_context($1)", [CX])).v;
  rec("C3 hr_staff reads the case number in the training context (prints); still no clinical keys", ctxC.case_number === "ISK-00456" && !("goals" in ctxC), `case_number ${ctxC.case_number}`);

  // ---------- S7 ----------
  await H.applyFiles(db, [S7]);
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '10 days' WHERE id = $1", [OX]);
  const G2 = nid(); await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,'Hal','Other',$3,true)`, [G2, A, OX]);
  const sh = async (d, start, end, code, cg, status = "assigned") => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,1,$10)`, [id, A, CX, code, await day(d), start, end, OX, status, cg]); return id; };
  const S = { a: await sh(-1, "09:00", "10:00", "CLS0001", G), b: await sh(-3, "09:00", "10:00", "CLS0001", G), future: await sh(1, "09:00", "10:00", "CLS0001", G),
    preGoLive: await sh(-20, "09:00", "10:00", "CLS0001", G), cancelled: await sh(-2, "09:00", "10:00", "CLS0001", G, "cancelled"),
    r: await sh(-1, "11:00", "12:00", "RESP0001", G), other: await sh(-1, "13:00", "14:00", "CLS0001", G2) };
  const LIST = "SELECT list_my_notes_due()";
  const l0 = (await call("cg", LIST)).v; const by = (l, s) => l.find((x) => x.shift_id === s);
  const keysOk = l0.length > 0 && l0.every((x) => Object.keys(x).sort().join(",") === ITEM_KEYS);
  rec("N1 notes due: own started shifts in the module office after go-live only (not future, pre-go-live, cancelled, or another caregiver's); exact keys; CLS / respite; client first name + last initial",
    l0.length === 3 && by(l0, S.a) && by(l0, S.b) && by(l0, S.r) && keysOk && by(l0, S.a).service_type === "cls" && by(l0, S.r).service_type === "respite"
      && by(l0, S.a).client_first_name === "Carla" && by(l0, S.a).client_last_initial === "F" && by(l0, S.a).note_status === "not_started",
    `listed ${l0.length}: ${l0.map((x) => `${Object.keys(S).find((k) => S[k] === x.shift_id)}=${x.note_status}`).join(", ")}; keys exact ${keysOk}`);
  rec("N2 overdue = open work past the day-after deadline: 3 days ago overdue, yesterday not yet",
    by(l0, S.b).overdue === true && by(l0, S.a).overdue === false && by(l0, S.a).returned_reason === null, `b ${by(l0, S.b).overdue} (due ${by(l0, S.b).due_at}); a ${by(l0, S.a).overdue}`);

  // note lifecycle through the B2 RPCs, read back through the list
  const nA = await must("cg", "SELECT create_progress_note_for_shift($1)", [S.a]);
  const nA2 = await must("cg", "SELECT create_progress_note_for_shift($1)", [S.a]);
  const view = await must("cg", "SELECT get_progress_note_for_caregiver($1)", [nA]);
  const start = (await q("SELECT scheduled_start FROM progress_notes WHERE id = $1", [nA]))[0].scheduled_start;
  await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [nA, JSON.stringify({ client_arrived_at: new Date(new Date(start).getTime() + 301000).toISOString() })]);
  const u = (await q("SELECT units_scheduled, units_used, arrived_late FROM progress_notes WHERE id = $1", [nA]))[0];
  const l1 = (await call("cg", LIST)).v;
  rec("N3 one note per shift (second open returns the same id); one entry for the this_agency objective, none for case management; arrival +5:01 is late and loses the first unit; list shows draft",
    nA === nA2 && view.entries.length === 1 && view.entries[0].objective_text === "Brush teeth" && u.arrived_late && Number(u.units_used) === Number(u.units_scheduled) - 1 && by(l1, S.a).note_status === "draft",
    `same id ${nA === nA2}; entries ${view.entries.map((e) => e.objective_text)}; units ${u.units_scheduled} -> ${u.units_used}; status ${by(l1, S.a).note_status}`);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [nA]);
  await must("mgrX", "SELECT return_progress_note($1,'Please add the reinforcers')", [nA]);
  const l2 = (await call("cg", LIST)).v;
  const nR = await must("cg", "SELECT create_progress_note_for_shift($1)", [S.r]);
  const rs = (await q("SELECT scheduled_start FROM progress_notes WHERE id = $1", [nR]))[0].scheduled_start;
  await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [nR, JSON.stringify({ client_arrived_at: new Date(rs).toISOString() })]);
  const empty = await call("cg", "SELECT submit_progress_note($1,'Gina Test')", [nR]);
  await must("cg", "SELECT save_progress_note_draft($1,'{}'::jsonb,'[]'::jsonb,$2)", [nR, "We went to the park."]);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [nR]);
  const l3 = (await call("cg", LIST)).v;
  rec("N4 returned note shows the reviewer's reason; respite cannot submit without the narrative; a submitted note stays listed as history (submitted, not overdue)",
    by(l2, S.a).note_status === "returned" && by(l2, S.a).returned_reason === "Please add the reinforcers" && /session narrative/.test(empty.err || "")
      && by(l3, S.r).note_status === "submitted" && by(l3, S.r).overdue === false && by(l3, S.r).returned_reason === null,
    `a ${by(l2, S.a).note_status} "${by(l2, S.a).returned_reason}"; empty respite "${(empty.err || "ACCEPTED").slice(0, 50)}"; r ${by(l3, S.r).note_status}`);

  // clock
  const CLOCK = "SELECT get_caregiver_clock()";
  const c1 = (await call("cg", CLOCK)).v;
  const dbToday = await day(0), isodow = async (d) => (await q("SELECT extract(isodow FROM $1::date)::int n", [d]))[0].n;
  await db.query("UPDATE virtual_office SET billing_week_start = 7 WHERE id = $1", [OX]);
  const c2 = (await call("cg", CLOCK)).v;
  rec("N5 caregiver clock = the DB clock in the office time zone; the week starts on the office's day (Monday by default, Sunday when set to 7)",
    c1.today === dbToday && c1.timezone === H.TZ && (await isodow(c1.week_start)) === 1 && (await isodow(c2.week_start)) === 7
      && c2.week_start <= dbToday && dbToday <= c2.week_end && c1.first_name === "Gina" && Object.keys(c1).sort().join(",") === "first_name,now,timezone,today,week_end,week_start",
    `today ${c1.today}; week ${c1.week_start}..${c1.week_end} -> ${c2.week_start}..${c2.week_end}`);

  // dual role: a manager who also holds the caregiver role and a caregiver row
  await db.query(`INSERT INTO user_roles (user_id, role, agency_id) VALUES ($1,'caregiver',$2)`, [users.mgrA, A]);
  await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,$3,'Dual','Role',$4,true)`, [nid(), A, users.mgrA, OY]);
  const dual = [await call("mgrA", CLOCK), await call("mgrA", LIST)];
  rec("N6 a dual-role user (manager + caregiver row) reads their own clock and an empty notes list", dual.every((r) => !r.err) && dual[1].v.length === 0, dual.map((r) => r.err || "ok").join(", "));
  const dl = []; let dn = 0;
  for (const w of ["mgrX", "hrX", "schX", "cl", "anon", "sysA", "aaA"]) for (const sql of [CLOCK, LIST]) { const r = await call(w, sql); dn++; if (!r.err || !H.DENY.test(r.err)) dl.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("N7 both reads refused (generic) for users without a caregiver row: manager, hr_staff, scheduler, client, anon, system_admin, agency admin", dl.length === 0, dl.join("; ") || `${dn} refused`);
  const acl = await H.aclCheck(q, ["get_caregiver_clock", "list_my_notes_due", "get_client_training_context", "list_client_training_status"]);
  rec("ACL SECURITY DEFINER + authenticated, no PUBLIC/anon (new and changed functions)", acl.ok, acl.detail);
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });
