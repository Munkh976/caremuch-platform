// 3b (20261031190000) on DEV through real logins and the service role. `before` (RIPPLE_WRITE_NOBREAK_BASELINE=1): the
// trigger is absent; NB1 baseline. `after` (RIPPLE_NB1_HASHES=1): NB1 identical; aclexplode (no API role); a direct cancel
// is refused through the API as the manager AND with the service-role key; Cancel visit / Client no-show refuse without a
// reason and work with one; a cancelled visit can't be reopened directly; editing a visit's times still works.
// Usage: node tests/ripple/dev/shift-cancel-guard.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const cat = () => pgRead(async (c) => ({
  fn: (await c.query(`SELECT p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'cp_guard_shift_cancel'`)).rows,
  trg: (await c.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_cp_guard_shift_cancel' AND tgrelid = 'public.shifts'::regclass`)).rows[0].n,
}));

async function after(F) {
  const k = await cat();
  rec("ACL (aclexplode): trigger function present, no API role; trigger on shifts", pass(k.fn.length === 1 && !/(^|,)(-|anon|authenticated):/.test(k.fn[0].acl || "") && k.trg === 1), `${k.fn[0] && k.fn[0].acl}; trigger ${k.trg}`);
  const mk = async (d, start) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001",
      shift_date: await dbDay(d), start_time: start, end_time: `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`, duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    const a = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: null, _override_reason: "guard fixture (disposable)" });
    if (a.err) throw new Error(`assign: ${a.err}`); return id; };
  const st = async (id) => (await admin.from("shifts").select("status, visit_outcome").eq("id", id).single()).data;
  const s1 = await mk(25, "09:00");
  const viaApi = await F.mgrX.c.from("shifts").update({ status: "cancelled" }).eq("id", s1);
  const viaService = await admin.from("shifts").update({ status: "cancelled" }).eq("id", s1);
  rec("D1 a direct cancel is refused — through the API as the office manager and with the service-role key; the visit stays assigned",
    pass(/Cancel visit or Client no-show/.test(viaApi.error?.message || "") && /Cancel visit or Client no-show/.test(viaService.error?.message || "") && (await st(s1)).status === "assigned"),
    `${(viaApi.error?.message || "ALLOWED").slice(0, 40)} | ${(viaService.error?.message || "ALLOWED").slice(0, 40)}`);
  const noReason = await rpc(F.mgrX.c, "cancel_visit", { _shift_id: s1, _requested_by: "client", _reason_code: null, _reason_text: null, _following: false, _whole_group: false });
  const ok = await rpc(F.mgrX.c, "cancel_visit", { _shift_id: s1, _requested_by: "client", _reason_code: "client_request", _reason_text: "Family away", _following: false, _whole_group: false });
  const s2 = await mk(-1, "15:00");
  const nsNo = await rpc(F.mgrX.c, "record_client_no_show", { _shift_id: s2, _reason_text: "", _whole_group: false });
  const ns = await rpc(F.mgrX.c, "record_client_no_show", { _shift_id: s2, _reason_text: "Nobody answered", _whole_group: false });
  rec("D2 Cancel visit and Client no-show refuse without a reason and work with one",
    pass(/Choose a reason/.test(noReason.err || "") && !ok.err && (await st(s1)).visit_outcome === "cancelled" && /Describe the reason/.test(nsNo.err || "") && !ns.err && (await st(s2)).visit_outcome === "client_no_show"),
    `${(noReason.err || "").slice(0, 20)} | ${ok.err || "cancelled"} | ${(nsNo.err || "").slice(0, 20)} | ${ns.err || "no-show"}`);
  const reopen = await admin.from("shifts").update({ status: "open" }).eq("id", s1);
  const s3 = await mk(26, "09:00");
  const times = await F.mgrX.c.from("shifts").update({ start_time: "09:30:00", end_time: "10:30:00" }).eq("id", s3);
  rec("D3 reopening a cancelled visit directly is refused; editing a visit's times still works",
    pass(/reopened/.test(reopen.error?.message || "") && !times.error && (await st(s1)).status === "cancelled"), `${(reopen.error?.message || "ALLOWED").slice(0, 40)} | times ${times.error?.message || "ok"}`);
}

(async () => {
  log(`=== Shift cancel guard — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const k = await cat(); rec("B0 before: no trigger, no function", pass(k.fn.length === 0 && k.trg === 0), `${k.fn.length} / ${k.trg}`); }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) { for (const s of F.b2shifts || []) { await admin.from("pending_notifications").delete().contains("payload", { shift_id: s }); await admin.from("events").delete().eq("subject_id", s); } await teardownB2(F); }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shifts WHERE id = ANY($1::uuid[]))::int shifts, (SELECT count(*) FROM public.events WHERE subject_id = ANY($1::uuid[]))::int ev`, [F.b2shifts || []])).rows[0]);
      log(`teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
