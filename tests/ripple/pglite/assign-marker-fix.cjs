// 4b on PGlite: 20261031200000 (owner, Oct 23). protect_assignment_columns honours the assignment mark only outside the
// API roles and runs as SECURITY INVOKER. Before: an authenticated / service_role session that sets the mark itself could
// insert an assignment directly (shown); after: refused. Every assignment path still works (assign, release, pickup,
// unassign, cancel, no-show), a direct owner session with the mark still works, and direct writes without the mark are
// refused as before. The rollback restores DEV's body byte-identically (md5, CRLF line ends included).
// Usage: node tests/ripple/pglite/assign-marker-fix.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031200000_assign_marker_fix.sql", RB = "assign_marker_fix_rollback.sql";
const DEV = "6619cea407763eadba46818b4c339ad3";   // md5(pg_get_functiondef) of protect_assignment_columns on DEV before the fix
let seq = 0;

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, day, call, must } = t;
  const { A, OX, CX, G, users } = H;
  // DEV's assignment triggers (the harness loads their functions only) and DEV's exact body of the function (CRLF)
  await db.exec(`CREATE TRIGGER trg_sync_shift_caregiver AFTER INSERT OR DELETE OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION sync_shift_caregiver_from_assignment();
    CREATE TRIGGER trg_protect_assignment_columns BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION protect_assignment_columns();
    CREATE TRIGGER trg_enforce_derived_shift_caregiver BEFORE INSERT OR UPDATE OF caregiver_id ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_derived_shift_caregiver();`);
  await H.applyRollback(db, RB);   // installs the pre-fix body exactly as on DEV
  const md5 = async () => (await q(`SELECT md5(pg_get_functiondef('public.protect_assignment_columns()'::regprocedure)) h, prosecdef d FROM pg_proc WHERE oid = 'public.protect_assignment_columns()'::regprocedure`))[0];
  const pre = await md5();
  rec("B0 the pre-fix body is DEV's (md5) and SECURITY DEFINER", pre.h === DEV && pre.d === true, `${pre.h.slice(0, 8)} definer ${pre.d}`);
  await db.query(`UPDATE caregivers SET email = 'gina.test@example.com', is_active = true WHERE id = $1`, [G]);
  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1, 'CLS0001')`, [G]);
  await db.query(`UPDATE virtual_office SET care_plan_module_enabled = false WHERE id = $1`, [OX]);   // pickups under today's rule
  const sh = async (k, start = "09:00", end = "10:00") => { const id = H.U(9300 + ++seq);
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5,$6,$7,'open',1)`, [id, A, CX, await day(k), start, end, OX]); return id; };
  const asRole = async (role, sql, p) => { await db.exec("BEGIN"); let r = null;
    try { await db.exec(`SET LOCAL ROLE ${role}`); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users.mgrX]);
      await db.query("SELECT set_config('caremuch.assignment_ctx', '1', true)"); await db.query(sql, p);
    } catch (e) { r = e.message; } await db.exec("ROLLBACK"); return r; };
  const INS = `INSERT INTO shift_assignments (shift_id, caregiver_id, status, assignment_method) VALUES ($1, $2, 'scheduled', 'manual')`;
  const b1 = await sh(5);
  const beforeAuth = await asRole("authenticated", INS, [b1, G]), beforeSvc = await asRole("service_role", INS, [b1, G]);
  rec("B1 before the fix: an authenticated / service_role session that sets the mark itself CAN insert an assignment directly (the gap)",
    beforeAuth === null && beforeSvc === null, `authenticated ${beforeAuth || "ALLOWED"} | service_role ${beforeSvc || "ALLOWED"}`);

  const before = await H.snap(db);
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db);
  const removed = before.filter((x) => !after.includes(x)).map((x) => x.split(":").slice(0, 2).join(":"));
  const post = await md5();
  rec("F0 only protect_assignment_columns changed (body, now SECURITY INVOKER); no API role; the trigger unchanged",
    removed.length === 1 && removed[0] === "fn:protect_assignment_columns()" && post.d === false && (await H.aclCheck(q, ["protect_assignment_columns"])).ok === false
      && !(await q(`SELECT COALESCE(proacl::text,'') a FROM pg_proc WHERE proname = 'protect_assignment_columns'`))[0].a.match(/(^|[{,])(anon|authenticated)=/),
    `-${removed.join(", ")}; definer ${post.d}`);

  const m1 = await sh(6);
  const aIns = await asRole("authenticated", INS, [m1, G]), sIns = await asRole("service_role", INS, [m1, G]);
  await must("mgrX", "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,NULL,'fixture')", [m1, G]);
  const aId = (await q(`SELECT id FROM shift_assignments WHERE shift_id = $1 AND status <> 'cancelled'`, [m1]))[0].id;
  const aCancel = await asRole("authenticated", `UPDATE shift_assignments SET status = 'cancelled' WHERE id = $1`, [aId]);
  const aOverride = await asRole("authenticated", `UPDATE shift_assignments SET override_reason = 'self' WHERE id = $1`, [aId]);
  rec("M1 after: an API role that sets the mark itself is refused — direct insert (authenticated, service_role), cancel and override fields (authenticated)",
    /Direct assignment inserts/.test(aIns || "") && /Direct assignment inserts/.test(sIns || "") && /assignment functions/.test(aCancel || "") && /Override fields/.test(aOverride || ""),
    `${(aIns || "ALLOWED").slice(0, 30)} | ${(sIns || "ALLOWED").slice(0, 30)} | ${(aCancel || "ALLOWED").slice(0, 30)} | ${(aOverride || "ALLOWED").slice(0, 30)}`);

  // P1 every assignment path still works
  const p = {};
  const s1 = await sh(7); p.assign = (await call("mgrX", "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,NULL,'fixture')", [s1, G])).err || "ok";
  p.release = (await call("mgrX", "SELECT release_shift_assignments($1::uuid[], 'time off')", [[s1]])).err || "ok";
  const s2 = await sh(8); p.pickup = (await call("cg", "SELECT caregiver_pick_up_shift($1)", [s2])).err || "ok";
  p.unassign = (await call("schX", "SELECT unassign_visit($1,'schedule_change',NULL,false,false)", [s2])).err || "ok";
  const s3 = await sh(9); await must("mgrX", "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,NULL,'fixture')", [s3, G]);
  p.cancel = (await call("mgrX", "SELECT cancel_visit($1,'client','client_request','Family away',false,false)", [s3])).err || "ok";
  const s4 = await sh(-1); await must("mgrX", "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,NULL,'fixture')", [s4, G]);
  p.noshow = (await call("mgrX", "SELECT record_client_no_show($1,'Nobody home',false)", [s4])).err || "ok";
  const rows = (await q(`SELECT s.id, s.status::text st, a.status::text ast FROM shifts s LEFT JOIN shift_assignments a ON a.shift_id = s.id WHERE s.id = ANY($1) ORDER BY s.shift_date`, [[s1, s2, s3, s4]]));
  rec("P1 assign, release, pickup, unassign, cancel and client no-show all still work",
    Object.values(p).every((v) => v === "ok"), JSON.stringify(p));
  // P2 a direct owner session with the mark still works (the explicit fixture path); without the mark direct writes are refused
  const s5 = await sh(10);
  await db.exec("BEGIN"); let own = null; try { await db.query("SELECT set_config('caremuch.assignment_ctx', '1', true)"); await db.query(INS, [s5, G]); await db.exec("COMMIT"); } catch (e) { own = e.message; await db.exec("ROLLBACK"); }
  const s6 = await sh(11);
  let noMark = null; try { await db.query(INS, [s6, G]); } catch (e) { noMark = e.message; }
  rec("P2 a direct owner session with the mark can still write (test fixtures); without the mark a direct insert is refused as before",
    own === null && /Direct assignment inserts/.test(noMark || ""), `owner ${own || "ok"} | no mark ${(noMark || "ALLOWED").slice(0, 40)}`);

  // RB the rollback restores DEV's body byte-identically
  await H.applyRollback(db, RB); const back = await md5();
  const sB = await H.snap(db), diff = before.filter((x) => !sB.includes(x)).concat(sB.filter((x) => !before.includes(x)));
  rec("RB rollback: protect_assignment_columns = DEV's body (md5, SECURITY DEFINER), catalog = before",
    back.h === DEV && back.d === true && diff.length === 0, `${back.h.slice(0, 8)} definer ${back.d}; diff ${diff.length}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });
