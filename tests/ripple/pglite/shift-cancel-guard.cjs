// 3b on PGlite: 20261031190000 (owner, Oct 23). A direct INSERT / UPDATE that cancels a visit, reopens a cancelled one
// or writes the cancellation record is refused — for the API role and for the database owner alike; the two actions
// (cancel_visit, record_client_no_show) still work with a reason and are refused without one; ordinary updates
// (times, assignment, unassign, release, the caregiver_id sync on a cancelled visit) are unchanged; ACL; rollback proof.
// Usage: node tests/ripple/pglite/shift-cancel-guard.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031190000_shift_cancel_guard.sql", RB = "shift_cancel_guard_rollback.sql";
// rule-16 fix (owner check 2a): the mark is honoured only outside the API roles
const FIX = "20261031190100_shift_cancel_guard_marker.sql", RB_FIX = "shift_cancel_guard_marker_rollback.sql";
const DEV_PUSHED = "dc032c76cfd3bc6ab73349daa34413e7";   // md5(pg_get_functiondef) of cp_guard_shift_cancel on DEV as pushed in 20261031190000
let seq = 0;

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, day, call, must } = t;
  const { A, OX, CX, G, DENY } = H;
  // DEV's assignment triggers (the harness loads their functions only)
  await db.exec(`CREATE TRIGGER trg_sync_shift_caregiver AFTER INSERT OR DELETE OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION sync_shift_caregiver_from_assignment();
    CREATE TRIGGER trg_protect_assignment_columns BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION protect_assignment_columns();
    CREATE TRIGGER trg_enforce_derived_shift_caregiver BEFORE INSERT OR UPDATE OF caregiver_id ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_derived_shift_caregiver();`);
  await db.query(`UPDATE caregivers SET email = 'gina.test@example.com', is_active = true WHERE id = $1`, [G]);
  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1, 'CLS0001')`, [G]);
  const sh = async (k, start = "09:00", end = "10:00", status = "open") => { const id = H.U(9400 + ++seq);
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5,$6,$7,$8,1)`, [id, A, CX, await day(k), start, end, OX, status]); return id; };
  const assign = (s) => must("mgrX", "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,NULL,'guard fixture')", [s, G]);
  const tryDb = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };
  const row = async (s) => (await q(`SELECT status::text st, visit_outcome o, caregiver_id FROM shifts WHERE id = $1`, [s]))[0];

  const before = await H.snap(db);
  await H.applyFiles(db, [MIG, FIX]);
  const after = await H.snap(db);
  const removed = before.filter((x) => !after.includes(x)), added = after.filter((x) => !before.includes(x)).map((x) => x.slice(0, 60));
  rec("F0 catalog additive (with the fix): one trigger function + one trigger on shifts, nothing removed",
    removed.length === 0 && added.length === 2 && added.some((x) => x.startsWith("fn:cp_guard_shift_cancel()")) && added.some((x) => /trg_cp_guard_shift_cancel/.test(x)), `+${added.join(" | ")}`);
  const acl = await H.aclCheck(q, ["cp_guard_shift_cancel"]);
  rec("ACL trigger function: no API role (aclexplode)", acl.ok, acl.detail);

  // T1 direct cancels refused — as the API role (the manager, under the staff policy) and as the database owner
  const s1 = await sh(5); await assign(s1);
  const apiCancel = await call("mgrX", "UPDATE shifts SET status = 'cancelled' WHERE id = $1", [s1]);
  const ownerCancel = await tryDb(`UPDATE shifts SET status = 'cancelled' WHERE id = $1`, [s1]);
  const ownerOutcome = await tryDb(`UPDATE shifts SET status = 'cancelled', visit_outcome = 'cancelled', cancel_reason_code = 'other', cancel_reason_text = 'x' WHERE id = $1`, [s1]);
  const insCancel = await tryDb(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
    VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'cancelled',1)`, [H.U(9499), A, CX, await day(6), OX]);
  rec("T1 a direct cancel is refused for the API role and the database owner, with or without outcome fields; inserting a cancelled visit is refused; the visit is unchanged",
    /Cancel visit or Client no-show/.test(apiCancel.err || "") && /Cancel visit or Client no-show/.test(ownerCancel || "") && /Cancel visit or Client no-show/.test(ownerOutcome || "")
      && /Cancel visit or Client no-show/.test(insCancel || "") && (await row(s1)).st === "assigned",
    `${(apiCancel.err || "ALLOWED").slice(0, 40)} | ${(ownerCancel || "ALLOWED").slice(0, 30)} | insert ${(insCancel || "ALLOWED").slice(0, 30)}`);

  // T2 the actions: refused without a reason, succeed with one
  const noReason = await call("mgrX", "SELECT cancel_visit($1,'client',NULL,NULL,false,false)", [s1]);
  const ok = await call("mgrX", "SELECT cancel_visit($1,'client','client_request','Family away',false,false)", [s1]);
  const s2 = await sh(-1); await assign(s2);
  const nsNo = await call("mgrX", "SELECT record_client_no_show($1,'',false)", [s2]);
  const ns = await call("mgrX", "SELECT record_client_no_show($1,'Nobody answered',false)", [s2]);
  const r1 = await row(s1), r2 = await row(s2);
  rec("T2 Cancel visit and Client no-show: refused without a reason, succeed with one (cancelled / client_no_show)",
    /Choose a reason/.test(noReason.err || "") && !ok.err && r1.st === "cancelled" && r1.o === "cancelled" && /Describe the reason/.test(nsNo.err || "") && !ns.err && r2.o === "client_no_show",
    `${(noReason.err || "").slice(0, 20)} | ${ok.err || r1.o} | ${(nsNo.err || "").slice(0, 20)} | ${ns.err || r2.o}`);

  // T3 a cancelled visit can't be reopened or have its record edited directly
  const reopen = await tryDb(`UPDATE shifts SET status = 'open' WHERE id = $1`, [s1]);
  const edit = await tryDb(`UPDATE shifts SET cancel_reason_text = 'changed' WHERE id = $1`, [s1]);
  const editApi = await call("mgrX", "UPDATE shifts SET visit_outcome = NULL WHERE id = $1", [s1]);
  rec("T3 reopening a cancelled visit and editing its cancellation record directly are refused (owner and API)",
    /reopened/.test(reopen || "") && /written by Cancel visit/.test(edit || "") && /written by Cancel visit/.test(editApi.err || "") && (await row(s1)).st === "cancelled",
    `${(reopen || "ALLOWED").slice(0, 30)} | ${(edit || "ALLOWED").slice(0, 30)} | ${(editApi.err || "ALLOWED").slice(0, 30)}`);

  // M1 the bypass mark can't be set by an API role itself (owner check 2a): set_config then a direct cancel, as the
  // authenticated role (the manager) and as service_role — both refused; the visit is unchanged
  const m1 = await sh(9); await assign(m1);
  const asRole = async (role) => { await db.exec("BEGIN"); let r = null;
    try { await db.exec(`SET LOCAL ROLE ${role}`); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [H.users.mgrX]);
      await db.query("SELECT set_config('caremuch.assignment_ctx', '1', true)");
      await db.query(`UPDATE shifts SET status = 'cancelled', visit_outcome = 'cancelled', cancel_reason_code = 'other', cancel_reason_text = 'x' WHERE id = $1`, [m1]);
    } catch (e) { r = e.message; } await db.exec("ROLLBACK"); return r; };
  const mAuth = await asRole("authenticated"), mSvc = await asRole("service_role");
  rec("M1 an API role that sets the mark itself (set_config) and cancels directly is refused — authenticated and service_role; the visit is unchanged",
    /Cancel visit or Client no-show/.test(mAuth || "") && /Cancel visit or Client no-show/.test(mSvc || "") && (await row(m1)).st === "assigned",
    `authenticated ${(mAuth || "ALLOWED").slice(0, 40)} | service_role ${(mSvc || "ALLOWED").slice(0, 40)}`);

  // T4 ordinary paths unchanged
  const s3 = await sh(7); await assign(s3);
  const times = await tryDb(`UPDATE shifts SET start_time = '09:30', end_time = '10:30' WHERE id = $1`, [s3]);
  const un = await call("schX", "SELECT unassign_visit($1,'schedule_change',NULL,false,false)", [s3]);
  await assign(s3);
  const rel = await call("mgrX", "SELECT release_shift_assignments($1::uuid[], 'time off')", [[s3]]);
  const del = await tryDb(`DELETE FROM shifts WHERE id = $1`, [await sh(8)]);
  rec("T4 unchanged: editing times, assign, unassign (back to open), release_shift_assignments, deleting a visit",
    times === null && !un.err && (await row(s3)).st === "open" && !rel.err && rel.v === 1 && del === null, `${times || "times ok"} | ${un.err || "unassign ok"} | release ${rel.err || rel.v} | delete ${del || "ok"}`);

  // RB rollback proof (fresh database)
  const { db: d2 } = await H.bootSchema(MIG);
  const s0 = await H.snap(d2); await H.applyFiles(d2, [MIG]); const sA = await H.snap(d2);
  await H.applyRollback(d2, RB); const sR = await H.snap(d2); await H.applyFiles(d2, [MIG]); const sB = await H.snap(d2);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  rec("RB rollback: catalog = before (every existing function body unchanged); re-apply = first apply", same(s0, sR) && same(sA, sB), `${same(s0, sR)} / ${same(sA, sB)}`);
  // RB2 the fix's rollback restores the body pushed in 20261031190000 byte-identically (md5 = DEV before the fix)
  const md5 = async () => (await d2.query(`SELECT md5(pg_get_functiondef('public.cp_guard_shift_cancel()'::regprocedure)) h`)).rows[0].h;
  const pushed = await md5(); await H.applyFiles(d2, [FIX]); const fixed = await md5(); await H.applyRollback(d2, RB_FIX); const back = await md5();
  rec("RB2 the fix's rollback restores the pushed body byte-identically (md5 = before the fix = DEV)", pushed === DEV_PUSHED && fixed !== pushed && back === pushed,
    `pushed ${pushed.slice(0, 8)} (DEV ${DEV_PUSHED.slice(0, 8)}) -> fixed ${fixed.slice(0, 8)} -> back ${back.slice(0, 8)}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });
