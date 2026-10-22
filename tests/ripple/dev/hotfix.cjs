// Security hotfix on DEV through real logins and the deployed Edge Functions (mirrors pglite/hotfix.cjs).
// `before`: the eligibility bodies as stored (md5), no match_caregiver_scope, log_event executable by anon; the gaps
//   reproduced: match-caregiver answers the public anon key with caregivers' contact fields; another agency's admin can
//   evaluate this office's shift; NB1.
// `after`: aclexplode; match-caregiver: anon / other office / other agency / HR / caregiver / client refused, manager and
//   scheduler in scope get matches with only id, name and rating; eligibility refusals (other agency, other office, a
//   caregiver about someone else); log_event refused for anon and users while the shift trigger still writes its event;
//   rag-eval-harness refuses the anon key; import-data refuses an agency admin (empty payload: harmless either way);
//   reset-database refuses the anon key (never called with an admin token); either may instead be not deployed (404); NB1.
// Usage: node tests/ripple/dev/hotfix.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const BEFORE = { check_assignment_eligibility: "34cb1b4efd4ab4796bf8be6df40ce68a", check_assignment_eligibility_bulk: "0cb743ebec33081caf0e8543c8457416" };
const cat = () => pgRead(async (c) => (await c.query(`SELECT p.proname n, md5(p.prosrc) h, p.prosecdef d,
    (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('check_assignment_eligibility','check_assignment_eligibility_bulk','match_caregiver_scope','cp_eligibility_caller_ok','log_event') ORDER BY 1`)).rows);
