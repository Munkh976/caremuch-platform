// Demo UX Part 2 on DEV through real logins (mirrors pglite/undo-review.cjs): undo_progress_note_review + one events
// CHECK value. `before`: the function is absent; the events CHECK the rollback restores (md5, 51 values); the note,
// billing and units functions it relies on (md5, unchanged by the migration). `after`: ACL (aclexplode), CHECK 52
// values, those functions unchanged; undo before any bill (units back, note keeps its units, one audit row without
// PHI), review again / return; the caregiver still can't edit; an open bill drops the note (week read: not_reviewed,
// then not_in_bill_yet, rebuild); refused once approved / billed; role, office, agency and anon refusals; NB1.
// Usage: node tests/ripple/dev/undo-review.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const CHECK_BEFORE = "87db9d7dcd873069f5a9d6e4acc47bc5";   // md5(pg_get_constraintdef) of events_event_type_check before this migration (51 values; DEV, Oct 19)
const DEPS_MD5 = "cb7cb234794654ec0b86a77444fdcac8";       // the 17 functions below (signature, md5(prosrc), ACL), as on DEV before this migration (Oct 19)
const DEPS = ["review_progress_note", "return_progress_note", "submit_progress_note", "save_progress_note_draft", "void_progress_note", "build_billing_batch",
  "cp_approve_batch", "approve_batch_notes", "mark_batch_billed", "get_billing_week", "get_progress_note_for_staff", "cp_derive_progress_note_units",
  "cp_derive_authorization_units", "cp_refresh_authorization_units", "cp_guard_billed_note", "cp_audit", "cp_require_scope"];
const depsMd5 = () => pgRead(async (c) => (await c.query(`SELECT md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || COALESCE(p.proacl::text,''), '|' ORDER BY 1)) s
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [DEPS])).rows[0].s);
const checkInfo = () => pgRead(async (c) => (await c.query(`SELECT md5(pg_get_constraintdef(oid)) h, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`)).rows[0]);

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.prosecdef d, COALESCE(p.proacl::text,'') acl,
      (SELECT string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' ORDER BY 1) FROM aclexplode(p.proacl) a) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = 'undo_progress_note_review'`)).rows);
  rec("ACL undo_progress_note_review: SECURITY DEFINER, one overload; aclexplode: EXECUTE for authenticated, none for PUBLIC (grantee 0 / '-') or anon",
    pass(acl.length === 1 && acl[0].d && /authenticated:EXECUTE/.test(acl[0].x) && !/(^|,)(-|anon|public):/i.test(acl[0].x) && !/(^|[{,])=X|anon=X/.test(acl[0].acl)), acl.map((f) => f.x).join());
  const ck = await checkInfo(); const vals = ck.d.match(/'[a-z_]+'/g);
  rec("F0 events CHECK: 52 values incl. 'progress_note_review_undone'; the note / billing / units functions it relies on are unchanged (md5 + ACL)",
    pass(vals.length === 52 && vals.includes("'progress_note_review_undone'") && (await depsMd5()) === DEPS_MD5), `${vals.length} values; deps ${await depsMd5()}`);

  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.OX);
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  const auth = await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-UNDO-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  const wks = (await admin.from("virtual_office").select("billing_week_start").eq("id", F.OX).single()).data.billing_week_start;
  const today = await dbDay(0); const dow = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const plus = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const ws = plus(today, -(((dow - wks + 7) % 7) + 7));
  const sh = async (k, start) => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: plus(ws, k), start_time: start, end_time: `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`, duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "undo fixture", _override_reason: "undo fixture (disposable)" });
    return id; };
  const write = async (k, start = "09:00") => {
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: await sh(k, start) });
    const r = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: r.scheduled_start, actual_end: r.scheduled_end }, _entries: [], _narrative_text: null });
    await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
    (F.notes = F.notes || []).push(n); return n; };
  const review = (n) => must(F.mgrX.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  const undo = (n, c = F.mgrX.c) => rpc(c, "undo_progress_note_review", { _note_id: n });
  const row = async (n) => (await admin.from("progress_notes").select("status, authorization_id, reviewed_at, reviewed_by, units_used, billing_batch_id").eq("id", n).single()).data;
  const avail = async () => Number((await admin.from("service_authorizations").select("units_available").eq("id", auth).single()).data.units_available);
  const evs = async (n) => ((await admin.from("events").select("actor_id, payload, virtual_office_id").eq("event_type", "progress_note_review_undone").eq("subject_id", n)).data || []);
  const week = () => must(F.mgrX.c, "get_billing_week", { _office_id: F.OX, _week_start: ws });

  const N1 = await write(1), N2 = await write(2), N3 = await write(3);
  const av0 = await avail(); await review(N1); const av1 = await avail();
  const u1 = await undo(N1); const r1 = await row(N1); const e1 = await evs(N1);
  rec("U1 manager undoes a review before the week is built: Submitted, authorization / reviewer cleared, units back on the authorization, the note keeps its units; one audit row (actor, office; payload ids and counts only)",
    pass(!u1.err && r1.status === "submitted" && r1.authorization_id === null && r1.reviewed_at === null && r1.reviewed_by === null && Number(r1.units_used) === 4 && av1 === av0 - 4 && (await avail()) === av0
      && e1.length === 1 && e1[0].actor_id === F.mgrX.id && e1[0].virtual_office_id === F.OX && Object.keys(e1[0].payload).sort().join() === "authorization_id,note_id,removed_from_batch,units_restored"
      && !/ZZ|Caregiver/.test(JSON.stringify(e1[0].payload))), `${JSON.stringify(u1.v || u1.err)}; units ${av0} -> ${av1} -> ${await avail()}; events ${e1.length}`);
  const cgSave = await rpc(F.cg.c, "save_progress_note_draft", { _note_id: N1, _header: {}, _entries: [], _narrative_text: null });
  const cgUndo = await rpc(F.cg.c, "undo_progress_note_review", { _note_id: N1 });
  await review(N1);
  await review(N2); await must(F.aaA.c, "undo_progress_note_review", { _note_id: N2 });
  const ret = await rpc(F.mgrX.c, "return_progress_note", { _note_id: N2, _reason: "Please add the data for objective A" });
  rec("U2 the caregiver can't edit the undone (Submitted) note nor undo; the manager reviews it again; the agency admin can undo; from Submitted the note can be returned",
    pass(!!cgSave.err && !!cgUndo.err && (await row(N1)).status === "reviewed" && !ret.err && (await row(N2)).status === "returned"), `cg save: ${cgSave.err}; cg undo: ${cgUndo.err}; return ${ret.err || "ok"}`);

  await review(N3);
  const b0 = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws });
  const u3 = await undo(N3); const w1 = await week();
  const x1 = w1.excluded.find((x) => x.note_id === N3)?.reason;
  await review(N3); const w2 = await week(); const x2 = w2.excluded.find((x) => x.note_id === N3)?.reason;
  await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: ws }); const w3 = await week();
  rec("U3 week built, not approved: undo removes the note from the open bill now (audit names the bill); the week shows it 'not_reviewed' (pending review: Approve blocked); reviewed again -> 'not_in_bill_yet' (build again); rebuilt -> in the bill",
    pass(!u3.err && u3.v.removed_from_batch === b0.batch_id && Number(w1.batches[0].totals.notes) === b0.included - 1 && x1 === "not_reviewed" && w1.pending_review === 1
      && x2 === "not_in_bill_yet" && Number(w3.batches[0].totals.notes) === b0.included && (await evs(N3)).slice(-1)[0].payload.removed_from_batch === b0.batch_id),
    `bill ${b0.included} -> ${w1.batches[0].totals.notes} -> ${w3.batches[0].totals.notes}; ${x1} / ${x2}`);
  const ids = w3.batches[0].lines.flatMap((l) => l.notes.map((n) => n.note_id));
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: w3.batches[0].id, _note_ids: ids });
  const appr = await undo(N3); const avA = await avail();
  await must(F.mgrX.c, "mark_batch_billed", { _batch_id: w3.batches[0].id });
  const billed = await undo(N3);
  rec("U4 refused once the week is approved, and once billed, with the reason; note, units and audit unchanged",
    pass(/week is approved/.test(appr.err || "") && /billed/.test(billed.err || "") && (await row(N3)).status === "billed" && (await avail()) === avA && (await evs(N3)).length === 1),
    `approved: ${appr.err}; billed: ${billed.err}`);

  const N4 = await write(5); await review(N4);
  const n0 = ((await admin.from("events").select("id").eq("event_type", "progress_note_review_undone").eq("virtual_office_id", F.OX)).data || []).length;
  const refused = [];
  for (const [who, c] of [["mgrY", F.mgrY.c], ["aaB", F.aaB.c], ["schX", F.schX.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["cl", F.cl.c], ["sysA", F.sysA.c], ["anon", anon]]) {
    const r = await undo(N4, c); if (r.err && DENY.test(r.err)) refused.push(who); else log(`  not refused: ${who} ${r.err || JSON.stringify(r.v)}`);
  }
  const n1 = ((await admin.from("events").select("id").eq("event_type", "progress_note_review_undone").eq("virtual_office_id", F.OX)).data || []).length;
  rec("R1 refused (generic) for another office's manager, the other agency's admin, scheduler, hr_staff, caregiver, client, system_admin and anon; the note stays Reviewed; no audit row",
    pass(refused.length === 8 && (await row(N4)).status === "reviewed" && n1 === n0), `${refused.length}/8 (${refused.join(",")}); events ${n0} -> ${n1}`);
}

(async () => {
  log(`=== Undo note review — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const ck = await checkInfo();
      const fn = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'undo_progress_note_review'`)).rows[0].n);
      rec("B0 before: no undo_progress_note_review; the events CHECK the rollback restores (md5, 51 values); the note / billing / units functions (md5)",
        pass(fn === 0 && ck.h === CHECK_BEFORE && ck.d.match(/'[a-z_]+'/g).length === 51 && (await depsMd5()) === DEPS_MD5), `fn ${fn}; check ${ck.h}; deps ${await depsMd5()}`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const n of F.notes || []) await admin.from("events").delete().eq("subject_id", n);
      for (const { id: b } of (await admin.from("billing_batches").select("id").eq("virtual_office_id", F.OX)).data || []) await admin.from("events").delete().eq("subject_id", b);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR subject_id = ANY($3::uuid[]))::int ev,
        (SELECT count(*) FROM public.progress_notes WHERE id = ANY($3::uuid[]))::int notes, (SELECT count(*) FROM public.billing_batches WHERE virtual_office_id = ANY($1::uuid[]))::int batches,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($2::uuid[]))::int shifts, (SELECT count(*) FROM public.virtual_office WHERE id = ANY($1::uuid[]))::int offices`,
        [[F.OX, F.OY, F.OZ], F.b2shifts || [], F.notes || []])).rows[0]);
      log(`undo teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
