// Security hotfix on PGlite: 20261030110000. Catalog (2 bodies + 2 new functions + log_event's grants), ACLs, the
// eligibility caller check (staff in scope and the caregiver about themselves allowed with byte-identical results;
// other office / agency / client / anon / a caregiver about someone else refused; the caregiver-facing
// check_caregiver_shifts_eligibility unchanged), match_caregiver_scope (manager / scheduler / agency_admin in scope
// only), log_event no longer executable by PUBLIC / anon / authenticated.
// Usage: node tests/ripple/pglite/hotfix.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261030110000_hotfix_caller_checks.sql";

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, call } = t;
  const { CX, G, OX, A, TZ } = H;
  const at = async (k) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [k]))[0].d;
  const G2 = H.U(331);
  await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,'Other','Carer',$3,true)`, [G2, A, OX]);
  const S = H.U(9801);
  await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
    VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'open',1)`, [S, A, CX, await at(5), OX]);
  const one = (who, g) => call(who, "SELECT check_assignment_eligibility($1,$2)", [S, g]);
  const bulk = (who, ids) => call(who, "SELECT jsonb_agg(jsonb_build_object('c', caregiver_id, 'r', result) ORDER BY caregiver_id) FROM check_assignment_eligibility_bulk($1,$2::uuid[])", [S, ids]);
  const mine = (who) => call(who, "SELECT jsonb_agg(jsonb_build_object('s', shift_id, 'r', result)) FROM check_caregiver_shifts_eligibility($1::uuid[])", [[S]]);
  // before
  const b = { mgr: await one("mgrX", G), sch: await one("schX", G), hr: await one("hrX", G), cg: await one("cg", G), bulk: await bulk("mgrX", [G, G2]), mine: await mine("cg") };
  const fn = async () => q(`SELECT proname n, md5(prosrc) h, pg_get_function_identity_arguments(oid) a, COALESCE(proacl::text,'') acl FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('check_assignment_eligibility','check_assignment_eligibility_bulk','log_event') ORDER BY 1`);
  const s0 = await H.snap(db), f0 = await fn();
  await H.applyFiles(db, [MIG]);
  const s1 = await H.snap(db), f1 = await fn();
  const removed = s0.filter((x) => !s1.includes(x)), added = s1.filter((x) => !s0.includes(x));
  rec("F0 catalog: only the two eligibility bodies (same arguments) and log_event's grants change; new: cp_eligibility_caller_ok, match_caregiver_scope",
    removed.length === 3 && removed.every((x) => /^fn:(check_assignment_eligibility|check_assignment_eligibility_bulk|log_event)\(/.test(x))
      && added.length === 5 && added.some((x) => x.startsWith("fn:match_caregiver_scope(")) && added.some((x) => x.startsWith("fn:cp_eligibility_caller_ok("))
      && f1.filter((x) => x.n !== "log_event").every((x) => x.a === f0.find((y) => y.n === x.n).a && x.h !== f0.find((y) => y.n === x.n).h)
      && f1.find((x) => x.n === "log_event").h === f0.find((x) => x.n === "log_event").h,
    `-${removed.map((x) => x.split("(")[0]).join(",")} +${added.map((x) => x.split("(")[0]).join(",")}`);
  const acl = await H.aclCheck(q, ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "match_caregiver_scope", "cp_eligibility_caller_ok"]);
  const le = f1.find((x) => x.n === "log_event").acl;
  rec("ACL eligibility + match_caregiver_scope: SECURITY DEFINER, authenticated only; cp_eligibility_caller_ok: no API role; log_event: service_role only (no PUBLIC / anon / authenticated)",
    acl.ok && /service_role=X/.test(le) && !/(^|[{,])=X|anon=X|authenticated=X/.test(le), `${acl.detail}; log_event ${le}`);
  // after
  const a = { mgr: await one("mgrX", G), sch: await one("schX", G), hr: await one("hrX", G), cg: await one("cg", G), bulk: await bulk("mgrX", [G, G2]), mine: await mine("cg") };
  const same = ["mgr", "sch", "hr", "cg", "bulk", "mine"].filter((k) => !b[k].err && JSON.stringify(a[k].v) === JSON.stringify(b[k].v));
  rec("E1 allowed callers get byte-identical results: manager, scheduler and HR of the office, the caregiver about themselves (single and via check_caregiver_shifts_eligibility), bulk for staff",
    same.length === 6, `identical ${same.join(",")}`);
  const refused = [];
  for (const [who, g] of [["mgrY", G], ["aaB", G], ["cl", G], ["anon", G], ["cg", G2]]) { const r = await one(who, g); if (r.err && H.DENY.test(r.err)) refused.push(who); else console.log("  not refused:", who, r.err || "OK"); }
  const bRef = [];
  for (const [who, ids] of [["mgrY", [G]], ["aaB", [G]], ["cl", [G]], ["anon", [G]], ["cg", [G, G2]], ["cg", [G2]]]) { const r = await bulk(who, ids); if (r.err && H.DENY.test(r.err)) bRef.push(who); }
  rec("E2 refused (generic): other office's manager, other agency, client, anon, a caregiver about another caregiver — single and bulk",
    refused.length === 5 && bRef.length === 6, `single ${refused.length}/5; bulk ${bRef.length}/6`);
  const scopeOk = []; for (const who of ["mgrX", "schX", "aaA", "mgrA"]) { const r = await call(who, "SELECT match_caregiver_scope($1)", [S]); if (!r.err && r.v.shift_id === S) scopeOk.push(who); }
  const scopeNo = []; for (const who of ["hrX", "mgrY", "aaB", "cg", "cl", "anon"]) { const r = await call(who, "SELECT match_caregiver_scope($1)", [S]); if (r.err && H.DENY.test(r.err)) scopeNo.push(who); }
  rec("M1 match_caregiver_scope: office manager, scheduler, agency admin and agency-wide manager allowed; HR, other office, other agency, caregiver, client, anon refused",
    scopeOk.length === 4 && scopeNo.length === 6, `ok ${scopeOk.join(",")}; refused ${scopeNo.length}/6`);
  const leAnon = await call("anon", "SELECT log_event($1,'shift_created','staff',NULL,'x',NULL,'{}'::jsonb,NULL,false)", [A]);
  const leAuth = await call("cg", "SELECT log_event($1,'shift_created','staff',NULL,'x',NULL,'{}'::jsonb,NULL,false)", [A]);
  rec("L1 log_event can no longer be called by anon or a signed-in user (permission denied)", /permission denied/.test(leAnon.err || "") && /permission denied/.test(leAuth.err || ""),
    `${(leAnon.err || "OK").slice(0, 40)} | ${(leAuth.err || "OK").slice(0, 40)}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });
