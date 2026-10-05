// W2 void on DEV (owner approval, round 3 review). Usage: node tests/ripple/dev/w2-void.cjs <before|after>
//   before: no void columns / function; the auth-number table constraint is still there; NB1
//   after : void rules through real logins (pending projection, charged note, schedule line, reason,
//           denials), audit, readers skip voided (eligibility projection via the units table + onboarding
//           + risk list + review), number re-entry, ACLs; NB1
// DEV run: disposable fixtures, verified teardown.
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");

async function before() {
  const r = await pgRead(async (c) => (await c.query(`SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='service_authorizations' AND column_name LIKE 'void%')::int cols,
      (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='void_service_authorization')::int fn,
      (SELECT count(*) FROM pg_constraint WHERE conname='service_authorizations_agency_id_auth_number_key')::int con`)).rows[0]);
  rec("B0 before the push: no void columns, no void function, the auth-number table constraint present", pass(r.cols === 0 && r.fn === 0 && r.con === 1), JSON.stringify(r));
}

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const cat = await pgRead(async (c) => (await c.query(`SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='service_authorizations' AND column_name LIKE 'void%')::int cols,
      (SELECT count(*) FROM pg_constraint WHERE conname='service_authorizations_agency_id_auth_number_key')::int con,
      (SELECT count(*) FROM pg_indexes WHERE indexname='service_authorizations_active_number_key')::int idx,
      (SELECT COALESCE(proacl::text,'') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='void_service_authorization') acl,
      (SELECT prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='void_service_authorization') d`)).rows[0]);
  rec("A0 schema + ACL: 3 void columns, partial unique index (old constraint gone); void_service_authorization SECURITY DEFINER + authenticated, no PUBLIC/anon",
    pass(cat.cols === 3 && cat.con === 0 && cat.idx === 1 && cat.d && /authenticated=X/.test(cat.acl) && !/(^|[{,])=X|anon=X/.test(cat.acl)), JSON.stringify(cat));
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const auth = async (client, num, eff, exp) => must(F.mgrX.c, "create_service_authorization", { _client_id: client, _service_type: "cls", _auth_number: `${num}-${RUN}`,
    _units_authorized: 40, _effective_date: eff, _expiration_date: exp });
  // CX: shifts 0-2 (Nov 2-4) are assigned by NB1 -> pending on the authorization valid then
  const pendAuth = await auth(F.CX, "ZZ-P", await dbDay(-10), "2026-11-30");
  const pend = await rpc(F.mgrX.c, "void_service_authorization", { _id: pendAuth, _reason: "mistake" });
  const CV = await ins("clients", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `Void ${RUN}`, phone: "555-0176", address: "1 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.extraClients = [CV];
  const noteAuth = await auth(CV, "ZZ-N", await dbDay(-10), await dbDay(100));
  await ins("progress_notes", { agency_id: A, virtual_office_id: F.OX, client_id: CV, caregiver_id: F.G, authorization_id: noteAuth, note_kind: "cls", service_type: "cls",
    service_date: await dbDay(-2), units_scheduled: 4, billable: true, status: "draft", voided: true });
  const charged = await rpc(F.mgrX.c, "void_service_authorization", { _id: noteAuth, _reason: "mistake" });
  const free = await auth(CV, "ZZ-F", await dbDay(-10), await dbDay(30));
  const units0 = (await must(F.mgrX.c, "get_client_authorizations", { _client_id: CV })).authorizations.find((x) => x.id === free);
  const onb0 = (await must(F.mgrX.c, "get_client_onboarding_status", { _client_id: CV })).items.find((i) => i.key === "authorization").status;
  const dl = []; let dn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    const r = await rpc(c, "void_service_authorization", { _id: free, _reason: "x" }); dn++; if (!r.err || !DENY.test(r.err)) dl.push(`${label}: ${r.err || "ALLOWED"}`); }
  const noReason = await rpc(F.mgrX.c, "void_service_authorization", { _id: free, _reason: " " });
  rec("A1 refused: pending projection on it; a note referencing it (even voided); no reason; 8 other roles/scopes (generic). void_available shown true for the unused one",
    pass(/Scheduled visits are counted/.test(pend.err || "") && /Visits were charged/.test(charged.err || "") && /reason/.test(noReason.err || "") && dl.length === 0 && units0.void_available === true),
    [pend, charged, noReason].map((x) => (x.err || "ACCEPTED").slice(0, 40)).join(" | ") + `; ${dl.join("; ") || `${dn} refused`}; void_available ${units0.void_available}`);
  // ZZ-N is the other active one; void ZZ-F
  const ok = await rpc(F.mgrX.c, "void_service_authorization", { _id: free, _reason: "Entered for the wrong client" });
  const row = (await admin.from("service_authorizations").select("voided_at, voided_by, void_reason").eq("id", free).single()).data;
  const ev = (await admin.from("events").select("payload, actor_id").eq("subject_id", free).eq("event_type", "authorization_voided")).data;
  const units1 = (await must(F.mgrX.c, "get_client_authorizations", { _client_id: CV })).authorizations;
  const risk = await must(F.mgrX.c, "list_authorization_risk", { _office_id: F.OX, _within_days: 60 });
  rec("A2 voided with who/why, audited once with the reason; the units table and the risk list drop it",
    pass(!ok.err && !!row.voided_at && row.voided_by === F.mgrX.id && row.void_reason === "Entered for the wrong client" && ev.length === 1 && ev[0].payload.reason === "Entered for the wrong client"
      && !units1.some((x) => x.id === free) && !risk.some((r) => r.authorization_id === free)), `${ok.err || "voided"}; events ${ev.length}; units rows ${units1.length}; in risk ${risk.some((r) => r.authorization_id === free)}`);
  // only-voided client: onboarding + review
  const CO = await ins("clients", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `OnlyVoid ${RUN}`, phone: "555-0177", address: "1 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.extraClients.push(CO);
  const only = await auth(CO, "ZZ-O", await dbDay(-10), await dbDay(100));
  const onbBefore = (await must(F.mgrX.c, "get_client_onboarding_status", { _client_id: CO })).items.find((i) => i.key === "authorization").status;
  await must(F.mgrX.c, "void_service_authorization", { _id: only, _reason: "duplicate" });
  const onbAfter = (await must(F.mgrX.c, "get_client_onboarding_status", { _client_id: CO })).items.find((i) => i.key === "authorization").status;
  const note = await ins("progress_notes", { agency_id: A, virtual_office_id: F.OX, client_id: CO, caregiver_id: F.G, note_kind: "cls", service_type: "cls",
    service_date: await dbDay(-1), units_scheduled: 4, billable: true, status: "submitted" });
  const rev = await rpc(F.mgrX.c, "review_progress_note", { _note_id: note, _billable: true, _non_billable_reason: null });
  const cor = await rpc(F.mgrX.c, "correct_service_authorization", { _id: only, _changes: { units_authorized: 50 }, _reason: "x" });
  const reenter = await rpc(F.mgrX.c, "create_service_authorization", { _client_id: CO, _service_type: "cls", _auth_number: `zz-o-${RUN}`, _units_authorized: 10, _effective_date: await dbDay(0), _expiration_date: await dbDay(50) });
  const dup = await rpc(F.mgrX.c, "create_service_authorization", { _client_id: CO, _service_type: "cls", _auth_number: `ZZ-O-${RUN}`, _units_authorized: 10, _effective_date: await dbDay(0), _expiration_date: await dbDay(50) });
  rec("A3 readers skip voided: onboarding authorization complete -> missing; review: 'no authorization for this service'; correcting a voided one refused; its number re-entered (case-insensitive), not twice",
    pass(onb0 === "complete" && onbBefore === "complete" && onbAfter === "missing" && /no authorization for this service/.test(rev.err || "") && /was voided/.test(cor.err || "") && !reenter.err && /already exists/.test(dup.err || "")),
    `onboarding ${onbBefore}->${onbAfter}; review "${(rev.err || "ACCEPTED").slice(0, 60)}"; correct "${(cor.err || "ACCEPTED").slice(0, 30)}"; re-enter ${reenter.err || "ok"}; dup "${(dup.err || "ACCEPTED").slice(0, 30)}"`);
}

(async () => {
  log(`=== W2 void — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL === "before") await before(); else await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const c of [F.CX, ...(F.extraClients || [])]) { await admin.from("progress_notes").delete().eq("client_id", c);
        for (const { id } of (await admin.from("service_authorizations").select("id").eq("client_id", c)).data || []) await admin.from("events").delete().eq("subject_id", id);
        await admin.from("service_authorizations").delete().eq("client_id", c); }
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.service_authorizations WHERE auth_number ILIKE $1)::int auths,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [`%${RUN}`, [F.OX, F.OY, F.OZ]])).rows[0]);
      log(`W2 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();
