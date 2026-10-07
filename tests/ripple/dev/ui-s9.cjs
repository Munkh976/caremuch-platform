// UI S9 + S9b Weekly Billing on DEV through real logins (mirrors pglite/ui-s9.cjs + ui-s9b.cjs): S9b reopen after approval, supplements 1 and 2,
// no note in two batches, units charged once, per-batch totals; grants; the week read (default
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
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-LATE-${RUN}`, _units_authorized: 40, _effective_date: await at(-30), _expiration_date: await at(90), _period_type: "per_week", _units_per_period: 24 });
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }]);
  const sh = async (k, code = "CLS0001", start = "09:00", end = "10:00") => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: code, shift_date: await at(k), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "S9 fixture", _override_reason: "S9 fixture (disposable)" }); return id; };
  const note = async (shift, { off = 0, submit = true, narrative = null } = {}) => {
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: shift });
    const { scheduled_start: st, scheduled_end: se } = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(st) + off * 1000).toISOString(), actual_end: se }, _entries: [], _narrative_text: narrative });
    if (submit) await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
    return n; };
  const review = (n) => must(F.mgrX.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  const S = { a: await sh(0), b: await sh(1), c: await sh(2), d: await sh(3), e: await sh(4), f: await sh(5), g: await sh(6), h: await sh(6, "RESP0001", "11:00", "12:00") };
  const N = { a: await note(S.a), b: await note(S.b, { off: 60 }), c: await note(S.c), d: await note(S.d), e: await note(S.e), f: await note(S.f, { submit: false }), h: await note(S.h, { narrative: "Park visit." }) };
  for (const k of ["a", "b", "c"]) await review(N[k]);
  await must(F.mgrX.c, "return_progress_note", { _note_id: N.e, _reason: "Please add the reinforcers." });
  const reasons = (w) => Object.fromEntries(w.excluded.map((x) => [Object.keys(S).find((k) => S[k] === x.shift_id), x.reason]));
  const week = (c = F.mgrX.c) => must(c, "get_billing_week", { _office_id: F.OX, _week_start: ws });
  const main = (w) => w.batches.find((b) => b.supplement === 0) || null;
  const lineOf = (b, k) => b.lines.find((l) => l.authorization.auth_number === `ZZ-${k}-${RUN}`);
  const noteIds = (b) => b.lines.flatMap((l) => l.notes.map((n) => n.note_id));
  const w0 = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: null });
  rec("W0 default week = last complete week (Monday, office zone); no batch: reviewed notes 'not_in_bill_yet'; next action 'build'",
    pass(w0.week_start === ws && w0.batches.length === 0 && w0.next_action === "build" && reasons(w0).a === "not_in_bill_yet"), `${w0.week_start}; ${w0.next_action}; ${JSON.stringify(reasons(w0))}`);
  const t0 = await dbNow();
  await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws });
  const w1 = await week(); const m1 = main(w1);
  const E = lineOf(m1, "EARLY"), L = lineOf(m1, "LATE"); const r1 = reasons(w1);
  rec("B1 bill: reviewed notes only, FIFO across two authorizations (EARLY: 09:00 + 09:01 = 8 scheduled / 7 billed / 1 lost to late arrival; LATE: the rollover), weekly cap 24 with 20 left, totals",
    pass(E && E.units_scheduled === 8 && E.units_billed === 7 && E.units_lost_late === 1 && L && L.notes.length === 1 && L.authorization.period_left === 20 && m1.totals.units_billed === 11 && m1.totals.units_lost_late === 1),
    `EARLY ${E && `${E.units_scheduled}/${E.units_billed}/${E.units_lost_late}`}; LATE ${L && `${L.units_billed}, left ${L.authorization.period_left}`}; totals ${JSON.stringify(m1.totals)}`);
  rec("X1 exclusions: not_reviewed, returned, not_submitted / overdue draft, no_note, no_authorization_fits (respite without authorization); pending review 2",
    pass(r1.d === "not_reviewed" && r1.e === "returned" && ["not_submitted", "overdue"].includes(r1.f) && r1.g === "no_note" && r1.h === "no_authorization_fits" && w1.pending_review === 2), `${JSON.stringify(r1)}; pending ${w1.pending_review}`);
  const perBatch = async (b) => { const gb = await must(F.mgrX.c, "get_billing_batch", { _batch_id: b.id });
    const t = gb.lines.reduce((a, l) => ({ s: a.s + Number(l.units_scheduled), b: a.b + Number(l.units_billed), l: a.l + Number(l.units_lost_late) }), { s: 0, b: 0, l: 0 });
    return t.s === b.totals.units_scheduled && t.b === b.totals.units_billed && t.l === b.totals.units_lost_late; };
  rec("T1 the week read's totals equal the existing batch read's lines (scheduled / billed / lost to late)", pass(await perBatch(m1)), JSON.stringify(m1.totals));
  await review(N.d);
  const lr1 = reasons(await week()).d; await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const w2 = await week(); const m2 = main(w2);
  rec("LR1 reviewed after the build, before approval: 'not_in_bill_yet', then Build week picks it up", pass(lr1 === "not_in_bill_yet" && lineOf(m2, "LATE").notes.length === 2), `before ${lr1}; LATE notes ${lineOf(m2, "LATE").notes.length}`);
  const bad = await rpc(F.mgrX.c, "approve_batch_notes", { _batch_id: m2.id, _note_ids: [N.e] });
  const earlyBill = await rpc(F.mgrX.c, "mark_batch_billed", { _batch_id: m2.id });
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: m2.id, _note_ids: noteIds(m2) });
  const w3 = await week();
  rec("A1 approving an unreviewed note (not in the bill) and billing before approval are refused; Approve week (the bill's notes) -> approved",
    pass(/not in this batch/.test(bad.err || "") && /Approve every line/.test(earlyBill.err || "") && main(w3).status === "approved"), `bad "${(bad.err || "ACCEPTED").slice(0, 30)}"; early bill "${(earlyBill.err || "ACCEPTED").slice(0, 30)}"; ${main(w3).status}`);
  // S9b (a): reviewed after approval -> Build week again reopens -> re-approve
  await must(F.cg.c, "submit_progress_note", { _note_id: N.e, _typed_signature: "ZZ Caregiver" }); await review(N.e);
  const w4a = await week(); const lr2 = reasons(w4a).e;
  const rb = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const w4 = await week(); const m4 = main(w4);
  const approvedLeft = ((await admin.from("progress_notes").select("batch_approved_at").eq("billing_batch_id", m4.id)).data || []).filter((x) => x.batch_approved_at).length;
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: m4.id, _note_ids: noteIds(m4) });
  const reapproved = main(await week()).status;
  rec("S9b-A reviewed after approval: 'reviewed_after_approval', next action 'reopen'; Build week again reopens the main bill (approvals cleared, the note added, open), then approve again",
    pass(lr2 === "reviewed_after_approval" && w4a.next_action === "reopen" && rb.reopened === true && rb.supplement === 0 && w4.batches.length === 1 && m4.status === "open"
      && noteIds(m4).includes(N.e) && approvedLeft === 0 && reapproved === "approved"), `reason ${lr2}; next ${w4a.next_action}; reopened ${rb.reopened}; approvals after reopen ${approvedLeft}; re-approved ${reapproved}`);
  // billed
  await must(F.mgrX.c, "mark_batch_billed", { _batch_id: m4.id });
  const lock = { ret: await rpc(F.mgrX.c, "return_progress_note", { _note_id: N.a, _reason: "Billed note - try anyway" }), rev: await rpc(F.mgrX.c, "review_progress_note", { _note_id: N.a, _billable: true, _non_billable_reason: null }),
    cg: await rpc(F.cg.c, "save_progress_note_draft", { _note_id: N.a, _header: {}, _entries: [], _narrative_text: null }),
    nothing: await rpc(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }) };
  const w5 = await week(); const billedNotes = ((await admin.from("progress_notes").select("status").eq("billing_batch_id", m4.id)).data || []).map((x) => x.status);
  rec("BL1 billed: main bill billed (by, when), every note billed; S8 return / review and the caregiver's save refused; with nothing waiting a rebuild is refused",
    pass(main(w5).status === "billed" && !!main(w5).billed_at && !!main(w5).billed_by_name && billedNotes.every((x) => x === "billed") && Object.values(lock).every((x) => !!x.err) && /no reviewed note is waiting/.test(lock.nothing.err || "")),
    `notes ${billedNotes.join(",")}; refusals ${Object.entries(lock).map(([k, v]) => `${k}:${v.err ? "ok" : "ACCEPTED"}`).join(",")}`);
  // S9b (b): billed + late review -> supplement 1 -> approve -> billed -> locked; a second late note -> supplement 2
  const av = async () => ((await admin.from("service_authorizations").select("units_authorized, units_available").eq("client_id", F.CX)).data || []).reduce((a, x) => a + Number(x.units_authorized) - Number(x.units_available), 0);
  await must(F.cg.c, "save_progress_note_draft", { _note_id: N.f, _header: {}, _entries: [], _narrative_text: null });
  await must(F.cg.c, "submit_progress_note", { _note_id: N.f, _typed_signature: "ZZ Caregiver" }); await review(N.f);
  const w6a = await week(); const st6 = (await must(F.mgrX.c, "list_billing_week_status", {})).find((x) => x.office_id === F.OX); const used6 = await av();
  const s1 = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const w6 = await week(); const b1 = w6.batches.find((b) => b.supplement === 1);
  rec("S9b-B1 billed week + a later review: 'reviewed_after_billing', next 'supplement', dashboard 'supplement_needed'; Build creates supplement 1 with only that note; units unchanged by the build",
    pass(reasons(w6a).f === "reviewed_after_billing" && w6a.next_action === "supplement" && st6.status === "supplement_needed" && s1.supplement === 1 && b1 && noteIds(b1).join() === N.f && (await av()) === used6),
    `reason ${reasons(w6a).f}; next ${w6a.next_action}; dashboard ${st6.status}; s1 notes ${b1 && noteIds(b1).length}; units used ${used6} -> ${await av()}`);
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: b1.id, _note_ids: noteIds(b1) }); await must(F.mgrX.c, "mark_batch_billed", { _batch_id: b1.id });
  const lockF = await rpc(F.mgrX.c, "return_progress_note", { _note_id: N.f, _reason: "Billed in the supplement" });
  const n7 = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: S.g });
  const st7 = (await admin.from("progress_notes").select("scheduled_start").eq("id", n7).single()).data.scheduled_start;
  await must(F.cg.c, "save_progress_note_draft", { _note_id: n7, _header: { client_arrived_at: st7, actual_end: (await admin.from("progress_notes").select("scheduled_end").eq("id", n7).single()).data.scheduled_end }, _entries: [], _narrative_text: null });
  await must(F.cg.c, "submit_progress_note", { _note_id: n7, _typed_signature: "ZZ Caregiver" }); await review(n7);
  const s2 = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const w7 = await week(); const b2 = w7.batches.find((b) => b.supplement === 2);
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: b2.id, _note_ids: noteIds(b2) }); await must(F.mgrX.c, "mark_batch_billed", { _batch_id: b2.id });
  const w8 = await week(); const st8 = (await must(F.mgrX.c, "list_billing_week_status", {})).find((x) => x.office_id === F.OX);
  rec("S9b-B2 supplement 1 approved, billed, its note locked; a second late note -> supplement 2 -> billed; dashboard 'billed' with 2 supplements",
    pass(!!lockF.err && w8.batches.find((b) => b.supplement === 1).status === "billed" && s2.supplement === 2 && noteIds(b2).join() === n7 && w8.batches.find((b) => b.supplement === 2).status === "billed" && st8.status === "billed" && st8.supplements === 2),
    `lock ${lockF.err ? "refused" : "ACCEPTED"}; s2 ${s2.supplement}; dashboard ${st8.status}/${st8.supplements}`);
  const all = (await admin.from("progress_notes").select("id, billing_batch_id, units_used, billable, status").eq("client_id", F.CX)).data || [];
  const inBatches = all.filter((x) => w8.batches.some((b) => b.id === x.billing_batch_id));
  const listed = w8.batches.flatMap(noteIds);
  const charged = await av(); const notesUnits = all.filter((x) => x.billable && ["reviewed", "billed"].includes(x.status)).reduce((a, x) => a + Number(x.units_used), 0);
  rec("C1 no note sits in two batches (each billed note listed once across main + 2 supplements); units charged once (authorization use = the reviewed notes' units)",
    pass(listed.length === new Set(listed).size && listed.length === inBatches.length && charged === notesUnits), `listed ${listed.length} unique ${new Set(listed).size}; charged ${charged}, notes ${notesUnits}`);
  const tots = []; for (const b of w8.batches) tots.push(await perBatch(b));
  rec("T2 per batch (main, s1, s2) the totals equal the batch read's lines (what the CSV is built from)", pass(tots.every(Boolean) && tots.length === 3), tots.join(","));
  const ev = ((await admin.from("events").select("event_type, payload").in("subject_id", w8.batches.map((b) => b.id)).gte("created_at", t0)).data || []);
  const types = ev.map((e) => e.event_type);
  rec("AU1 audit: builds (incl. reopened / supplement flags), approvals and billings on all three batches (existing types), ids / counts / flags only (no names, no text)",
    pass(types.filter((x) => x === "billing_batch_billed").length === 3 && ev.some((e) => e.payload.reopened === true) && ev.some((e) => e.payload.supplement === 2) && !/ZZ|Park|reinforcers/.test(JSON.stringify(ev.map((e) => e.payload)))
      && ev.every((e) => Object.keys(e.payload).every((k) => ["batch_id", "included", "excluded", "approved", "remaining", "clean_only", "notes", "units", "supplement", "reopened"].includes(k)))), `${ev.length} events: ${[...new Set(types)].join(", ")}`);
  const dl = []; let dn = 0;
  for (const [label, c] of [["hr_staff", F.hrX.c], ["scheduler", F.schX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]])
    for (const [fn, args] of [["get_billing_week", { _office_id: F.OX, _week_start: ws }], ["build_billing_batch", { _office_id: F.OX, _week_start: ws }], ["approve_batch_notes", { _batch_id: b2.id, _note_ids: [n7] }], ["mark_batch_billed", { _batch_id: b2.id }]]) {
      const r = await rpc(c, fn, args); dn++; if (!r.err || !DENY.test(r.err)) dl.push(`${label}->${fn}: ${r.err || "ALLOWED"}`); }
  const yStatus = await must(F.mgrY.c, "list_billing_week_status", {});
  rec("R1 week read, build (reopen / supplement), approve and mark billed refused (generic) for hr_staff, scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; office Y's status doesn't show X",
    pass(dl.length === 0 && !yStatus.some((x) => x.office_id === F.OX)), dl.join("; ") || `${dn} refused`);
  // ---- S12 (B): Ripple's billing week is Sunday–Saturday (Q11). The existing per-office setting (billing_week_start, ISO 7 =
  // Sunday), set by the agency admin; earlier weeks than the Monday checks above, so nothing overlaps their bills. ----
  const { error: wkErr } = await F.aaA.c.from("virtual_office").update({ billing_week_start: 7 }).eq("id", F.OX);
  if (wkErr) throw new Error(`week start: ${wkErr.message}`);
  const kdd = await pgRead(async (c) => (await c.query(`WITH t AS (SELECT (now() AT TIME ZONE 'America/New_York')::date d), s AS (SELECT d - (extract(isodow FROM d)::int % 7) - 7 AS last_sun FROM t)
    SELECT last_sun::text ls, (last_sun - 14)::text s2, (last_sun - 13)::text mon2,
      (SELECT w::date::text FROM generate_series(last_sun - 21, last_sun - 70, '-7 days'::interval) w WHERE extract(month FROM w) <> extract(month FROM w + interval '6 days') LIMIT 1) m
    FROM s`)).rows[0]);
  const kplus = (d, k) => pgRead(async (c) => (await c.query(`SELECT ($1::date + $2::int)::text d`, [d, k])).rows[0].d);
  const kmonthEdge = await pgRead(async (c) => (await c.query(`SELECT (date_trunc('month', $1::date + 6) - interval '1 day')::date::text last, date_trunc('month', $1::date + 6)::date::text first`, [kdd.m])).rows[0]);
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-SUN-${RUN}`, _units_authorized: 400, _effective_date: await kplus(kdd.m, -7), _expiration_date: await kplus(kdd.ls, 90) });
  const kshd = async (date) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: date, start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "S12 week fixture", _override_reason: "S12 week fixture (disposable)" }); return id; };
  const ksat = await kplus(kdd.s2, 6), ksun = await kplus(kdd.s2, 7);
  const kW = { sat: await note(await kshd(ksat)), sun: await note(await kshd(ksun)), last: await note(await kshd(kmonthEdge.last)), first: await note(await kshd(kmonthEdge.first)) };
  for (const k of ["sat", "sun", "last", "first"]) await review(kW[k]);
  const kdef = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX });
  const kisodow = (d) => pgRead(async (c) => (await c.query(`SELECT extract(isodow FROM $1::date)::int n`, [d])).rows[0].n);
  const kmon = await rpc(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: kdd.mon2 });
  const kst = (await must(F.mgrX.c, "list_billing_week_status", {})).find((x) => x.office_id === F.OX);
  rec("SW0 Sunday-start office: the default 'last complete week' is Sunday–Saturday (week picker / dashboard line follow it); a Monday start is refused",
    pass(kdef.week_start === kdd.ls && (await kisodow(kdef.week_start)) === 7 && (await kisodow(kdef.week_end)) === 6 && kdef.office.billing_week_start === 7 && kst.week_start === kdd.ls && !!kmon.err && /ISO day 7/.test(kmon.err)),
    `default ${kdef.week_start}..${kdef.week_end}; dashboard ${kst.week_start}; Monday ${kmon.err}`);
  await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: kdd.s2 });
  const kw2 = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: kdd.s2 });
  const kids2 = noteIds(kw2.batches[0]);
  const kw3 = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: ksun });
  rec("SW1 Saturday/Sunday boundary: the Saturday visit is in the Sun–Sat week's bill, the next day (Sunday) starts the next week (not_in_bill_yet there)",
    pass(kw2.week_end === ksat && kids2.includes(kW.sat) && !kids2.includes(kW.sun) && kw3.excluded.some((x) => x.note_id === kW.sun && x.reason === "not_in_bill_yet")), `${kw2.week_start}..${kw2.week_end}: ${kids2.length} note(s)`);
  await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: kdd.m });
  const kwm = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: kdd.m }); const kidm = noteIds(kwm.batches[0]);
  rec("SW2 a week across a month boundary (Sun–Sat): the last day of the month and the first of the next are in the same bill",
    pass(kwm.week_end === await kplus(kdd.m, 6) && kidm.includes(kW.last) && kidm.includes(kW.first)), `${kwm.week_start}..${kwm.week_end} (${kmonthEdge.last} / ${kmonthEdge.first})`);
  const kb2 = kw2.batches[0];
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: kb2.id, _note_ids: kids2 }); await must(F.mgrX.c, "mark_batch_billed", { _batch_id: kb2.id });
  const klate = await note(await kshd(await kplus(kdd.s2, 3))); await review(klate);
  const kw4 = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: kdd.s2 });
  const ksup = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: kdd.s2 });
  const kw5 = await must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: kdd.s2 });
  rec("SW3 supplements follow the office's week: a Sun–Sat week billed, a note of that week reviewed later -> supplement 1 for the same Sunday week",
    pass(kw4.next_action === "supplement" && ksup.supplement === 1 && kw5.batches.length === 2 && noteIds(kw5.batches[1]).join() === klate), `${kw4.next_action}; supplement ${ksup.supplement}`);

}

(async () => {
  log(`=== UI S9 Weekly Billing — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      // S9 itself is live; "before" now gates S9b (20261022120000): the pre-S9b schema and function bodies
      const s = await pgRead(async (c) => (await c.query(`SELECT
          (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_batches' AND column_name='supplement') col,
          (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='billing_batches_virtual_office_id_week_start_key') uq,
          (SELECT json_object_agg(proname, md5(prosrc)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('build_billing_batch','get_billing_week','list_billing_week_status')) h`)).rows[0]);
      rec("B0 before S9b: no supplement column, the one-batch-per-week unique constraint, the three bodies the rollback restores (md5)",
        pass(s.col === 0 && s.uq === "UNIQUE (virtual_office_id, week_start)" && s.h.build_billing_batch === "5ac05000b721c324c463757ff77b011e" && s.h.get_billing_week === "2efc8f40105da7a0bf12ac5a927642f4" && s.h.list_billing_week_status === "e80f555a97ed6b509d22aa9ab5886066"),
        JSON.stringify(s));
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
