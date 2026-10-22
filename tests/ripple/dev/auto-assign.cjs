// Auto-assign + Smart Assign scoring on DEV through real logins (mirrors pglite/auto-assign.cjs).
// `before` (run with RIPPLE_WRITE_NOBREAK_BASELINE=1): none of the new functions; NB1 baseline.
// `after` (run with RIPPLE_NB1_HASHES=1: assign / eligibility functions byte-identical): aclexplode; for an office with
//   default weights suggest_caregivers equals the deployed match-caregiver (same caregivers, scores, reasons); office
//   weights (agency admin only, audited); propose is read-only and gives overlapping visits on one date to different
//   caregivers; commit assigns through the existing path (auto_assigned, shift_assigned events) with one auto_assign_run;
//   roles refused; NB1.
// Usage: node tests/ripple/dev/auto-assign.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const NEW = ["set_office_match_weights", "suggest_caregivers", "propose_auto_assignments", "commit_auto_assignments", "cp_match_factors", "cp_office_match_weights",
  "cp_gate_issues", "cp_client_gate", "cp_shift_candidates", "cp_unassigned_shifts", "cp_default_match_weights", "cp_valid_match_weights"];
const cat = () => pgRead(async (c) => (await c.query(`SELECT p.proname n, p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [NEW])).rows);
const token = async (c) => (await c.auth.getSession()).data.session.access_token;

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const f = await cat();
  const api = ["set_office_match_weights", "suggest_caregivers", "propose_auto_assignments", "commit_auto_assignments"];
  rec("ACL (aclexplode): 4 API functions SECURITY DEFINER, authenticated only; 8 helpers no API role",
    pass(f.length === 12 && api.every((n) => { const x = f.find((y) => y.n === n); return x && x.d && /authenticated:EXECUTE/.test(x.acl) && !/(^|,)(-|anon):/.test(x.acl); })
      && f.filter((x) => !api.includes(x.n)).every((x) => !/(^|,)(-|anon|authenticated):/.test(x.acl || ""))), f.map((x) => `${x.n} ${x.acl}`).join(" | ").slice(0, 600));
  // office Y (no module, default weights): three caregivers, no soft issues (no zips / availability declared)
  F.b2shifts = [];
  await admin.from("clients").update({ zip_code: "49002" }).eq("id", F.CY);
  F.extra = [];
  for (const [k, rel] of [["a", 95], ["b", 60], ["c", null]]) {
    const id = await ins("caregivers", { agency_id: A, virtual_office_id: F.OY, first_name: "ZZ", last_name: `AA${k} ${RUN}`, email: `sec-aa${k}-${RUN}@caremuch-sectest.test`, phone: "555-0180", is_demo: true, ...(rel != null ? { reliability_score: rel } : {}) });
    await ins("caregiver_skills", { caregiver_id: id, care_type_code: "CLS0001", is_demo: true }); F.extra.push(id);
  }
  const sh = async (k, s, e) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OY, client_id: F.CY, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(k), start_time: s, end_time: e, duration_hours: 1, status: "open", is_demo: true }); F.b2shifts.push(id); return id; };
  const S1 = await sh(12, "09:00", "10:00");
  const mc = await fetch(`${URL_}/functions/v1/match-caregiver`, { method: "POST", headers: { Authorization: `Bearer ${await token(F.mgrAll.c)}`, apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ shiftId: S1 }) }).then((r) => r.json());
  const sg = await must(F.mgrAll.c, "suggest_caregivers", { _shift_id: S1 });
  const norm = (arr) => (arr || []).map((m) => `${m.caregiver_id}:${m.match_score}:${JSON.stringify(m.key_factors)}:${JSON.stringify(m.warnings)}`).sort();
  const a = norm(mc.matches), b = norm(sg.matches);
  rec("S1 default weights on DEV: suggest_caregivers returns the same caregivers, scores, key factors and warnings as the deployed match-caregiver",
    pass(a.length >= 3 && JSON.stringify(a) === JSON.stringify(b)), `match-caregiver ${a.length} / suggest ${b.length}; scores ${(sg.matches || []).map((m) => m.match_score).join(",")}${JSON.stringify(a) === JSON.stringify(b) ? "" : ` DIFF ${a.join(" | ").slice(0, 200)} vs ${b.join(" | ").slice(0, 200)}`}`);
  // weights
  const W = { skills: 0, service_area: 0, availability: 30, reliability: 20, performance: 20, continuity: 30 };
  const byMgr = await rpc(F.mgrY.c, "set_office_match_weights", { _office_id: F.OY, _weights: W });
  const set = await rpc(F.aaA.c, "set_office_match_weights", { _office_id: F.OY, _weights: W });
  const ev = ((await admin.from("events").select("payload").eq("event_type", "office_match_weights_changed").eq("subject_id", F.OY)).data || []);
  await rpc(F.aaA.c, "set_office_match_weights", { _office_id: F.OY, _weights: null });
  rec("W1 office weights: the office manager is refused; the agency admin sets them (audited with before / after) and can reset them",
    pass(DENY.test(byMgr.err || "") && !set.err && ev.length >= 1 && ev[0].payload.after.continuity === 30), `${byMgr.err}; ${set.err || "set"}; events ${ev.length}`);
  // propose / commit
  const sA = await sh(13, "09:00", "10:00"), sB = await sh(13, "09:30", "10:30"), sC = await sh(14, "09:00", "10:00");
  const cnt = async () => pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shift_assignments a WHERE a.shift_id = ANY($1::uuid[]) AND a.status <> 'cancelled')::int a,
      (SELECT count(*) FROM public.events WHERE virtual_office_id = $2)::int e`, [F.b2shifts, F.OY])).rows[0]);
  const c0 = await cnt();
  const pr = await rpc(F.mgrAll.c, "propose_auto_assignments", { _office_id: F.OY, _from: await dbDay(12), _to: await dbDay(14) });
  const c1 = await cnt();
  const props = (pr.v && pr.v.proposals) || [], by = Object.fromEntries(props.map((p) => [p.shift_id, p.caregiver_id]));
  rec("P1 propose (read-only: no assignment or event written) gives the two overlapping visits on one date to different caregivers and proposes every visit",
    pass(!pr.err && c1.a === c0.a && c1.e === c0.e && props.length === 4 && by[sA] && by[sB] && by[sA] !== by[sB]), `${pr.err || props.map((p) => `${p.shift_date.slice(5)} ${p.start_time.slice(0, 5)} ${p.caregiver.slice(0, 12)} ${p.score}`).join(" | ")}`);
  const cm = await rpc(F.mgrAll.c, "commit_auto_assignments", { _office_id: F.OY, _from: await dbDay(12), _to: await dbDay(14), _assignments: props.map((p) => ({ shift_id: p.shift_id, caregiver_id: p.caregiver_id })) });
  const made = (await admin.from("shift_assignments").select("shift_id, assignment_method").in("shift_id", F.b2shifts).neq("status", "cancelled")).data || [];
  const run = ((await admin.from("events").select("payload").eq("event_type", "auto_assign_run").eq("subject_id", F.OY)).data || []);
  const assignedEv = ((await admin.from("events").select("event_type, subject_id").in("subject_id", F.b2shifts)).data || []).filter((e) => e.event_type === "shift_assigned");
  rec("C1 commit assigns the 4 through the existing path (auto_assigned; shift_assigned events as today) and writes one auto_assign_run (counts, ids)",
    pass(!cm.err && made.length === 4 && made.every((m) => m.assignment_method === "auto_assigned") && run.length === 1 && run[0].payload.assigned === 4 && assignedEv.length >= 4),
    `${cm.err || `assigned ${cm.v.assigned.length}`}; methods ${[...new Set(made.map((m) => m.assignment_method))]}; shift_assigned ${assignedEv.length}`);
  const anon = createClient(URL_, ANON, opts);
  const deny = [];
  for (const [who, c] of [["hrX", F.hrX.c], ["mgrX(office X)", F.mgrX.c], ["aaB", F.aaB.c], ["cg", F.cg.c], ["anon", anon]]) {
    const r = await rpc(c, "propose_auto_assignments", { _office_id: F.OY, _from: await dbDay(12), _to: await dbDay(14) }); if (r.err && DENY.test(r.err)) deny.push(who); else log(`  not refused: ${who} ${r.err || "ok"}`);
  }
  const sOk = await rpc(F.schX.c, "propose_auto_assignments", { _office_id: F.OX, _from: await dbDay(12), _to: await dbDay(14) });
  rec("R1 roles: the scheduler of office X may propose there; HR, another office's manager, other agency, caregiver, anon refused (generic)",
    pass(!sOk.err && deny.length === 5), `scheduler ${sOk.err || "ok"}; refused ${deny.join(",")}`);
}

(async () => {
  log(`=== Auto-assign — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const f = await cat(); rec("B0 before: none of the 12 new functions exist", pass(f.length === 0), `${f.length}`); }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const s of F.b2shifts || []) await admin.from("events").delete().eq("subject_id", s);
      await admin.from("events").delete().eq("subject_id", F.OY);
      for (const g of F.extra || []) await admin.from("caregiver_skills").delete().eq("caregiver_id", g);
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    await closeDb();
  }
  summary();
})();
