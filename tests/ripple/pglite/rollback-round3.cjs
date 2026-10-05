// UI round 3 rollback proofs: each round-3 migration's rollback (docs/rollback/) restores the exact
// catalog from before it (tables, columns, function bodies + ACLs, triggers, policies, constraints,
// grants), and re-applying after the rollback equals the first apply. Applied and rolled back in
// reverse order: W2 void, S5, S4, W1.
// Usage: node tests/ripple/pglite/rollback-round3.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
// md5(prosrc) of the nine readers W2 changes, as stored on DEV before the W2 push (Oct 5): the W2
// rollback must restore exactly these bodies.
const DEV_BEFORE_W2 = { correct_service_authorization: "2229d4e933296df59105c4f0e5c39030", cp_authorization_projection: "25babb01d6f9b28af4064cf22a155077",
  cp_check_order_service_authorization: "c8e302a906a0a7f21eca3d4174944829", cp_client_onboarding: "d0023cd387d012d3fb6b5827eaf7ec83", cp_projected_units: "95b39044338537f9776a19a2108f7783",
  create_service_authorization: "d478701f6b2003c3ea7cca54b1428c0d", get_client_authorizations: "192a162ddd5bf8aee1f5070c5c093107", list_authorization_risk: "639661e5cc31f78ca321c9b0689bfbb9",
  review_progress_note: "8eb42801e526a481a6d30f100c99d4d6" };
const STEPS = [
  ["20261014120000_w1_audit_event_types.sql", "w1_audit_rollback.sql"],
  ["20261014120100_ui_s4_authorizations.sql", "ui_s4_rollback.sql"],
  ["20261014120200_ui_s5_goals.sql", "ui_s5_rollback.sql"],
  ["20261015120000_w2_void_authorization.sql", "w2_void_rollback.sql"],
  ["20261016120000_ui_s6_training.sql", "ui_s6_rollback.sql"],
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
    if (STEPS[i][1] === "w2_void_rollback.sql") {
      const h = (await db.query(`SELECT proname, md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(DEV_BEFORE_W2)])).rows;
      const off = h.filter((r) => DEV_BEFORE_W2[r.proname] !== r.h).map((r) => r.proname);
      console.log(`  restored reader bodies byte-identical to DEV before W2 (md5): ${off.length === 0 && h.length === 9}${off.length ? " DIFFER: " + off.join(", ") : ""}`);
      if (off.length || h.length !== 9) ok = false;
    }
    if (!same) { ok = false; const b = new Set(JSON.parse(snaps[i])), a = new Set(JSON.parse(now)); console.log("  left:", [...a].filter((x) => !b.has(x)).slice(0, 6), "\n  missing:", [...b].filter((x) => !a.has(x)).slice(0, 6)); }
  }
  for (const [m] of STEPS) await H.applyFiles(db, [m]);
  const re = JSON.stringify(await H.snap(db)) === snaps[snaps.length - 1];
  console.log(`re-apply of ${STEPS.length} migration(s) after the rollbacks equals the first apply: ${re}`);
  console.log(`summary: ROLLBACK=${ok && re ? "PASS" : "FAIL"}`);
  if (!(ok && re)) process.exitCode = 1;
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });
