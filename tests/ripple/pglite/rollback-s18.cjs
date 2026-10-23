// Rollback proof for 20261031140000 (S18 billing units): s18_billing_units_rollback.sql stops while S18 events exist,
// then restores the catalog before the migration; the three existing functions come back byte-identical to DEV before
// the push (md5 of pg_get_functiondef). list_notes_for_review has CRLF line ends on DEV: the rollback rebuilds them;
// RB1 / RB2 assume this machine's CRLF working copy of 20261019120000 (as DEV got it). Re-apply = first apply.
// Usage: node tests/ripple/pglite/rollback-s18.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031140000_s18_billing_units.sql", RB = "s18_billing_units_rollback.sql";
const DEV = { cp_derive_progress_note_units: "1d2a70f032ecf8d2a59f5cfc0aa92fad", get_progress_note_for_staff: "5a189a549c0635bd82a6deb492359d3f", list_notes_for_review: "0dc30fc1d582dc2183fa31f9c1f273ad" };   // DEV, Oct 22, before the push

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(MIG);
  // DEV's list_notes_for_review has CRLF line ends (pushed from a CRLF working copy). In an LF checkout (CI) the harness
  // creates it with LF, so first install DEV's exact body — the rollback's own block for it — and "before" = DEV anywhere.
  const rbText = require("fs").readFileSync(require("path").resolve(__dirname, "../../../docs/rollback/s18_billing_units_rollback.sql"), "utf8").replace(/\r\n/g, "\n");
  const devBlock = rbText.match(/DO \$rb\$ BEGIN EXECUTE replace\(\$q\$CREATE OR REPLACE FUNCTION public\.list_notes_for_review[\s\S]*?END \$rb\$;/);
  if (!devBlock) throw new Error("DEV block for list_notes_for_review not found in the rollback");
  await db.exec(devBlock[0]);
  const defs = async () => Object.fromEntries((await db.query(`SELECT proname n, md5(pg_get_functiondef(oid)) h FROM pg_proc WHERE proname = ANY($1)`, [Object.keys(DEV)])).rows.map((r) => [r.n, r.h]));
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(db), d0 = await defs();
  await H.applyFiles(db, [MIG]); const s1 = await H.snap(db);
  await db.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'progress_note_units_adjusted','staff','virtual_office','{}')`, [H.A]);
  let blocked = null; try { await H.applyRollback(db, RB); } catch (e) { blocked = e.message; }
  const sB = await H.snap(db);
  await db.query(`DELETE FROM events WHERE event_type = 'progress_note_units_adjusted'`);
  rec("RB0 while S18 events exist the rollback stops with the reason and changes nothing", /S18 events exist/.test(blocked || "") && diff(s1, sB).length === 0, (blocked || "NOT BLOCKED").slice(0, 60));
  await H.applyRollback(db, RB);
  const s2 = await H.snap(db), d2 = await defs();
  rec("RB1 after the rollback the catalog equals the one before the migration", diff(s0, s2).length === 0, diff(s0, s2).slice(0, 2).join(" ; ") || "identical");
  rec("RB2 the three existing functions are byte-identical to before and to DEV before the push (md5 of pg_get_functiondef)",
    Object.keys(DEV).every((k) => d2[k] === d0[k] && d2[k] === DEV[k]), Object.keys(DEV).map((k) => `${k} ${d2[k].slice(0, 8)} (DEV ${DEV[k].slice(0, 8)})`).join("; "));
  await H.applyFiles(db, [MIG]); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });
