// UI round 3 rollback proofs: each round-3 migration's rollback (docs/rollback/) restores the exact
// catalog from before it (tables, columns, function bodies + ACLs, triggers, policies, constraints,
// grants), and re-applying after the rollback equals the first apply. Applied and rolled back in
// reverse order: S9, late arrival, S8 fix, S8, S7, S6 case number, S6, W2 void, S5, S4, W1.
// Usage: node tests/ripple/pglite/rollback-round3.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
// md5(prosrc) of the nine readers W2 changes, as stored on DEV before the W2 push (Oct 5): the W2
// rollback must restore exactly these bodies.
const DEV_BEFORE_W2 = { correct_service_authorization: "2229d4e933296df59105c4f0e5c39030", cp_authorization_projection: "25babb01d6f9b28af4064cf22a155077",
  cp_check_order_service_authorization: "c8e302a906a0a7f21eca3d4174944829", cp_client_onboarding: "d0023cd387d012d3fb6b5827eaf7ec83", cp_projected_units: "95b39044338537f9776a19a2108f7783",
  create_service_authorization: "d478701f6b2003c3ea7cca54b1428c0d", get_client_authorizations: "192a162ddd5bf8aee1f5070c5c093107", list_authorization_risk: "639661e5cc31f78ca321c9b0689bfbb9",
  review_progress_note: "8eb42801e526a481a6d30f100c99d4d6" };
// md5(prosrc) of the two S6 training reads as stored on DEV before the case-number push (Oct 5).
// md5(prosrc) of get_progress_note_for_staff as stored on DEV before the S8 detail fix (Oct 5).
// md5(prosrc) of the units trigger function as stored on DEV before the late-arrival change (Oct 6).
const DEV_BEFORE_LATE = { cp_derive_progress_note_units: "3982e57fcaac368e38dd480ab2a06d10" };
const DEV_BEFORE_S8FIX = { get_progress_note_for_staff: "99fe3923e729f8ab0f3e6c3b97a6f3e8" };
const DEV_BEFORE_CASE = { get_client_training_context: "787ab4c8d0b9f3541e3ede7a052bd667", list_client_training_status: "311cd150fa77ed11c12e363e75c7dbf5" };
const STEPS = [
  ["20261014120000_w1_audit_event_types.sql", "w1_audit_rollback.sql"],
  ["20261014120100_ui_s4_authorizations.sql", "ui_s4_rollback.sql"],
  ["20261014120200_ui_s5_goals.sql", "ui_s5_rollback.sql"],
  ["20261015120000_w2_void_authorization.sql", "w2_void_rollback.sql"],
  ["20261016120000_ui_s6_training.sql", "ui_s6_rollback.sql"],
  ["20261017120000_ui_s6_case_number_training_names.sql", "ui_s6_case_number_rollback.sql"],
  ["20261018120000_ui_s7_caregiver_notes.sql", "ui_s7_rollback.sql"],
  ["20261019120000_ui_s8_note_review.sql", "ui_s8_rollback.sql"],
  ["20261019120200_ui_s8_note_detail_fix.sql", "ui_s8_note_detail_fix_rollback.sql"],
  ["20261020120000_late_arrival_no_grace.sql", "late_arrival_no_grace_rollback.sql"],
  ["20261021120000_ui_s9_weekly_billing.sql", "ui_s9_rollback.sql"],
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
    if (STEPS[i][1] === "late_arrival_no_grace_rollback.sql") {
      const h = (await db.query(`SELECT md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'cp_derive_progress_note_units'`)).rows;
      const same = h.length === 1 && h[0].h === DEV_BEFORE_LATE.cp_derive_progress_note_units;
      console.log(`  restored units trigger function byte-identical to DEV before the late-arrival change (md5): ${same}`);
      if (!same) ok = false;
    }
    if (STEPS[i][1] === "ui_s8_note_detail_fix_rollback.sql") {
      const h = (await db.query(`SELECT md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'get_progress_note_for_staff'`)).rows;
      const same = h.length === 1 && h[0].h === DEV_BEFORE_S8FIX.get_progress_note_for_staff;
      console.log(`  restored S8 detail read byte-identical to DEV before the fix (md5): ${same}`);
      if (!same) ok = false;
    }
    if (STEPS[i][1] === "ui_s6_case_number_rollback.sql") {
      const h = (await db.query(`SELECT proname, md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [Object.keys(DEV_BEFORE_CASE)])).rows;
      const off = h.filter((r) => DEV_BEFORE_CASE[r.proname] !== r.h).map((r) => r.proname);
      console.log(`  restored S6 training reads byte-identical to DEV before the case-number push (md5): ${off.length === 0 && h.length === 2}${off.length ? " DIFFER: " + off.join(", ") : ""}`);
      if (off.length || h.length !== 2) ok = false;
    }
    if (!same) { ok = false; const b = new Set(JSON.parse(snaps[i])), a = new Set(JSON.parse(now)); console.log("  left:", [...a].filter((x) => !b.has(x)).slice(0, 6), "\n  missing:", [...b].filter((x) => !a.has(x)).slice(0, 6)); }
  }
  for (const [m] of STEPS) await H.applyFiles(db, [m]);
  const re = JSON.stringify(await H.snap(db)) === snaps[snaps.length - 1];
  console.log(`re-apply of ${STEPS.length} migration(s) after the rollbacks equals the first apply: ${re}`);
  console.log(`summary: ROLLBACK=${ok && re ? "PASS" : "FAIL"}`);
  if (!(ok && re)) process.exitCode = 1;
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });
