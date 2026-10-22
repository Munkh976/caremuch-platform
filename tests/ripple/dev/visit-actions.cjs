// Unassign / Cancel visit / Client no-show + the care-plan office pickup gate (20261031170000) on DEV through real logins.
// `before` (RIPPLE_WRITE_NOBREAK_BASELINE=1): none of the new functions / columns; the two pickup functions are the bodies
//   the rollback restores (md5); NB1 baseline; the PICKUP baseline of a non-module office is saved
//   (baseline/pickup_nonmodule_before.json: clean / soft / hard results and the rows they leave).
// `after` (RIPPLE_NB1_HASHES=1): NB1 identical; the same non-module pickups give byte-identical results; in the care-plan
//   office a caregiver failing the 4a gate is refused; aclexplode; unassign (open again, one shift_unassigned, Outbox row
//   with date and time only), cancel (one shift_cancelled — the shift trigger doesn't add a second — late flag, Unassigned
//   doesn't list it), client no-show (outcome, assignment cancelled not no_show, Weekly Billing list), roles.
// Usage: node tests/ripple/dev/visit-actions.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, fs, path } = require("./lib.cjs");
const DEV = { caregiver_pick_up_shift: "9b22af5a4f25ee586294d2d87a6454fa", caregiver_pickup_trade_shift: "6c9296e33879b21da5a6e9bf238a3a81" };
const NEW = ["preview_visit_action", "unassign_visit", "cancel_visit", "record_client_no_show", "list_client_no_shows", "cp_visit_targets", "cp_visit_action_blocker", "cp_visit_outbox", "cp_visit_action_prepare", "cp_pickup_gate"];
const PICKUP_BASE = path.join(__dirname, "baseline", "pickup_nonmodule_before.json");

const cat = () => pgRead(async (c) => ({
  fns: (await c.query(`SELECT p.proname n, md5(pg_get_functiondef(p.oid)) h, p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...Object.keys(DEV), ...NEW]])).rows,
  cols: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shifts'
    AND column_name IN ('visit_outcome','cancel_reason_code','cancel_reason_text','cancel_requested_by','cancelled_by','cancelled_at','late_cancel')`)).rows[0].n,
}));
const mkShift = async (F, k, start, end, extra = {}) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: extra.office || F.OX, client_id: extra.client || F.CX, order_title: `ZZ ${RUN}`,
  care_type_code: "CLS0001", shift_date: await dbDay(k), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true }); F.b2shifts = (F.b2shifts || []).concat(id); return id; };
const assign = async (F, s) => { const r = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: F.G, _method: "manual", _notes: "visit-actions fixture", _override_reason: "visit-actions fixture (disposable)" });
  if (r.err) throw new Error(`assign: ${r.err}`); };

// The same pickups before and after, in the caregiver's own office WITHOUT the module: clean, soft (outside declared
// availability: accepted by the caregiver's act), hard (overlaps the caregiver's own visit). Results + rows they leave.
async function pickups(F) {
  const res = (r) => r.err ? `ERR ${r.err}` : `OK ${Object.keys(r.v || {}).sort().join(",")}`;
  const clean = await mkShift(F, 20, "09:00", "10:00");
  const soft = await mkShift(F, 21, "09:00", "10:00");
  const busy = await mkShift(F, 22, "09:00", "10:00"); await assign(F, busy);
  const hard = await mkShift(F, 22, "09:30", "10:30");
  const dow = await pgRead(async (c) => (await c.query(`SELECT extract(dow FROM shift_date)::int d FROM public.shifts WHERE id = $1`, [soft])).rows[0].d);
  F.avail = await ins("caregiver_availability", { caregiver_id: F.G, day_of_week: dow, start_time: "06:00", end_time: "07:00", is_available: true });
  const out = { clean: res(await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: clean })), soft: res(await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: soft })),
    hard: res(await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: hard })) };
  const rows = (await admin.from("shifts").select("id, status, shift_assignments(status, assignment_method)").in("id", [clean, soft, hard])).data || [];
  const byId = Object.fromEntries(rows.map((r) => [r.id, `${r.status}/${(r.shift_assignments || []).filter((a) => a.status !== "cancelled").map((a) => a.assignment_method).join("+") || "-"}`]));
  out.rows = [clean, soft, hard].map((id) => byId[id]).join(",");
  return out;
}

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const k = await cat(), api = ["preview_visit_action", "unassign_visit", "cancel_visit", "record_client_no_show", "list_client_no_shows"];
  const okApi = api.every((n) => { const x = k.fns.find((y) => y.n === n); return x && x.d && /authenticated:EXECUTE/.test(x.acl) && !/(^|,)(-|anon):/.test(x.acl); });
  const okInt = NEW.filter((n) => !api.includes(n)).every((n) => { const x = k.fns.find((y) => y.n === n); return x && !/(^|,)(-|anon|authenticated):/.test(x.acl || ""); });
  const pk = Object.keys(DEV).map((n) => k.fns.find((y) => y.n === n));
  rec("ACL (aclexplode): 5 API functions SECURITY DEFINER, authenticated only; 5 helpers no API role; pickup functions: new bodies, same grants; 7 shift columns",
    pass(okApi && okInt && pk.every((x) => x && x.h !== DEV[x.n] && /authenticated:EXECUTE/.test(x.acl)) && k.cols === 7), k.fns.map((x) => `${x.n} ${x.acl}`).join(" | ").slice(0, 500));
  // pickup proof
  const base = JSON.parse(fs.readFileSync(PICKUP_BASE, "utf8")), now = await pickups(F);
  rec("P1 non-module office: the same pickups give byte-identical results and rows as before the push (clean OK, soft accepted, hard refused)",
    pass(JSON.stringify(now) === JSON.stringify(base)), `before ${JSON.stringify(base).slice(0, 200)} | after ${JSON.stringify(now) === JSON.stringify(base) ? "identical" : JSON.stringify(now).slice(0, 200)}`);
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });   // X becomes a care-plan office
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const xs = await mkShift(F, 23, "09:00", "10:00");
  const gate = await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: xs });
  rec("P2 care-plan office: a caregiver failing the 4a gate (client not onboarded) is refused with the caregiver-safe message",
    pass(/meet every requirement/.test(gate.err || "")), (gate.err || "ALLOWED").slice(0, 100));
  // unassign
  const u = await mkShift(F, 24, "09:00", "10:00"); await assign(F, u);
  const deny = [];
  for (const [who, c] of [["mgrY", F.mgrY.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["aaB", F.aaB.c]]) { const r = await rpc(c, "unassign_visit", { _shift_id: u, _reason_code: "schedule_change", _reason_text: null, _following: false, _whole_group: false }); if (r.err && DENY.test(r.err)) deny.push(who); }
  const un = await rpc(F.schX.c, "unassign_visit", { _shift_id: u, _reason_code: "caregiver_unavailable", _reason_text: "Sick this week", _following: false, _whole_group: false });
  const ru = (await admin.from("shifts").select("status, caregiver_id").eq("id", u).single()).data;
  const eu = ((await admin.from("events").select("event_type, payload").eq("subject_id", u)).data || []).filter((e) => e.event_type !== "shift_created" && e.event_type !== "shift_assigned");
  const ob = ((await admin.from("pending_notifications").select("kind, subject, body, payload")).data || []).filter((o) => o.payload && o.payload.shift_id === u);
  rec("U1 other office's manager, HR, caregiver, other agency refused; the scheduler unassigns: open, no caregiver; exactly one shift_unassigned (no reason text); one Outbox row with date and time only",
    pass(deny.length === 4 && !un.err && ru.status === "open" && ru.caregiver_id === null && eu.length === 1 && eu[0].event_type === "shift_unassigned" && !JSON.stringify(eu[0].payload).includes("Sick")
      && ob.length === 1 && ob[0].kind === "visit_unassigned" && / at 9:00 AM/.test(ob[0].body) && !/ZZ|CX|sectest/.test(ob[0].body + ob[0].subject)),
    `refused ${deny.join(",")}; ${un.err || ru.status}; events ${eu.map((e) => e.event_type)}; outbox "${ob[0] && ob[0].body}"`);
  // cancel (late: tomorrow 00:30 is < 24 h away)
  const c = await mkShift(F, 1, "00:30", "01:30"); await assign(F, c);
  const cn = await rpc(F.mgrX.c, "cancel_visit", { _shift_id: c, _requested_by: "client", _reason_code: "client_request", _reason_text: "Family away", _following: false, _whole_group: false });
  const rc = (await admin.from("shifts").select("status, visit_outcome, cancel_requested_by, late_cancel").eq("id", c).single()).data;
  const ec = ((await admin.from("events").select("event_type, payload").eq("subject_id", c)).data || []).filter((e) => e.event_type === "shift_cancelled");
  const unl = await rpc(F.mgrX.c, "propose_auto_assignments", { _office_id: F.OX, _from: await dbDay(0), _to: await dbDay(2) });
  const inUnassigned = [...((unl.v && unl.v.proposals) || []), ...((unl.v && unl.v.blocked) || [])].some((p) => p.shift_id === c);
  rec("C1 cancel: cancelled / outcome cancelled / requested by client / late; exactly ONE shift_cancelled event (the action's, with reason code — the shift trigger adds none); not offered to Auto-assign",
    pass(!cn.err && rc.status === "cancelled" && rc.visit_outcome === "cancelled" && rc.cancel_requested_by === "client" && rc.late_cancel === true && ec.length === 1 && ec[0].payload.reason_code === "client_request" && !unl.err && !inUnassigned),
    `${cn.err || rc.status}; late ${rc.late_cancel}; shift_cancelled events ${ec.length}; in Auto-assign ${inUnassigned}`);
  // no-show yesterday
  const n = await mkShift(F, -1, "09:00", "10:00"); await assign(F, n);
  const ns = await rpc(F.mgrX.c, "record_client_no_show", { _shift_id: n, _reason_text: "Nobody answered", _whole_group: false });
  const rn = (await admin.from("shifts").select("status, visit_outcome").eq("id", n).single()).data;
  const an = ((await admin.from("shift_assignments").select("status").eq("shift_id", n)).data || []).map((a) => a.status);
  const ls = await rpc(F.mgrX.c, "list_client_no_shows", { _office_id: F.OX, _from: await dbDay(-7), _to: await dbDay(0) });
  rec("N1 client no-show yesterday: cancelled with outcome client_no_show; the assignment is cancelled (not no_show); listed for Weekly Billing",
    pass(!ns.err && rn.status === "cancelled" && rn.visit_outcome === "client_no_show" && an.includes("cancelled") && !an.includes("no_show") && !ls.err && ls.v.some((x) => x.shift_id === n)),
    `${ns.err || rn.visit_outcome}; assignments ${an}; list ${ls.err || ls.v.length}`);
}

(async () => {
  log(`=== Visit actions — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const k = await cat();
      rec("B0 before: no new functions or columns; the pickup functions are the bodies the rollback restores (md5)",
        pass(k.cols === 0 && !k.fns.some((x) => NEW.includes(x.n)) && Object.keys(DEV).every((n) => (k.fns.find((x) => x.n === n) || {}).h === DEV[n])), k.fns.map((x) => `${x.n} ${x.h.slice(0, 8)}`).join("; ")); }
    F = await setup(); await setupB1(F);
    F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
    await checkNoBreak(F);
    if (LABEL === "before") { const b = await pickups(F); fs.writeFileSync(PICKUP_BASE, JSON.stringify(b, null, 1));
      rec("PB pickup baseline of a non-module office saved (clean OK, soft OK, hard refused)", pass(/^OK/.test(b.clean) && /^OK/.test(b.soft) && /^ERR/.test(b.hard)), JSON.stringify(b).slice(0, 250)); }
    else await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const s of F.b2shifts || []) { await admin.from("pending_notifications").delete().contains("payload", { shift_id: s }); await admin.from("events").delete().eq("subject_id", s); }
      if (F.avail) await admin.from("caregiver_availability").delete().eq("id", F.avail);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shifts WHERE id = ANY($1::uuid[]))::int shifts,
        (SELECT count(*) FROM public.pending_notifications WHERE payload ->> 'shift_id' = ANY($2::text[]))::int outbox, (SELECT count(*) FROM public.events WHERE subject_id = ANY($1::uuid[]))::int ev`,
        [F.b2shifts || [], (F.b2shifts || []).map(String)])).rows[0]);
      log(`teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
