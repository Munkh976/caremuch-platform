// caregiver_pickable_shifts (20261031180000) on DEV. `before` (RIPPLE_WRITE_NOBREAK_BASELINE=1): absent; NB1 baseline.
// `after` (RIPPLE_NB1_HASHES=1): NB1 identical; aclexplode; READ ONLY on the demo office as Ana (rolled back): her open
// visits are pickable for Zoe / Max / Noah (trained, clients onboarded) and not for Ella (only Ivy trained); the result has
// only shift_id + pickable.
// Usage: node tests/ripple/dev/caregiver-pickable.cjs <before|after> > some.log 2>&1
const { REF, LABEL, log, rec, pass, pgRead, setup, setupB1, checkNoBreak, teardownB1, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const D = require("../demo/demo-lib.cjs");
const fn = () => pgRead(async (c) => (await c.query(`SELECT p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'caregiver_pickable_shifts'`)).rows);

async function after() {
  const f = await fn();
  rec("ACL (aclexplode): SECURITY DEFINER, authenticated only", pass(f.length === 1 && f[0].d && /authenticated:EXECUTE/.test(f[0].acl) && !/(^|,)(-|anon):/.test(f[0].acl)), f[0] && f[0].acl);
  const r = await pgRead(async (c) => {
    await c.query("BEGIN READ ONLY");
    try {
      const [off] = await D.findOffice();
      const ana = (await c.query(`SELECT id FROM public.profiles WHERE email = $1`, [D.email("ana.brooks")])).rows[0].id;
      const open = (await c.query(`SELECT s.id, cl.first_name c FROM public.shifts s JOIN public.clients cl ON cl.id = s.client_id
        WHERE s.virtual_office_id = $1 AND s.caregiver_id IS NULL AND s.status = 'open'`, [off.id])).rows;
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [ana]); await c.query("SET LOCAL ROLE authenticated");
      const rows = (await c.query(`SELECT * FROM public.caregiver_pickable_shifts($1::uuid[])`, [open.map((o) => o.id)])).rows;
      const name = new Map(open.map((o) => [o.id, o.c]));
      const out = {}; for (const x of rows) { const k = `${name.get(x.shift_id)}:${x.pickable}`; out[k] = (out[k] || 0) + 1; }
      return { out, keys: rows.length ? Object.keys(rows[0]).sort().join() : "", n: rows.length, open: open.length };
    } finally { await c.query("ROLLBACK"); }
  });
  const o = r.out;
  rec("P1 demo office, Ana (read only): Zoe / Max / Noah open visits pickable, Ella's not (only Ivy trained); only shift_id + pickable",
    pass(r.n === r.open && r.keys === "pickable,shift_id" && o["Zoe:true"] > 0 && o["Max:true"] > 0 && o["Noah:true"] > 0 && !o["Ella:true"] && o["Ella:false"] === 7 && !o["Zoe:false"]),
    JSON.stringify(r.out));
}

(async () => {
  log(`=== Caregiver pickable — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const f = await fn(); rec("B0 before: function absent", pass(f.length === 0), `${f.length}`); }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after();
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally { await teardownB1(F); await teardown(F); await D.closeDb(); await closeDb(); }
  summary();
})();
