// Progress note "Location" office setting (20261031130000) on DEV through real logins (mirrors pglite/note-location.cjs).
// `before` (run with RIPPLE_WRITE_NOBREAK_BASELINE=1): no setter, no columns, the two existing functions are the bodies the
//   rollback restores (md5 of pg_get_functiondef); NB1 baseline.
// `after` (run with RIPPLE_NB1_HASHES=1): aclexplode; the fixture offices are 'free'; only the agency admin sets the
//   setting (audited); a note created in 'default' is prefilled and the caregiver sees location_mode and can change it;
//   'hidden' leaves it empty; NB1 identical (notes aren't in the assign path).
// Usage: node tests/ripple/dev/note-location.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const DEV = { create_progress_note_for_shift: "8c3a18364ff2197ed8a26092dcc1ba2d", get_progress_note_for_caregiver: "ea842bdc09c2e18a46d1b22a82d37771" };
const DEMO = "Ripple Effects Community Inclusion Center";

const cat = () => pgRead(async (c) => ({
  fns: (await c.query(`SELECT p.proname n, md5(pg_get_functiondef(p.oid)) h, p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...Object.keys(DEV), "set_office_note_location"]])).rows,
  cols: (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'virtual_office' AND column_name LIKE 'note_location%'`)).rows.length,
}));

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const k = await cat(), s = k.fns.find((x) => x.n === "set_office_note_location");
  rec("ACL (aclexplode): set_office_note_location SECURITY DEFINER, authenticated only; two office columns",
    pass(s && s.d && /authenticated:EXECUTE/.test(s.acl) && !/(^|,)(-|anon):/.test(s.acl) && k.cols === 2), `${s ? s.acl : "missing"}; cols ${k.cols}`);
  const offs = (await admin.from("virtual_office").select("note_location_mode, note_location_default").in("id", [F.OX, F.OY])).data || [];
  rec("D0 the fixture offices are 'free' with no default (today's behaviour)", pass(offs.length === 2 && offs.every((o) => o.note_location_mode === "free" && o.note_location_default === null)), JSON.stringify(offs));
  const deny = [];
  for (const [who, c] of [["mgrX", F.mgrX.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["aaB", F.aaB.c]]) {
    const r = await rpc(c, "set_office_note_location", { _office_id: F.OX, _mode: "default", _default: DEMO }); if (r.err && DENY.test(r.err)) deny.push(who); else log(`  not refused: ${who} ${r.err || "ok"}`);
  }
  const set = await rpc(F.aaA.c, "set_office_note_location", { _office_id: F.OX, _mode: "default", _default: DEMO });
  const ev = ((await admin.from("events").select("payload").eq("event_type", "office_note_location_changed").eq("subject_id", F.OX)).data || []);
  rec("R1 manager, HR, caregiver, other agency refused; the agency admin sets 'default' (audited with before / after)",
    pass(deny.length === 4 && !set.err && ev.length === 1 && ev[0].payload.after.default === DEMO), `refused ${deny.join(",")}; ${set.err || "set"}; events ${ev.length}`);
  // a note in 'default'
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  const mk = async (i) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(-1 - i), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "location fixture", _override_reason: "location fixture (disposable)" });
    return must(F.cg.c, "create_progress_note_for_shift", { _shift_id: id }); };
  const n1 = await mk(0);
  const v1 = (await must(F.cg.c, "get_progress_note_for_caregiver", { _note_id: n1 })).note;
  await must(F.cg.c, "save_progress_note_draft", { _note_id: n1, _header: { location: "Kalamazoo Public Library" }, _entries: [], _narrative_text: null });
  const l1 = (await admin.from("progress_notes").select("location").eq("id", n1).single()).data.location;
  rec("C1 'default': the new note is prefilled; the caregiver sees location_mode 'default' and can change it",
    pass(v1.location === DEMO && v1.location_mode === "default" && l1 === "Kalamazoo Public Library"), `${v1.location} / ${v1.location_mode} -> ${l1}`);
  await must(F.aaA.c, "set_office_note_location", { _office_id: F.OX, _mode: "hidden", _default: null });
  const n2 = await mk(1);
  const v2 = (await must(F.cg.c, "get_progress_note_for_caregiver", { _note_id: n2 })).note;
  const l1b = (await admin.from("progress_notes").select("location").eq("id", n1).single()).data.location;
  rec("C2 'hidden': the new note is empty with location_mode 'hidden'; the earlier note keeps its location",
    pass(v2.location === null && v2.location_mode === "hidden" && l1b === "Kalamazoo Public Library"), `${v2.location} / ${v2.location_mode}; earlier ${l1b}`);
}

(async () => {
  log(`=== Note location setting — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F; const ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  try {
    if (LABEL === "before") { const k = await cat();
      rec("B0 before: no setter, no office columns; the two existing functions are the bodies the rollback restores (md5)",
        pass(k.cols === 0 && !k.fns.some((x) => x.n === "set_office_note_location") && Object.keys(DEV).every((n) => (k.fns.find((x) => x.n === n) || {}).h === DEV[n])),
        k.fns.map((x) => `${x.n} ${x.h.slice(0, 8)}`).join("; ")); }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const { id } of (await admin.from("progress_notes").select("id").eq("client_id", F.CX)).data || []) await admin.from("events").delete().eq("subject_id", id);
      await admin.from("events").delete().eq("subject_id", F.OX);
      await teardownB2(F);
      await admin.from("care_plans").delete().eq("client_id", F.CX);
      for (const { id } of (await admin.from("credential_types").select("id").eq("agency_id", A)).data || []) if (!ctBefore.has(id)) await admin.from("credential_types").delete().eq("id", id);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.progress_notes WHERE client_id = $1)::int notes,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($2::uuid[]))::int shifts, (SELECT count(*) FROM public.events WHERE subject_id = $3)::int ev`, [F.CX, F.b2shifts || [], F.OX])).rows[0]);
      log(`teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
