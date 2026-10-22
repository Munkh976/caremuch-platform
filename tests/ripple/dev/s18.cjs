// S18 billing flexibility (20261031140000) on DEV through real logins (mirrors pglite/s18.cjs).
// `before` (run with RIPPLE_WRITE_NOBREAK_BASELINE=1): none of the new functions / columns; the three existing functions
//   are the bodies the rollback restores (md5); every draft / returned note's stored units equal the S12 rule (read only);
//   NB1 baseline.
// `after` (run with RIPPLE_NB1_HASHES=1): aclexplode; 0 notes on DEV would change under the defaults (cp_units_for vs the
//   stored units of every draft / returned note); every office on the defaults; the setter (agency admin only); a submitted
//   note adjusted by the manager (audited, no reason text), reviewed (charges the adjusted units), built into the week's
//   bill; the per-day read equals the per-authorization read in totals and marks the adjusted day; NB1 identical.
// Usage: node tests/ripple/dev/s18.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const DEV = { cp_derive_progress_note_units: "1d2a70f032ecf8d2a59f5cfc0aa92fad", get_progress_note_for_staff: "5a189a549c0635bd82a6deb492359d3f", list_notes_for_review: "0dc30fc1d582dc2183fa31f9c1f273ad" };
const NEW = ["adjust_note_units", "get_billing_week_days", "set_office_units_rule", "cp_units_for"];

const cat = () => pgRead(async (c) => ({
  fns: (await c.query(`SELECT p.proname n, md5(pg_get_functiondef(p.oid)) h, p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...Object.keys(DEV), ...NEW]])).rows,
  cols: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'virtual_office' AND column_name IN ('units_rule','units_minutes','units_grace_minutes'))
    OR (table_name = 'progress_notes' AND column_name LIKE 'units\\_%' AND column_name NOT IN ('units_scheduled','units_used')))`)).rows[0].n,
}));
// S12 rule, written out (the trigger's arithmetic), for every draft / returned note with scheduled times
const S12 = `CASE WHEN NOT n.billable OR n.units_scheduled IS NULL THEN 0 ELSE LEAST(GREATEST(
    floor(extract(epoch FROM (LEAST(COALESCE(date_trunc('minute', n.actual_end), n.scheduled_end), n.scheduled_end) - n.scheduled_start)) / 900)
  - ceil(extract(epoch FROM (GREATEST(COALESCE(date_trunc('minute', n.client_arrived_at), n.scheduled_start), n.scheduled_start) - n.scheduled_start)) / 900), 0), n.units_scheduled) END`;
