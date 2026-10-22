// Unassign / Cancel visit / Client no-show + the care-plan office pickup gate on PGlite: 20261031170000 (owner, Oct 22, B).
// Catalog (additive except the events CHECK and the two approved pickup functions), ACLs; unassign (back to Unassigned,
// own event without reason text, Outbox row with date and time only), cancel (status / outcome / requested by / late flag,
// assignment cancelled, one event), following visits and whole group, the time windows and note rules, roles; the
// no-show (from the start to the end of the next day, not the assignment's no_show, own list); the pickup gate: in a
// non-module office every pickup result is identical before / after the migration (proof), in a care-plan office a
// caregiver failing the 4a gate is refused (self pickup and trade pickup); rollback proof (pickup bodies = DEV md5).
// Usage: node tests/ripple/pglite/visit-actions.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031170000_visit_actions.sql", RB = "visit_actions_rollback.sql";
const DEV = { caregiver_pick_up_shift: "9b22af5a4f25ee586294d2d87a6454fa", caregiver_pickup_trade_shift: "6c9296e33879b21da5a6e9bf238a3a81" };
let seq = 0;

async function world(applyMig) {
  const t = await H.boot(MIG); const { db, q, day, call, must } = t;
  const { A, OX, OY, CX, G } = H;
  // DEV's assignment triggers (the harness loads their functions, not the triggers): the visit's caregiver / status follow
  // its assignments, and cancelling an assignment is only possible through the assignment functions
  await db.exec(`CREATE TRIGGER trg_sync_shift_caregiver AFTER INSERT OR DELETE OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION sync_shift_caregiver_from_assignment();
    CREATE TRIGGER trg_protect_assignment_columns BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION protect_assignment_columns();
    CREATE TRIGGER trg_enforce_derived_shift_caregiver BEFORE INSERT OR UPDATE OF caregiver_id ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_derived_shift_caregiver();`);
  if (applyMig) await H.applyFiles(db, [MIG]);
  await db.query(`UPDATE caregivers SET email = 'gina.test@example.com', is_active = true WHERE id = $1`, [G]);
  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1, 'CLS0001'), ($1, 'RESP0001')`, [G]);
  await db.query(`UPDATE virtual_office SET care_plan_module_enabled = false, compliance_enforcement_enabled = false WHERE id = $1`, [OY]);   // Y: no module
  const CY = H.U(402);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Yara','Fixture',$3)`, [CY, A, OY]);
  const sh = async (office, client, k, start = "09:00", end = "10:00", extra = {}) => { const id = H.U(9600 + ++seq);
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, order_service_id)
      VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,'open',1,$9)`, [id, A, client, extra.code || "CLS0001", await day(k), start, end, office, extra.order || null]); return id; };
  const assign = (s, who = "mgrX") => must(who, "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,NULL,'visit-actions fixture')", [s, G]);
  return { ...t, CY, sh, assign };
}

(async () => {
  const { rec, done } = H.recorder();
  // ---------- pickup proof: the same scenarios before and after the migration ----------
  const pickupRun = async (applyMig) => {
    const w = await world(applyMig); const { db, q, call, sh } = w; const { OX, CX, G } = H;
    const out = {};
    await db.query(`UPDATE virtual_office SET care_plan_module_enabled = false WHERE id = $1`, [OX]);   // the caregiver's office, no module
    const res = (r) => r.err ? `ERR ${r.err}` : `OK ${(r.v && Object.keys(r.v).sort().join(","))}`;
    // non-module office Y: clean, soft (outside declared availability), hard (overlaps an assignment of the caregiver)
    const yClean = await sh(OX, CX, 4, "09:00", "10:00");
    out.y_clean = res(await call("cg", "SELECT caregiver_pick_up_shift($1)", [yClean]));
    await db.query(`INSERT INTO caregiver_availability (caregiver_id, day_of_week, start_time, end_time, is_available) VALUES ($1, (extract(dow FROM (SELECT shift_date FROM shifts WHERE id = $2)))::int, '06:00', '07:00', true)`, [G, yClean]);
    const ySoft = await sh(OX, CX, 4, "12:00", "13:00");
    out.y_soft = res(await call("cg", "SELECT caregiver_pick_up_shift($1)", [ySoft]));
    const yHard = await sh(OX, CX, 4, "09:30", "10:30");
    out.y_hard = res(await call("cg", "SELECT caregiver_pick_up_shift($1)", [yHard]));
    out.y_rows = (await q(`SELECT s.status::text st, a.assignment_method::text m FROM shifts s LEFT JOIN shift_assignments a ON a.shift_id = s.id AND a.status <> 'cancelled'
      WHERE s.id = ANY($1) ORDER BY s.start_time`, [[yClean, ySoft, yHard]])).map((r) => `${r.st}/${r.m}`).join(",");
    // module office X: client not onboarded / caregiver not trained -> fails the 4a gate
    await db.query(`UPDATE virtual_office SET care_plan_module_enabled = true WHERE id = $1`, [OX]);
    const xOpen = await sh(OX, CX, 5, "15:00", "16:00");
    out.x_gate = res(await call("cg", "SELECT caregiver_pick_up_shift($1)", [xOpen]));
    return out;
  };
  const pb = await pickupRun(false), pa = await pickupRun(true);
  rec("P1 non-module office: every pickup result identical before / after (clean OK, soft accepted OK, hard refused) — today's rule unchanged",
    pb.y_clean === pa.y_clean && pb.y_soft === pa.y_soft && pb.y_hard === pa.y_hard && pb.y_rows === pa.y_rows && /^OK/.test(pa.y_clean) && /^OK/.test(pa.y_soft) && /^ERR/.test(pa.y_hard),
    `before ${JSON.stringify(pb).slice(0, 220)} | after same: ${JSON.stringify([pa.y_clean, pa.y_soft, pa.y_hard, pa.y_rows]) === JSON.stringify([pb.y_clean, pb.y_soft, pb.y_hard, pb.y_rows])}`);
  rec("P2 care-plan office: a caregiver failing the 4a gate could pick up before, is refused after (caregiver-safe message)",
    /^OK/.test(pb.x_gate) && /meet every requirement/.test(pa.x_gate), `before ${pb.x_gate.slice(0, 40)}; after ${pa.x_gate.slice(0, 90)}`);

  // ---------- the actions ----------
  const w = await world(false); const { db, q, call, must, sh, assign, day } = w; const { OX, CX, G, A, DENY, users } = H;
  const evVals = async () => [...(await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='events_event_type_check'`))[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  const before = await H.snap(db), ev0 = await evVals();
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db), ev1 = await evVals();
  const removed = before.filter((x) => !after.includes(x)).map((x) => x.split(":").slice(0, 2).join(":"));
  rec("F0 catalog: additive except the events CHECK (63 kept + shift_unassigned, client_no_show) and the bodies of the two pickup functions",
    removed.length === 3 && ["con:events.events_event_type_check", "fn:caregiver_pick_up_shift(uuid)", "fn:caregiver_pickup_trade_shift(uuid)"].every((x) => removed.includes(x))
      && ev0.length === 63 && ev1.length === 65 && ev0.every((v) => ev1.includes(v)), `-${removed.join(", ")}; events ${ev0.length} -> ${ev1.length}`);
  const acl = await H.aclCheck(q, ["preview_visit_action", "unassign_visit", "cancel_visit", "record_client_no_show", "list_client_no_shows",
    "cp_visit_targets", "cp_visit_action_blocker", "cp_visit_outbox", "cp_visit_action_prepare", "cp_pickup_gate"]);
  rec("ACL 5 API functions SECURITY DEFINER, authenticated only; 5 internal helpers no API role", acl.ok, acl.detail);

  const row = async (s) => (await q(`SELECT status::text st, caregiver_id, visit_outcome o, cancel_reason_code rc, cancel_reason_text rt, cancel_requested_by rb, late_cancel lc, cancelled_by cb
    FROM shifts WHERE id = $1`, [s]))[0];
  const asg = async (s) => (await q(`SELECT status::text st, notes FROM shift_assignments WHERE shift_id = $1 ORDER BY created_at`, [s])).map((r) => `${r.st}${r.notes ? ":" + r.notes : ""}`).join(",");
  const evs = async (s) => (await q(`SELECT event_type t, payload p, actor_id a FROM events WHERE subject_id = $1 AND event_type IN ('shift_unassigned','shift_cancelled','client_no_show') ORDER BY occurred_at`, [s]));
  const outbox = async () => (await q(`SELECT kind, subject, body, payload FROM pending_notifications ORDER BY created_at`));
  // U1 unassign
  const u1 = await sh(OX, CX, 6); await assign(u1);
  const r0 = await row(u1);
  const un = await call("schX", "SELECT unassign_visit($1,'caregiver_unavailable','Gina is sick this week',false,false)", [u1]);
  const r1 = await row(u1), e1 = await evs(u1), ob = await outbox();
  rec("U1 the scheduler unassigns: visit back to Unassigned (open, no caregiver), assignment cancelled with the reason; one shift_unassigned event (ids and code, no reason text); Outbox row for the caregiver with date and time only",
    !un.err && r0.caregiver_id === G && r1.st === "open" && r1.caregiver_id === null && (await asg(u1)) === "cancelled:Gina is sick this week"
      && e1.length === 1 && e1[0].t === "shift_unassigned" && e1[0].a === users.schX && e1[0].p.reason_code === "caregiver_unavailable" && e1[0].p.caregiver_id === G && !JSON.stringify(e1[0].p).includes("sick")
      && ob.length === 1 && ob[0].kind === "visit_unassigned" && /visit on \w+, \w+ \d+ at 9:00 AM/.test(ob[0].body) && !/Carla|Fixture/.test(ob[0].body + ob[0].subject),
    `${un.err || JSON.stringify(un.v)}; ${r1.st}; events ${e1.length}; outbox "${ob[0] && ob[0].body}"`);
  // U2 refusals
  const u2 = await sh(OX, CX, 6, "11:00", "12:00"); await assign(u2);
  const started = await sh(OX, CX, -1, "09:00", "10:00"); await assign(started);
  const free = await sh(OX, CX, 7);
  const ref = { noReason: await call("mgrX", "SELECT unassign_visit($1,NULL,NULL,false,false)", [u2]), other: await call("mgrX", "SELECT unassign_visit($1,'other','',false,false)", [u2]),
    started: await call("mgrX", "SELECT unassign_visit($1,'schedule_change',NULL,false,false)", [started]), free: await call("mgrX", "SELECT unassign_visit($1,'schedule_change',NULL,false,false)", [free]) };
  const deny = [];
  for (const who of ["mgrY", "hrX", "cg", "cl", "aaB", "anon"]) { const r = await call(who, "SELECT unassign_visit($1,'schedule_change',NULL,false,false)", [u2]); if (r.err && DENY.test(r.err)) deny.push(who); else console.log(`  not refused: ${who} ${r.err || "ok"}`); }
  rec("U2 refused: no reason, 'other' without text, a started visit, a visit with no caregiver; other office's manager, HR, caregiver, client, other agency, anon refused (generic)",
    /Choose a reason/.test(ref.noReason.err || "") && /Describe the reason/.test(ref.other.err || "") && /has started/.test(ref.started.err || "") && /no caregiver/.test(ref.free.err || "") && deny.length === 6
      && (await row(u2)).caregiver_id === G, `${Object.values(ref).map((r) => (r.err || "ALLOWED").slice(0, 35)).join(" | ")}; refused ${deny.join(",")}`);
  // U3 following: a weekly series (same client, service, weekday, times) — from the 2nd visit on
  const ser = []; for (const k of [8, 15, 22]) { const s = await sh(OX, CX, k, "14:00", "15:00"); await assign(s); ser.push(s); }
  const pv = await call("mgrX", "SELECT preview_visit_action($1,'unassign',true,false)", [ser[1]]);
  const uf = await call("mgrX", "SELECT unassign_visit($1,'schedule_change',NULL,true,false)", [ser[1]]);
  const st3 = await Promise.all(ser.map(async (s) => (await row(s)).caregiver_id === G ? "kept" : "off"));
  rec("U3 'this and following': the preview lists the 2 visits; the 2nd and 3rd of the series are unassigned, the 1st kept",
    !uf.err && pv.v.visits.length === 2 && pv.v.visits.every((v) => v.blocker === null) && uf.v.visits === 2 && st3.join(",") === "kept,off,off", `${uf.err || JSON.stringify(uf.v.visits)}; ${st3}`);

  // C1 cancel (client request): late (< 24 h) and not late
  const late = await sh(OX, CX, 1, "00:30", "01:30"); await assign(late);
  const later = await sh(OX, CX, 9, "09:00", "10:00"); await assign(later);
  const c1 = await call("mgrX", "SELECT cancel_visit($1,'client','client_request','Family travelling',false,false)", [late]);
  const c2 = await call("aaA", "SELECT cancel_visit($1,'agency','schedule_change',NULL,false,false)", [later]);
  const rl = await row(late), rr = await row(later), el = await evs(late), ob2 = (await outbox()).filter((o) => o.kind === "visit_cancelled");
  const badBy = await call("mgrX", "SELECT cancel_visit($1,NULL,'schedule_change',NULL,false,false)", [u2]);
  rec("C1 cancel: status cancelled, outcome cancelled, requested by client, reason kept on the visit, late flag (< 24 h) true / false, assignment cancelled; one shift_cancelled event (code, requested by, late; no text); Outbox 'cancelled' rows; who-asked required",
    !c1.err && !c2.err && rl.st === "cancelled" && rl.o === "cancelled" && rl.rb === "client" && rl.rc === "client_request" && rl.rt === "Family travelling" && rl.lc === true && rl.cb === users.mgrX
      && rr.lc === false && rr.rb === "agency" && (await asg(late)) === "cancelled" && el.length === 1 && el[0].p.late_cancel === true && el[0].p.requested_by === "client" && !JSON.stringify(el[0].p).includes("travelling")
      && ob2.length === 2 && /was cancelled/.test(ob2[0].body) && /who asked/.test(badBy.err || ""),
    `${c1.err || c2.err || "ok"}; late ${rl.lc}/${rr.lc}; events ${el.length}; outbox ${ob2.length}; ${(badBy.err || "").slice(0, 30)}`);
  const unl = await q(`SELECT count(*)::int n FROM shifts WHERE id = ANY($1) AND status::text = 'open'`, [[late, later]]);
  const again = await call("mgrX", "SELECT unassign_visit($1,'schedule_change',NULL,false,false)", [late]);
  rec("C2 a cancelled visit is not in Unassigned (not open) and can't be changed again", unl[0].n === 0 && /already cancelled/.test(again.err || ""), (again.err || "ALLOWED").slice(0, 50));
  // C3 group: whole group; following + group refused
  const C2 = H.U(403); await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Gus','Fixture',$3)`, [C2, A, OX]);
  const gs = await must("mgrX", "SELECT create_group_session($1,$2::date,'10:00','11:00','1:2',2::smallint)", [OX, await day(10)]);
  const g1 = await sh(OX, CX, 10, "10:00", "11:00"), g2 = await sh(OX, C2, 10, "10:00", "11:00");
  for (const s of [g1, g2]) await must("mgrX", "SELECT set_shift_group_session($1,$2)", [s, gs]);
  const both = await call("mgrX", "SELECT cancel_visit($1,'agency','schedule_change',NULL,true,true)", [g1]);
  const gp = await call("mgrX", "SELECT preview_visit_action($1,'cancel',false,true)", [g1]);
  const gc = await call("mgrX", "SELECT cancel_visit($1,'agency','schedule_change',NULL,false,true)", [g1]);
  rec("C3 group: 'whole group' cancels both clients' visits (preview 2); following + whole group together refused",
    /not both/.test(both.err || "") && gp.v.visits.length === 2 && !gc.err && gc.v.visits === 2 && (await row(g2)).st === "cancelled", `${(both.err || "").slice(0, 30)}; ${gc.err || gc.v.visits}`);

  // N1 no-show
  const nsFuture = await sh(OX, CX, 3); await assign(nsFuture);
  const nsOld = await sh(OX, CX, -3); await assign(nsOld);
  const nf = await call("mgrX", "SELECT record_client_no_show($1,'Nobody home',false)", [nsFuture]);
  const no = await call("mgrX", "SELECT record_client_no_show($1,'Nobody home',false)", [nsOld]);
  const nNo = await call("mgrX", "SELECT record_client_no_show($1,'',false)", [started]);
  const ns = await call("mgrX", "SELECT record_client_no_show($1,'Nobody answered the door',false)", [started]);
  const rn = await row(started), en = await evs(started);
  rec("N1 no-show: refused before the start and after the end of the next day, and without a description; yesterday's visit: cancelled with outcome client_no_show, the assignment cancelled (NOT the assignment's no_show), event client_no_show (no text), no Outbox row",
    /from the visit's start/.test(nf.err || "") && /too late/.test(no.err || "") && /Describe/.test(nNo.err || "") && !ns.err && rn.st === "cancelled" && rn.o === "client_no_show"
      && (await asg(started)) === "cancelled" && en.length === 1 && en[0].t === "client_no_show" && !JSON.stringify(en[0].p).includes("door")
      && (await outbox()).filter((o) => o.payload && o.payload.shift_id === started).length === 0,
    `${(nf.err || "").slice(0, 30)} | ${(no.err || "").slice(0, 30)} | ${ns.err || "ok"}; ${rn.o}; ${await asg(started)}`);
  const ls = await call("mgrX", "SELECT list_client_no_shows($1,$2::date,$3::date)", [OX, await day(-7), await day(7)]);
  const lsHr = await call("hrX", "SELECT list_client_no_shows($1,$2::date,$3::date)", [OX, await day(-7), await day(7)]);
  rec("N2 Weekly Billing's no-show list shows it (client first name + initial, caregiver, recorded by); HR refused",
    !ls.err && ls.v.length === 1 && ls.v[0].client_last_initial === "F" && ls.v[0].caregiver_name === "Gina Test" && ls.v[0].recorded_by_name === "Manager X" && DENY.test(lsHr.err || ""),
    `${ls.err || JSON.stringify(ls.v[0]).slice(0, 160)}; HR ${(lsHr.err || "ALLOWED").slice(0, 25)}`);
  // N3 notes: a draft refuses with the message; a submitted note refuses
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(300) }), "{}"]);
  const nd = await sh(OX, CX, -1, "13:00", "14:00"); await assign(nd);
  const note = await must("cg", "SELECT create_progress_note_for_shift($1)", [nd]);
  const dr = await call("mgrX", "SELECT record_client_no_show($1,'Nobody home',false)", [nd]);
  const rq = (await q("SELECT scheduled_start, scheduled_end FROM progress_notes WHERE id = $1", [note]))[0];
  await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [note, JSON.stringify({ client_arrived_at: new Date(rq.scheduled_start).toISOString(), actual_end: new Date(rq.scheduled_end).toISOString() })]);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [note]);
  const sb = await call("mgrX", "SELECT record_client_no_show($1,'Nobody home',false)", [nd]);
  rec("N3 a draft note refuses with the message (void it first); a submitted note refuses", /started its progress note/.test(dr.err || "") && /already submitted/.test(sb.err || ""), `${(dr.err || "").slice(0, 60)} | ${(sb.err || "").slice(0, 50)}`);

  // T1 trade pickup in the care-plan office: a caregiver failing the gate is refused
  const users2 = H.U(9590), G2 = H.U(9591);
  await db.query(`INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES ($1,$2,$3,false,'CG2')`, [users2, A, OX]);
  await db.query(`INSERT INTO user_roles (user_id, role, agency_id) VALUES ($1,'caregiver',$2)`, [users2, A]);
  await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, virtual_office_id, is_active) VALUES ($1,$2,$3,'Gil',$4,true)`, [G2, A, users2, OX]);
  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1, 'CLS0001')`, [G2]);   // qualified: only the 4a gate fails
  const tShift = await sh(OX, CX, 12, "16:00", "17:00"); await assign(tShift);
  const aId = (await q(`SELECT id FROM shift_assignments WHERE shift_id = $1 AND status <> 'cancelled'`, [tShift]))[0].id;
  const tId = (await q(`INSERT INTO shift_trades (shift_assignment_id, original_caregiver_id, status, shift_id) VALUES ($1,$2,'pending',$3) RETURNING id`, [aId, G, tShift]))[0].id;
  await db.exec("BEGIN"); await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users2]);
  let tr; try { tr = { v: (await db.query("SELECT caregiver_pickup_trade_shift($1) v", [tId])).rows[0].v }; await db.exec("COMMIT"); } catch (e) { await db.exec("ROLLBACK"); tr = { err: e.message }; }
  rec("T1 trade pickup in the care-plan office by a caregiver failing the gate: refused (trade stays pending)",
    /meet every requirement/.test(tr.err || "") && (await q(`SELECT status FROM shift_trades WHERE id = $1`, [tId]))[0].status === "pending", (tr.err || JSON.stringify(tr.v)).slice(0, 90));

  // RB rollback proof (fresh database)
  const { db: d2 } = await H.bootSchema(MIG);
  const defs = async () => Object.fromEntries((await d2.query(`SELECT proname n, md5(pg_get_functiondef(oid)) h FROM pg_proc WHERE proname = ANY($1)`, [Object.keys(DEV)])).rows.map((r) => [r.n, r.h]));
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(d2), d0 = await defs();
  await H.applyFiles(d2, [MIG]); const s1 = await H.snap(d2);
  await d2.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'client_no_show','staff','shift','{}')`, [A]);
  let blocked = null; try { await H.applyRollback(d2, RB); } catch (e) { blocked = e.message; }
  const sB = await H.snap(d2);
  await d2.query(`DELETE FROM events WHERE event_type = 'client_no_show'`);
  await H.applyRollback(d2, RB); const s2 = await H.snap(d2), d3 = await defs();
  await H.applyFiles(d2, [MIG]); const s4 = await H.snap(d2);
  rec("RB rollback stops while events exist (nothing changed); catalog = before; the pickup bodies = before and = DEV before the push (md5); re-apply = first apply",
    /visit action events exist/.test(blocked || "") && diff(s1, sB).length === 0 && diff(s0, s2).length === 0 && Object.keys(DEV).every((k) => d3[k] === d0[k] && d3[k] === DEV[k]) && diff(s1, s4).length === 0,
    `${(blocked || "NOT BLOCKED").slice(0, 30)}; ${diff(s0, s2).slice(0, 2).join(" ; ") || "identical"}; ${Object.keys(DEV).map((k) => `${k.slice(10, 22)} ${d3[k].slice(0, 8)}/${DEV[k].slice(0, 8)}`).join(", ")}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });
