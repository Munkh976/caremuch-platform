// "Visits take place at" (20261031160000) on DEV through real logins (mirrors pglite/visit-location.cjs).
// `before` (RIPPLE_WRITE_NOBREAK_BASELINE=1): no setter, no column; NB1 baseline.
// `after` (RIPPLE_NB1_HASHES=1): aclexplode; every office client_home; only the agency admin sets it, 'office' needs the
//   street address, audited; NB1 identical.
// Usage: node tests/ripple/dev/visit-location.cjs <before|after> > some.log 2>&1
const { REF, LABEL, admin, log, rec, pass, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, teardownB1, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const cat = () => pgRead(async (c) => ({
  fn: (await c.query(`SELECT p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'set_office_visit_location'`)).rows,
  col: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'virtual_office' AND column_name = 'visit_location'`)).rows[0].n,
}));

async function after(F) {
  const k = await cat();
  rec("ACL (aclexplode): set_office_visit_location SECURITY DEFINER, authenticated only; column present",
    pass(k.fn.length === 1 && k.fn[0].d && /authenticated:EXECUTE/.test(k.fn[0].acl) && !/(^|,)(-|anon):/.test(k.fn[0].acl) && k.col === 1), `${k.fn[0] && k.fn[0].acl}; col ${k.col}`);
  const offs = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n, count(*) FILTER (WHERE visit_location = 'client_home')::int h FROM public.virtual_office`)).rows[0]);
  rec("D0 every office on DEV: client_home", pass(offs.n === offs.h), `${offs.h}/${offs.n}`);
  const deny = [];
  for (const [who, c] of [["mgrX", F.mgrX.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["aaB", F.aaB.c]]) { const r = await rpc(c, "set_office_visit_location", { _office_id: F.OX, _mode: "office" }); if (r.err && DENY.test(r.err)) deny.push(who); }
  await admin.from("virtual_office").update({ address: null }).eq("id", F.OX);
  const noAddr = await rpc(F.aaA.c, "set_office_visit_location", { _office_id: F.OX, _mode: "office" });
  await admin.from("virtual_office").update({ address: "100 Fictitious Way" }).eq("id", F.OX);
  const ok = await rpc(F.aaA.c, "set_office_visit_location", { _office_id: F.OX, _mode: "office" });
  const ev = ((await admin.from("events").select("payload").eq("event_type", "office_visit_location_changed").eq("subject_id", F.OX)).data || []);
  rec("S1 manager, HR, caregiver, other agency refused; 'office' needs the street address; the agency admin sets it (audited)",
    pass(deny.length === 4 && /street address/.test(noAddr.err || "") && !ok.err && ev.length === 1 && ev[0].payload.after === "office"), `refused ${deny.join(",")}; ${(noAddr.err || "ALLOWED").slice(0, 40)}; ${ok.err || "set"}; events ${ev.length}`);
}

(async () => {
  log(`=== Visit location — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const k = await cat(); rec("B0 before: no setter, no column", pass(k.fn.length === 0 && k.col === 0), `${k.fn.length} / ${k.col}`); }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) await admin.from("events").delete().eq("subject_id", F.OX);
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT count(*)::int ev FROM public.events WHERE subject_id = $1`, [F.OX])).rows[0]);
      log(`teardown re-query: ${JSON.stringify(left)} → ${left.ev === 0 ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