const NEWRULE = `CASE WHEN NOT n.billable OR n.units_scheduled IS NULL THEN 0 ELSE LEAST(public.cp_units_for(n.scheduled_start, n.scheduled_end, n.client_arrived_at, n.actual_end, 15, 'full_blocks', 0), n.units_scheduled) END`;
const compare = (expr) => pgRead(async (c) => (await c.query(`SELECT count(*)::int total, count(*) FILTER (WHERE n.units_used <> ${expr})::int differ
  FROM public.progress_notes n WHERE NOT n.voided AND n.status IN ('draft', 'returned') AND n.scheduled_start IS NOT NULL AND n.scheduled_end IS NOT NULL`)).rows[0]);

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const k = await cat(), api = ["adjust_note_units", "get_billing_week_days", "set_office_units_rule"];
  const okApi = api.every((n) => { const x = k.fns.find((y) => y.n === n); return x && x.d && /authenticated:EXECUTE/.test(x.acl) && !/(^|,)(-|anon):/.test(x.acl); });
  const u = k.fns.find((x) => x.n === "cp_units_for");
  rec("ACL (aclexplode): 3 API functions SECURITY DEFINER, authenticated only; cp_units_for no API role; 11 new columns",
    pass(okApi && u && !/(^|,)(-|anon|authenticated):/.test(u.acl || "") && k.cols === 11), k.fns.filter((x) => NEW.includes(x.n)).map((x) => `${x.n} ${x.acl}`).join(" | ").slice(0, 400) + `; cols ${k.cols}`);
  const cmp = await compare(NEWRULE);
  const offs = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n, count(*) FILTER (WHERE units_rule = 'full_blocks' AND units_minutes = 15 AND units_grace_minutes = 0)::int d FROM public.virtual_office`)).rows[0]);
  rec("E1 defaults: 0 draft / returned notes on DEV would change (cp_units_for full_blocks / 15 / 0 vs stored units); every office on the defaults",
    pass(cmp.differ === 0 && offs.n === offs.d), `${cmp.total} notes compared, ${cmp.differ} differ; offices ${offs.d}/${offs.n} on defaults`);
  // setter
  const deny = [];
  for (const [who, c] of [["mgrX", F.mgrX.c], ["hrX", F.hrX.c], ["aaB", F.aaB.c]]) { const r = await rpc(c, "set_office_units_rule", { _office_id: F.OX, _rule: "grace", _grace_minutes: 7, _minutes: 15 }); if (r.err && DENY.test(r.err)) deny.push(who); }
  const set = await rpc(F.aaA.c, "set_office_units_rule", { _office_id: F.OX, _rule: "grace", _grace_minutes: 7, _minutes: 15 });
  const m30 = await rpc(F.aaA.c, "set_office_units_rule", { _office_id: F.OX, _rule: "full_blocks", _grace_minutes: 0, _minutes: 30 });
  // fixtures in the last complete billing week
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.OX);
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  const auth = await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-S18-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  const wks = (await admin.from("virtual_office").select("billing_week_start").eq("id", F.OX).single()).data.billing_week_start;
  const today = await dbDay(0); const dow = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const plus = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const ws = plus(today, -(((dow - wks + 7) % 7) + 7));
  const write = async (k2, lateMin) => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: plus(ws, k2), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "s18 fixture", _override_reason: "s18 fixture (disposable)" });
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: id }); (F.notes = F.notes || []).push(n);
    const r = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(r.scheduled_start) + lateMin * 60000).toISOString(), actual_end: r.scheduled_end }, _entries: [], _narrative_text: null });
    await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
    return n; };
  const N1 = await write(0, 6), N2 = await write(1, 9);      // grace 7: 6 late = on time (4); 9 late loses a block (3)
  const r1 = (await admin.from("progress_notes").select("units_used, units_rule, units_grace_minutes").in("id", [N1, N2])).data;
  const byId = Object.fromEntries((await admin.from("progress_notes").select("id, units_used, units_rule, units_grace_minutes").in("id", [N1, N2])).data.map((x) => [x.id, x]));
  rec("S1 manager, HR, other agency refused; the agency admin sets grace 7 (30-minute units refused); notes saved after it: 6 late -> 4 of 4, 9 late -> 3 of 4, rule stored",
    pass(deny.length === 3 && !set.err && /15 minutes/.test(m30.err || "") && Number(byId[N1].units_used) === 4 && Number(byId[N2].units_used) === 3 && byId[N1].units_rule === "grace" && byId[N1].units_grace_minutes === 7),
    `refused ${deny.join(",")}; ${set.err || "set"}; ${(m30.err || "30 ALLOWED").slice(0, 40)}; ${r1.map((x) => x.units_used).join("/")}`);
  await must(F.aaA.c, "set_office_units_rule", { _office_id: F.OX, _rule: "full_blocks", _grace_minutes: 0, _minutes: 15 });
  // adjust -> review -> bill
  const cg = await rpc(F.cg.c, "adjust_note_units", { _note_id: N2, _units: 4, _reason: "Arrival typed wrong by the caregiver" });
  const adj = await rpc(F.mgrX.c, "adjust_note_units", { _note_id: N2, _units: 4, _reason: "Arrival typed wrong by the caregiver" });
  const ev = ((await admin.from("events").select("payload").eq("event_type", "progress_note_units_adjusted").eq("subject_id", N2)).data || []);
  const avail = async () => Number((await admin.from("service_authorizations").select("units_available").eq("id", auth).single()).data.units_available);
  const av0 = await avail();
  for (const n of [N1, N2]) await must(F.mgrX.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  const av1 = await avail();
  rec("J1 the caregiver can't adjust; the manager adjusts 3 -> 4 (audited, no reason text); review charges 4 + 4",
    pass(DENY.test(cg.err || "") && !adj.err && ev.length === 1 && ev[0].payload.before === 3 && ev[0].payload.after === 4 && !JSON.stringify(ev[0].payload).includes("typed wrong") && av1 === av0 - 8),
    `${(cg.err || "ALLOWED").slice(0, 30)}; ${adj.err || JSON.stringify(adj.v)}; avail ${av0} -> ${av1}`);
  await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws });
  const wk = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: ws });
  const dy = await must(F.mgrX.c, "get_billing_week_days", { _office_id: F.OX, _week_start: ws });
  const hr = await rpc(F.hrX.c, "get_billing_week_days", { _office_id: F.OX, _week_start: ws });
  const sum = (ls, k2) => ls.reduce((s, l) => s + Number(l[k2]), 0);
  const d0 = dy.batches[0], b0 = wk.batches[0];
  rec("B1 per-day bill: two days, totals equal the per-authorization bill (8), the adjusted day marked; HR refused",
    pass(d0 && b0 && d0.lines.length === 2 && sum(d0.lines, "units_billed") === 8 && sum(b0.lines, "units_billed") === 8 && d0.lines.filter((l) => l.adjusted).length === 1 && DENY.test(hr.err || "")),
    `${d0 && d0.lines.map((l) => `${l.service_date} ${l.units_billed}/${l.units_scheduled}${l.adjusted ? "*" : ""}`).join(", ")}; HR ${(hr.err || "ALLOWED").slice(0, 30)}`);
}

(async () => {
  log(`=== S18 billing units — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const k = await cat(), cmp = await compare(S12);
      rec("B0 before: no new functions or columns; the three existing functions are the bodies the rollback restores (md5)",
        pass(k.cols === 0 && !k.fns.some((x) => NEW.includes(x.n)) && Object.keys(DEV).every((n) => (k.fns.find((x) => x.n === n) || {}).h === DEV[n])),
        k.fns.map((x) => `${x.n} ${x.h.slice(0, 8)}`).join("; "));
      rec("E0 before (read only): every draft / returned note's stored units equal the S12 rule", pass(cmp.differ === 0), `${cmp.total} notes, ${cmp.differ} differ`); }
    F = await setup(); await setupB1(F);
    F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const n of F.notes || []) await admin.from("events").delete().eq("subject_id", n);
      for (const { id: b } of (await admin.from("billing_batches").select("id").eq("virtual_office_id", F.OX)).data || []) await admin.from("events").delete().eq("subject_id", b);
      await admin.from("events").delete().eq("subject_id", F.OX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR subject_id = ANY($3::uuid[]))::int ev,
        (SELECT count(*) FROM public.progress_notes WHERE id = ANY($3::uuid[]))::int notes, (SELECT count(*) FROM public.billing_batches WHERE virtual_office_id = ANY($1::uuid[]))::int batches,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($2::uuid[]))::int shifts, (SELECT count(*) FROM public.virtual_office WHERE id = ANY($1::uuid[]))::int offices`,
        [[F.OX, F.OY, F.OZ], F.b2shifts || [], F.notes || []])).rows[0]);
      log(`s18 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