const token = async (c) => (await c.auth.getSession()).data.session.access_token;
async function fn(name, body, bearer) {
  const r = await fetch(`${URL_}/functions/v1/${name}`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}

async function fixtures(F) {
  F.b2shifts = [];
  F.S = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(9), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
  F.b2shifts.push(F.S);
  F.G2 = F.GX2;
}

async function before(F) {
  const f = await cat();
  const bad = Object.entries(BEFORE).filter(([n, h]) => !f.some((x) => x.n === n && x.h === h));
  const le = f.find((x) => x.n === "log_event");
  rec("B0 before: eligibility bodies as stored (md5), no match_caregiver_scope / cp_eligibility_caller_ok, log_event executable by PUBLIC and anon",
    pass(bad.length === 0 && !f.some((x) => x.n === "match_caregiver_scope" || x.n === "cp_eligibility_caller_ok") && /(^|,)-:EXECUTE/.test(le.acl) && /anon:EXECUTE/.test(le.acl)), `${bad.length ? "differ " + bad.map(([n]) => n) : "2/2"}; log_event ${le.acl}`);
  await fixtures(F);
  const m = await fn("match-caregiver", { shiftId: F.S }, ANON);
  const contact = (m.body?.matches || []).some((x) => x.caregiver && ("email" in x.caregiver || "phone" in x.caregiver));
  const cross = await rpc(F.aaB.c, "check_assignment_eligibility", { _shift_id: F.S, _caregiver_id: F.G });
  rec("B1 the gaps today: match-caregiver answers the public anon key (200) with contact fields; another agency's admin evaluates this office's shift",
    pass(m.status === 200 && contact && !cross.err), `anon ${m.status} contact ${contact}; other agency ${cross.err || "allowed"}`);
}

async function after(F) {
  const anon = createClient(URL_, ANON, opts);
  const f = await cat();
  const ok = (n) => { const x = f.find((y) => y.n === n); return x && x.d && /authenticated:EXECUTE/.test(x.acl) && !/(^|,)(-|anon):/.test(x.acl); };
  const le = f.find((x) => x.n === "log_event"), helper = f.find((x) => x.n === "cp_eligibility_caller_ok");
  rec("ACL (aclexplode): eligibility x2 + match_caregiver_scope authenticated only; cp_eligibility_caller_ok no API role; log_event service_role only; eligibility bodies changed",
    pass(ok("check_assignment_eligibility") && ok("check_assignment_eligibility_bulk") && ok("match_caregiver_scope") && helper && !/authenticated|anon|(^|,)-:/.test(helper.acl)
      && !/(^|,)(-|anon|authenticated):/.test(le.acl) && /service_role:EXECUTE/.test(le.acl) && Object.entries(BEFORE).every(([n, h]) => f.some((x) => x.n === n && x.h !== h))),
    f.map((x) => `${x.n} ${x.acl}`).join(" | "));
  await fixtures(F);
  const allowed = {};
  for (const [who, c] of [["mgrX", F.mgrX.c], ["schX", F.schX.c], ["aaA", F.aaA.c]]) allowed[who] = await fn("match-caregiver", { shiftId: F.S }, await token(c));
  const fields = [...new Set(Object.values(allowed).flatMap((r) => (r.body?.matches || []).flatMap((m) => Object.keys(m.caregiver || {}))))].sort().join(",");
  const refused = {};
  for (const [who, c] of [["mgrY", F.mgrY.c], ["aaB", F.aaB.c], ["hrX", F.hrX.c], ["cg", F.cg.c], ["cl", F.cl.c]]) refused[who] = (await fn("match-caregiver", { shiftId: F.S }, await token(c))).status;
  const anonM = await fn("match-caregiver", { shiftId: F.S }, ANON);
  rec("M1 match-caregiver: manager, scheduler and agency admin in scope get matches (caregiver fields only id, name, rating); anon 401; other office, other agency, HR, caregiver, client 403",
    pass(Object.values(allowed).every((r) => r.status === 200 && Array.isArray(r.body?.matches) && r.body.matches.length >= 1) && fields === "avg_rating,first_name,id,last_name,rating_count"
      && anonM.status === 401 && Object.values(refused).every((s) => s === 403)),
    `allowed ${Object.entries(allowed).map(([k, r]) => `${k}:${r.status}/${r.body?.matches?.length}`).join(" ")}; fields ${fields}; anon ${anonM.status}; refused ${JSON.stringify(refused)}`);
  const e = [];
  for (const [who, c, g] of [["aaB", F.aaB.c, F.G], ["mgrY", F.mgrY.c, F.G], ["cg-other", F.cg.c, F.G2], ["cl", F.cl.c, F.G]]) { const r = await rpc(c, "check_assignment_eligibility", { _shift_id: F.S, _caregiver_id: g }); if (r.err && DENY.test(r.err)) e.push(who); else log(`  not refused: ${who} ${r.err || "allowed"}`); }
  const mine = await rpc(F.cg.c, "check_assignment_eligibility", { _shift_id: F.S, _caregiver_id: F.G });
  const mgr = await rpc(F.mgrX.c, "check_assignment_eligibility", { _shift_id: F.S, _caregiver_id: F.G });
  const hr = await rpc(F.hrX.c, "check_assignment_eligibility_bulk", { _shift_id: F.S, _caregiver_ids: [F.G, F.G2] });
  rec("E1 eligibility: other agency, other office, a caregiver about another caregiver, a client refused (generic); the caregiver about themselves, the manager and HR (bulk) in scope allowed",
    pass(e.length === 4 && !mine.err && !mgr.err && !hr.err && (hr.v || []).length === 2), `refused ${e.join(",")}; self ${mine.err || "ok"}; mgr ${mgr.err || "ok"}; hr bulk ${hr.err || (hr.v || []).length}`);
  const la = await rpc(anon, "log_event", { _agency_id: A, _event_type: "shift_created" });
  const lu = await rpc(F.mgrX.c, "log_event", { _agency_id: A, _event_type: "shift_created" });
  const evs = ((await admin.from("events").select("event_type").eq("subject_id", F.S)).data || []).map((x) => x.event_type);
  rec("L1 log_event: refused for anon and signed-in users; the shift trigger still writes shift_created for the new shift",
    pass(/permission denied|not allowed|42501/i.test(la.err || "") && /permission denied|not allowed|42501/i.test(lu.err || "") && evs.includes("shift_created")),
    `anon ${(la.err || "ALLOWED").slice(0, 40)}; user ${(lu.err || "ALLOWED").slice(0, 40)}; trigger events ${evs.join(",")}`);
  const rag = await fn("rag-eval-harness", { query: "x", language: "en", agency_id: A }, ANON);
  const imp = await fn("import-data", { data: {} }, await token(F.aaA.c));
  const rst = await fn("reset-database", {}, ANON);
  // import-data / reset-database are undeployed on DEV (owner, Oct 22): "not deployed" (404) passes as well as "refused"
  const impOk = imp.status === 404 || (imp.status >= 400 && /permission|Insufficient/i.test(JSON.stringify(imp.body || {})));
  const rstOk = rst.status === 404 || rst.status >= 400;
  rec("X1 rag-eval-harness refuses the anon key (401); import-data refuses an agency admin (empty payload) or is not deployed; reset-database refuses the anon key (never called with an admin token) or is not deployed",
    pass(rag.status === 401 && impOk && rstOk),
    `rag ${rag.status}; import ${imp.status === 404 ? "404 not deployed" : `${imp.status} ${JSON.stringify(imp.body).slice(0, 60)}`}; reset ${rst.status === 404 ? "404 not deployed" : rst.status}`);
}

(async () => {
  log(`=== Security hotfix — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL === "before") await before(F); else await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) { for (const s of F.b2shifts || []) await admin.from("events").delete().eq("subject_id", s); await teardownB2(F); }
    await teardownB1(F); await teardown(F);
    await closeDb();
  }
  summary();
})();
