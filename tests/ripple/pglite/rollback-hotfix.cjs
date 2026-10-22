// Rollback proof for 20261030110000 (security hotfix): hotfix_caller_checks_rollback.sql restores the catalog before the
// migration (log_event's grants included); the two eligibility bodies are byte-identical to DEV's before the push (md5);
// re-applying equals the first apply.
// Usage: node tests/ripple/pglite/rollback-hotfix.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261030110000_hotfix_caller_checks.sql", RB = "hotfix_caller_checks_rollback.sql";
const DEV = { check_assignment_eligibility: "34cb1b4efd4ab4796bf8be6df40ce68a", check_assignment_eligibility_bulk: "0cb743ebec33081caf0e8543c8457416" };   // DEV, Oct 21

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(MIG);
  const md5s = async () => Object.fromEntries((await db.query(`SELECT proname n, md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(DEV)])).rows.map((r) => [r.n, r.h]));
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const grants = async () => (await db.query(`SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) g FROM pg_proc p, aclexplode(p.proacl) x WHERE p.proname = 'log_event'`)).rows[0].g;
  const s0 = await H.snap(db), g0 = await grants();
  await H.applyFiles(db, [MIG]); const s1 = await H.snap(db);
  await H.applyRollback(db, RB);
  const s2 = await H.snap(db), m2 = await md5s(), g2 = await grants();
  // log_event: the ACL text's order differs after a re-GRANT; its grantee set is compared instead
  const d = diff(s0, s2).filter((x) => !Object.keys(DEV).some((n) => x.slice(1).startsWith(`fn:${n}(`)) && !x.slice(1).startsWith("fn:log_event("));
  rec("RB1 after the rollback the catalog equals the one before (new functions gone); log_event's grantees are the same set as before (PUBLIC, anon, authenticated back)", d.length === 0 && g2 === g0, d.length ? d.slice(0, 3).join(" ; ").slice(0, 200) : `identical; log_event ${g2}`);
  const bad = Object.keys(DEV).filter((n) => m2[n] !== DEV[n]);
  rec("RB2 the two eligibility bodies are byte-identical to DEV's before the push (md5)", bad.length === 0, bad.length ? `differ ${bad.join(",")}` : "2/2");
  await H.applyFiles(db, [MIG]); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });
