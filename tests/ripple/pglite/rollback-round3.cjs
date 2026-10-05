// UI round 3 rollback proofs: each round-3 migration's rollback (docs/rollback/) restores the exact
// catalog from before it (tables, columns, function bodies + ACLs, triggers, policies, constraints,
// grants), and re-applying after the rollback equals the first apply. Applied and rolled back in
// reverse order: S5, S4, W1.
// Usage: node tests/ripple/pglite/rollback-round3.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
const STEPS = [
  ["20261014120000_w1_audit_event_types.sql", "w1_audit_rollback.sql"],
  ["20261014120100_ui_s4_authorizations.sql", "ui_s4_rollback.sql"],
  ["20261014120200_ui_s5_goals.sql", "ui_s5_rollback.sql"],
].filter(([m]) => require("fs").existsSync(require("path").resolve(__dirname, "../../../supabase/migrations", m)));

(async () => {
  const { db } = await H.bootSchema(STEPS[0][0]);
  const snaps = [JSON.stringify(await H.snap(db))];
  for (const [m] of STEPS) { await H.applyFiles(db, [m]); snaps.push(JSON.stringify(await H.snap(db))); }
  let ok = true;
  for (let i = STEPS.length - 1; i >= 0; i--) {
    await H.applyRollback(db, STEPS[i][1]);
    const now = JSON.stringify(await H.snap(db)), same = now === snaps[i];
    console.log(`${STEPS[i][1]} restores the exact catalog from before ${STEPS[i][0]}: ${same} (${JSON.parse(snaps[i + 1]).length} -> ${JSON.parse(now).length} entries)`);
    if (!same) { ok = false; const b = new Set(JSON.parse(snaps[i])), a = new Set(JSON.parse(now)); console.log("  left:", [...a].filter((x) => !b.has(x)).slice(0, 6), "\n  missing:", [...b].filter((x) => !a.has(x)).slice(0, 6)); }
  }
  for (const [m] of STEPS) await H.applyFiles(db, [m]);
  const re = JSON.stringify(await H.snap(db)) === snaps[snaps.length - 1];
  console.log(`re-apply of ${STEPS.length} migration(s) after the rollbacks equals the first apply: ${re}`);
  console.log(`summary: ROLLBACK=${ok && re ? "PASS" : "FAIL"}`);
  if (!(ok && re)) process.exitCode = 1;
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });
