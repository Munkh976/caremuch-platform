// Removes the persistent Ripple demo office ("Ripple Effects – Demo", code RPLDEMO) and its demo users from DEV.
// Usage: node tests/ripple/demo/teardown-demo.cjs [--apply]
//   default  DRY RUN, read-only: rows per table in the demo office / of the demo users, plus the rows that would be
//            touched without being demo rows (must be 0).
//   --apply  the same id lists deleted in ONE transaction (each count checked, RAISE -> rollback), then the auth users
//            through the admin API, then a read-only re-query (nothing left).
const D = require("./demo-lib.cjs");
const APPLY = process.argv.includes("--apply");

(async () => {
  console.log(`=== teardown-demo — ${APPLY ? "APPLY" : "DRY RUN (read-only)"} ===`);
  const snap = await D.collect();
  for (const [t, n] of Object.entries(D.counts(snap.ids))) if (n) console.log(`  ${t.padEnd(26)} ${n}`);
  console.log(`  ${"auth users (admin API)".padEnd(26)} ${snap.authUsers.length}`);
  console.log(`  total rows: ${D.total(snap.ids)}`);
  for (const [label, n] of snap.outside) console.log(`  outside the demo: ${label}: ${n}`);
  if (!APPLY) { console.log(snap.outside.some(([, n]) => n) ? "DRY RUN: non-demo rows would be touched -> --apply refuses" : "DRY RUN ok: only demo rows. Re-run with --apply to delete."); return; }
  const r = await D.deleteAll(snap, "teardown");
  console.log(`transaction committed: ${r.deleted} rows (every count matched); auth users deleted ${r.authDeleted}/${snap.authUsers.length}`);
  console.log(`re-query: ${r.left || r.authLeft ? `LEFT ${r.left} rows, ${r.authLeft} auth users` : "NOTHING of the demo remains"}`);
  if (r.left || r.authLeft) process.exitCode = 1;
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());
