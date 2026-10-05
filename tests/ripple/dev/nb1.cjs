// Scheduling no-change check on its own: NB1 (Manual / Smart via match-caregiver / Auto assign, single
// and bulk eligibility, caregiver side) on fresh fixtures, compared with baseline/nobreak_before.json.
// Usage: node tests/ripple/dev/nb1.cjs        (RIPPLE_NB1_HASHES=1 also compares the function hashes)
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { REF, log, reportSkew, setup, checkNoBreak, teardown, closeDb, summary } = require("./lib.cjs");

(async () => {
  log(`=== NB1 scheduling no-change check — project ${REF} ===`);
  await reportSkew();
  let F;
  try { F = await setup(); await checkNoBreak(F); }
  catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally { await teardown(F); await closeDb(); }
  summary();
})();
