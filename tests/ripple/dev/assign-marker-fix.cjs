// 4b (20261031200000) on DEV. `before` (RIPPLE_WRITE_NOBREAK_BASELINE=1): protect_assignment_columns is DEV's pre-fix body
// (md5, SECURITY DEFINER) and — in transactions that are always ROLLED BACK — sessions that set the assignment mark
// themselves CAN write directly (the gap): the agency manager as `authenticated` cancels an assignment with an UPDATE
// (authenticated has no INSERT grant on shift_assignments on DEV), `service_role` inserts one. `after`
// (RIPPLE_NB1_HASHES=1): NB1 identical; the function is SECURITY INVOKER with a new body and no API role (aclexplode);
// the same rolled-back attempts are refused; assign / unassign / release through the real API still work.
// Usage: node tests/ripple/dev/assign-marker-fix.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, Client, pgConfig } = require("./lib.cjs");
const PRE = "6619cea407763eadba46818b4c339ad3";
const meta = () => pgRead(async (c) => (await c.query(`SELECT md5(pg_get_functiondef(p.oid)) h, p.prosecdef d,
    (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.oid = 'public.protect_assignment_columns()'::regprocedure`)).rows[0]);

// One direct attempt by an API role that sets the mark itself; ALWAYS rolled back (nothing persists).
//   service_role: INSERT an assignment (it has the table grant);
//   authenticated: the agency manager (JWT subject) cancels an existing assignment with a direct UPDATE (staff have the
//   UPDATE grant and the "Agency staff update operational fields" policy; they have no INSERT grant).
async function attempt(role, sql, params, sub) {
  const c = new Client(pgConfig()); await c.connect(); let err = null;
  try {
    await c.query("BEGIN");
    if (sub) { await c.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub, JSON.stringify({ sub, role: "authenticated" })]); }
    await c.query(`SET LOCAL ROLE ${role === "authenticated" ? "authenticated" : "service_role"}`);
    await c.query("SELECT set_config('caremuch.assignment_ctx', '1', true)");
    const r = await c.query(sql, params); if (r.rowCount === 0) err = "0 rows (not visible to the role)";
  } catch (e) { err = e.message; }
  finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
  return err;
}

(async () => {
  log(`=== Assignment marker fix — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    const m = await meta();
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    const s = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001",
      shift_date: await dbDay(27), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = [s];
    const s2 = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001",
      shift_date: await dbDay(28), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts.push(s2);
    const asg = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: s2, _caregiver_id: F.G, _method: "manual", _notes: null, _override_reason: "marker fixture (disposable)" });
    if (asg.err) throw new Error(`assign fixture: ${asg.err}`);
    const aid = (await admin.from("shift_assignments").select("id").eq("shift_id", s2).neq("status", "cancelled").single()).data.id;
    const a = await attempt("authenticated", `UPDATE public.shift_assignments SET status = 'cancelled' WHERE id = $1`, [aid], F.mgrAll.id);
    const b = await attempt("service_role", `INSERT INTO public.shift_assignments (shift_id, caregiver_id, status, assignment_method) VALUES ($1, $2, 'scheduled', 'manual')`, [s, F.G]);
    const left = (await admin.from("shift_assignments").select("id").eq("shift_id", s)).data || [];
    const still = (await admin.from("shift_assignments").select("status").eq("id", aid).single()).data.status;
    if (LABEL === "before") {
      rec("B0 before: DEV's pre-fix body (md5), SECURITY DEFINER", pass(m.h === PRE && m.d === true), `${m.h.slice(0, 8)} definer ${m.d}`);
      rec("B1 before (rolled back): with the mark set themselves, the manager (authenticated) CAN cancel an assignment directly and service_role CAN insert one (the gap); nothing persisted",
        pass(a === null && b === null && left.length === 0 && still !== "cancelled"), `authenticated update ${a || "ALLOWED"} | service_role insert ${b || "ALLOWED"}; rows ${left.length}; assignment ${still}`);
    } else {
      rec("ACL (aclexplode): new body, SECURITY INVOKER, no API role", pass(m.h !== PRE && m.d === false && !/(^|,)(-|anon|authenticated):/.test(m.acl || "")), `${m.h.slice(0, 8)} definer ${m.d}; ${m.acl}`);
      rec("M1 (rolled back): with the mark set themselves, the manager's direct cancel and service_role's direct insert are refused; nothing persisted",
        pass(/assignment functions/.test(a || "") && /Direct assignment inserts/.test(b || "") && left.length === 0 && still !== "cancelled"), `${(a || "ALLOWED").slice(0, 50)} | ${(b || "ALLOWED").slice(0, 50)}`);
      const as = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: F.G, _method: "manual", _notes: null, _override_reason: "marker fixture (disposable)" });
      const un = await rpc(F.schX.c, "unassign_visit", { _shift_id: s, _reason_code: "schedule_change", _reason_text: null, _following: false, _whole_group: false });
      const as2 = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: F.G, _method: "manual", _notes: null, _override_reason: "marker fixture (disposable)" });
      const rel = await rpc(F.mgrAll.c, "release_shift_assignments", { _shift_ids: [s], _reason: "time off" });
      rec("P1 through the real API: assign, unassign, assign again, release all still work", pass(!as.err && !un.err && !as2.err && !rel.err && rel.v === 1),
        `${as.err || "assign ok"} | ${un.err || "unassign ok"} | ${as2.err || "assign ok"} | release ${rel.err || rel.v}`);
    }
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) { for (const s of F.b2shifts || []) { await admin.from("pending_notifications").delete().contains("payload", { shift_id: s }); await admin.from("events").delete().eq("subject_id", s); } await teardownB2(F); }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shifts WHERE id = ANY($1::uuid[]))::int shifts`, [F.b2shifts || []])).rows[0]);
      log(`teardown re-query: ${JSON.stringify(left)} → ${left.shifts === 0 ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
