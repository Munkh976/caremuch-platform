// UI S9 Weekly Billing on DEV through real logins (mirrors pglite/ui-s9.cjs): grants; the week read (default
// last complete week, bill by client x authorization with FIFO across two authorizations, a weekly cap, a
// 09:01 arrival = 1 unit lost, exclusions with reasons, pending review); the live writes (build / rebuild,
// approve with the bill's notes, mark billed); late reviews before approval / after approval / after billing;
// the billed lock (S8 actions and the caregiver's save refused); week read totals = the batch read's lines;
// audit rows without PHI; role and cross-office refusals; NB1.
// Usage: node tests/ripple/dev/ui-s9.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const NEW_FNS = ["get_billing_week", "list_billing_week_status"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [NEW_FNS])).rows);
  rec("ACL 2 reads SECURITY DEFINER + authenticated only (no PUBLIC/anon), one overload each", pass(acl.length === 2 && acl.every((f) => f.d && /authenticated=X/.test(f.acl) && !/(^|[{,])=X|anon=X/.test(f.acl))), acl.map((f) => `${f.proname} ${f.acl}`).join(" | "));
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 40 * 864e5).toISOString() }).eq("id", F.OX);
  const ws = await pgRead(async (c) => (await c.query(`SELECT (d - ((extract(isodow FROM d)::int - 1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date d) x`)).rows[0].ws);
  const at = async (k) => pgRead(async (c) => (await c.query(`SELECT ($1::date + $2::int)::text d`, [ws, k])).rows[0].d);
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await at(-30), expiration_date: await at(300) } });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-EARLY-${RUN}`, _units_authorized: 8, _effective_date: await at(-30), _expiration_date: await at(20) });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-LATE-${RUN}`, _units_authorized: 40, _effective_date: await at(-30), _expiration_date: await at(90), _period_type: "per_week", _units_per_period: 16 });
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }]);
  const sh = async (k, code = "CLS0001", start = "09:00", end = "10:00") => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: code, shift_date: await at(k), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "S9 fixture", _override_reason: "S9 fixture (disposable)" }); return id; };
  const note = async (shift, { off = 0, submit = true, narrative = null } = {}) => {
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: shift });
    const st = (await admin.from("progress_notes").select("scheduled_start").eq("id", n).single()).data.scheduled_start;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(st) + off * 1000).toISOString() }, _entries: [], _narrative_text: narrative });
    if (submit) await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
    return n; };
  const review = (n) => must(F.mgrX.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  const S = { a: await sh(0), b: await sh(1), c: await sh(2), d: await sh(3), e: await sh(4), f: await sh(5), g: await sh(6), h: await sh(6, "RESP0001", "11:00", "12:00") };
  const N = { a: await note(S.a), b: await note(S.b, { off: 60 }), c: await note(S.c), d: await note(S.d), e: await note(S.e), f: await note(S.f, { submit: false }), h: await note(S.h, { narrative: "Park visit." }) };
  for (const k of ["a", "b", "c"]) await review(N[k]);
  await must(F.mgrX.c, "return_progress_note", { _note_id: N.e, _reason: "Please add the reinforcers." });
  const reasons = (w) => Object.fromEntries(w.excluded.map((x) => [Object.keys(S).find((k) => S[k] === x.shift_id), x.reason]));
  const week = (c = F.mgrX.c) => must(c, "get_billing_week", { _office_id: F.OX, _week_start: ws });
  const w0 = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: null });
  rec("W0 default week = last complete week (Monday, office zone); no batch: reviewed notes 'not_in_bill_yet'", pass(w0.week_start === ws && w0.batch === null && reasons(w0).a === "not_in_bill_yet"), `${w0.week_start}; ${JSON.stringify(reasons(w0))}`);
  const t0 = await dbNow();
  await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws });
  const w1 = await week(); const line = (w, k) => w.lines.find((l) => l.authorization.auth_number === `ZZ-${k}-${RUN}`);
  const E = line(w1, "EARLY"), L = line(w1, "LATE"); const r1 = reasons(w1);
  rec("B1 bill: reviewed notes only, FIFO across two authorizations (EARLY: 09:00 + 09:01 = 8 scheduled / 7 billed / 1 lost to late arrival; LATE: the rollover), weekly cap 16 with 12 left, totals",
    pass(E && E.units_scheduled === 8 && E.units_billed === 7 && E.units_lost_late === 1 && L && L.notes.length === 1 && L.authorization.period_left === 12 && w1.totals.units_billed === 11 && w1.totals.units_lost_late === 1),
    `EARLY ${E && `${E.units_scheduled}/${E.units_billed}/${E.units_lost_late}`}; LATE ${L && `${L.units_billed}, left ${L.authorization.period_left}`}; totals ${JSON.stringify(w1.totals)}`);
  rec("X1 exclusions: not_reviewed, returned, not_submitted / overdue draft, no_note, no_authorization_fits (respite without authorization); pending review 2",
    pass(r1.d === "not_reviewed" && r1.e === "returned" && ["not_submitted", "overdue"].includes(r1.f) && r1.g === "no_note" && r1.h === "no_authorization_fits" && w1.pending_review === 2), `${JSON.stringify(r1)}; pending ${w1.pending_review}`);
  const gb = await must(F.mgrX.c, "get_billing_batch", { _batch_id: w1.batch.id });
  const gbTot = gb.lines.reduce((a, l) => ({ s: a.s + Number(l.units_scheduled), b: a.b + Number(l.units_billed), l: a.l + Number(l.units_lost_late) }), { s: 0, b: 0, l: 0 });
  rec("T1 the week read's totals equal the existing batch read's lines (scheduled / billed / lost to late)", pass(gbTot.s === w1.totals.units_scheduled && gbTot.b === w1.totals.units_billed && gbTot.l === w1.totals.units_lost_late), JSON.stringify(gbTot));
  await review(N.d);
  const lr1 = reasons(await week()).d; await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const w2 = await week();
  rec("LR1 reviewed after the build, before approval: 'not_in_bill_yet', then Build week picks it up", pass(lr1 === "not_in_bill_yet" && line(w2, "LATE").notes.length === 2), `before ${lr1}; LATE notes ${line(w2, "LATE").notes.length}`);
  const bad = await rpc(F.mgrX.c, "approve_batch_notes", { _batch_id: w2.batch.id, _note_ids: [N.e] });
  const earlyBill = await rpc(F.mgrX.c, "mark_batch_billed", { _batch_id: w2.batch.id });
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: w2.batch.id, _note_ids: w2.lines.flatMap((l) => l.notes.map((n) => n.note_id)) });
  const w3 = await week();
  rec("A1 approving an unreviewed note (not in the bill) and billing before approval are refused; Approve week (the bill's notes) -> approved",
    pass(/not in this batch/.test(bad.err || "") && /Approve every line/.test(earlyBill.err || "") && w3.batch.status === "approved"), `bad "${(bad.err || "ACCEPTED").slice(0, 30)}"; early bill "${(earlyBill.err || "ACCEPTED").slice(0, 30)}"; ${w3.batch.status}`);
  await must(F.cg.c, "submit_progress_note", { _note_id: N.e, _typed_signature: "ZZ Caregiver" }); await review(N.e);
  const rb = await rpc(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const lr2 = reasons(await week()).e;
  rec("LR2 (live) reviewed after approval: the rebuild is refused and the note shows 'reviewed_after_approval'", pass(/can't be rebuilt/.test(rb.err || "") && lr2 === "reviewed_after_approval"), `rebuild "${(rb.err || "ACCEPTED").slice(0, 45)}"; ${lr2}`);
  await must(F.mgrX.c, "mark_batch_billed", { _batch_id: w2.batch.id });
  await must(F.cg.c, "save_progress_note_draft", { _note_id: N.f, _header: {}, _entries: [], _narrative_text: null });
  await must(F.cg.c, "submit_progress_note", { _note_id: N.f, _typed_signature: "ZZ Caregiver" }); await review(N.f);
  const w5 = await week();
  const lock = { ret: await rpc(F.mgrX.c, "return_progress_note", { _note_id: N.a, _reason: "Billed note - try anyway" }), rev: await rpc(F.mgrX.c, "review_progress_note", { _note_id: N.a, _billable: true, _non_billable_reason: null }),
    cg: await rpc(F.cg.c, "save_progress_note_draft", { _note_id: N.a, _header: {}, _entries: [], _narrative_text: null }), rebuild: await rpc(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }) };
  const billedNotes = ((await admin.from("progress_notes").select("status").eq("billing_batch_id", w2.batch.id)).data || []).map((x) => x.status);
  rec("BL1 billed: batch billed (by, when), every bill note billed; S8 return / review, the caregiver's save and a rebuild refused; reviewed after billing stays out",
    pass(w5.batch.status === "billed" && !!w5.batch.billed_at && !!w5.batch.billed_by_name && billedNotes.every((s) => s === "billed") && Object.values(lock).every((x) => !!x.err) && reasons(w5).f === "reviewed_after_billing"),
    `${w5.batch.status}; notes ${billedNotes.join(",")}; refusals ${Object.entries(lock).map(([k, v]) => `${k}:${v.err ? "ok" : "ACCEPTED"}`).join(",")}; f ${reasons(w5).f}`);
  const ev = ((await admin.from("events").select("event_type, payload, created_at").eq("subject_id", w2.batch.id).gte("created_at", t0)).data || []);
  const types = ev.map((e) => e.event_type);
  rec("A2 audit: build, approve and billed events on the batch (existing types), payloads ids / counts only (no names, no text)",
    pass(types.includes("billing_batch_built") && types.includes("billing_batch_approved") && types.includes("billing_batch_billed") && !/ZZ|Park|reinforcers/.test(JSON.stringify(ev.map((e) => e.payload)))
      && ev.every((e) => Object.keys(e.payload).every((k) => ["batch_id", "included", "excluded", "approved", "remaining", "clean_only", "notes", "units"].includes(k)))), `${types.join(", ")}`);
  const st = (await must(F.mgrX.c, "list_billing_week_status", {})).find((x) => x.office_id === F.OX);
  rec("D1 dashboard status: office X last week billed", pass(st && st.status === "billed" && st.week_start === ws), JSON.stringify(st));
  const dl = []; let dn = 0;
  for (const [label, c] of [["hr_staff", F.hrX.c], ["scheduler", F.schX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]])
    for (const [fn, args] of [["get_billing_week", { _office_id: F.OX, _week_start: ws }], ["build_billing_batch", { _office_id: F.OX, _week_start: ws }], ["approve_batch_notes", { _batch_id: w2.batch.id, _note_ids: [N.a] }], ["mark_batch_billed", { _batch_id: w2.batch.id }]]) {
      const r = await rpc(c, fn, args); dn++; if (!r.err || !DENY.test(r.err)) dl.push(`${label}->${fn}: ${r.err || "ALLOWED"}`); }
  const yStatus = await must(F.mgrY.c, "list_billing_week_status", {});
  rec("R1 week read, build, approve and mark billed refused (generic) for hr_staff, scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; office Y's status list doesn't show X",
    pass(dl.length === 0 && !yStatus.some((x) => x.office_id === F.OX)), dl.join("; ") || `${dn} refused`);
}

(async () => {
  log(`=== UI S9 Weekly Billing — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const n = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [NEW_FNS])).rows[0].n);
      rec("B0 the 2 S9 reads are absent before the push", pass(n === 0), `${n}/2 present`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const { id } of (await admin.from("progress_notes").select("id").eq("client_id", F.CX)).data || []) await admin.from("events").delete().eq("subject_id", id);
      for (const { id } of (await admin.from("billing_batches").select("id").eq("virtual_office_id", F.OX)).data || []) await admin.from("events").delete().eq("subject_id", id);
      await teardownB2(F);
      for (const t of ["care_plans"]) await admin.from(t).delete().eq("client_id", F.CX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.progress_notes WHERE client_id = $1)::int notes,
        (SELECT count(*) FROM public.billing_batches WHERE virtual_office_id = ANY($2::uuid[]))::int batches,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($3::uuid[]))::int shifts,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [F.CX, [F.OX, F.OY, F.OZ], F.b2shifts || []])).rows[0]);
      log(`S9 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
