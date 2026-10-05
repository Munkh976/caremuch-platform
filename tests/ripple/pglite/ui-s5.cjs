// UI S5 backend on PGlite: would_bump_training_version predicts exactly what upsert_care_plan_goals
// does (no training -> no bump; after training -> bump on a goal/objective/instructions change only;
// measure edits never bump); case-management objectives get no measures; sequence kept; denials, ACL.
// Usage: node tests/ripple/pglite/ui-s5.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
const S5 = "20261014120200_ui_s5_goals.sql";

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S5); const { db, q, day, call, must } = t;
  await H.applyFiles(db, [S5]);
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb)", [H.CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) })]);
  const WB = "SELECT would_bump_training_version($1,$2::jsonb)", UP = "SELECT upsert_care_plan_goals($1,$2::jsonb)";
  const tv = async () => (await q(`SELECT training_version FROM care_plans WHERE id = $1`, [plan]))[0].training_version;
  const tree = async () => { // current goals as the UI sends them back (ids kept)
    const gs = await q(`SELECT id, seq, goal_text, target_start::text, target_end::text FROM care_plan_goals WHERE care_plan_id = $1 ORDER BY seq`, [plan]);
    for (const g of gs) { g.objectives = (await q(`SELECT id, letter, seq, objective_text, staff_instructions, service_type, responsible_party::text, target_start::text, target_end::text
        FROM care_plan_objectives WHERE goal_id = $1 ORDER BY seq`, [g.id])).map((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)));
      for (const k of ["target_start", "target_end"]) if (g[k] === null) delete g[k]; }
    return gs; };
  const goals0 = [
    { seq: 1, goal_text: "Build community skills", objectives: [
      { seq: 1, letter: "A", objective_text: "Order at a cafe", staff_instructions: "Prompt once", service_type: "cls", responsible_party: "this_agency" },
      { seq: 2, letter: "B", objective_text: "Arrange transport", responsible_party: "case_management" }] },
    { seq: 2, goal_text: "Rest for family", objectives: [{ seq: 1, letter: "A", objective_text: "Respite weekly", service_type: "respite", responsible_party: "this_agency" }] }];

  const p1 = (await call("mgrX", WB, [plan, JSON.stringify(goals0)])).v;
  const r1 = (await call("mgrX", UP, [plan, JSON.stringify(goals0)])).v;
  rec("S5-a before any training: a goal change is 'changed' but would not bump; the save does not bump (v1 stays)",
    p1.changed === true && p1.would_bump === false && p1.trained === false && r1.training_version === 1 && (await tv()) === 1, `preview ${JSON.stringify(p1)}; save tv ${r1.training_version}`);
  const same = (await call("mgrX", WB, [plan, JSON.stringify(await tree())])).v;
  rec("S5-b sending back the current tree (with ids) is not a change", same.changed === false && same.would_bump === false, JSON.stringify(same));

  // training at v1
  await must("hrX", "SELECT record_inservice_form($1,'CM',$2,$3::date,now())", [plan, H.users.mgrX, await day(-1)]);
  const cur = await tree(); cur[0].objectives[0].staff_instructions = "Prompt twice, then model";
  const p2 = (await call("mgrX", WB, [plan, JSON.stringify(cur)])).v;
  const unchanged = (await call("mgrX", WB, [plan, JSON.stringify(await tree())])).v;
  const r2 = (await call("mgrX", UP, [plan, JSON.stringify(cur)])).v;
  rec("S5-c after training at v1: an Instructions-for-Staff edit would bump (preview) and the save bumps to v2; an unchanged tree would not",
    p2.would_bump === true && p2.trained === true && unchanged.would_bump === false && r2.training_version === 2 && (await tv()) === 2,
    `preview ${JSON.stringify(p2)}; unchanged ${JSON.stringify(unchanged)}; saved tv ${r2.training_version}`);
  const p3 = (await call("mgrX", WB, [plan, JSON.stringify((() => { const x = cur; x[1].goal_text = "Rest for the family"; return x; })())])).v;
  rec("S5-d at v2 with no training yet at v2: a further change would not bump", p3.changed === true && p3.would_bump === false && p3.training_version === 2, JSON.stringify(p3));

  // measures never bump; CM objective has no measures
  const mt = (await q(`SELECT id FROM measure_types WHERE agency_id IS NULL AND kind = 'yes_no_na' LIMIT 1`))[0].id;
  await must("hrX", "SELECT record_inservice_form($1,'CM',$2,$3::date,now())", [plan, H.users.mgrX, await day(0)]);   // retrained at v2
  await must("hrX", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)", [plan, JSON.stringify([{ caregiver_id: H.G, training_date: await day(0) }])]);
  const now = await tree(); const objA = now[0].objectives[0].id, objCM = now[0].objectives[1].id;
  const tvBefore = await tv();
  const m1 = await call("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objA, JSON.stringify([{ measure_type_id: mt, prompt_text: "Ordered without help?" }])]);
  const pAfterM = (await call("mgrX", WB, [plan, JSON.stringify(await tree())])).v;
  const mCM = await call("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objCM, JSON.stringify([{ measure_type_id: mt, prompt_text: "x" }])]);
  rec("S5-e a measure edit after training never bumps (and leaves the goal tree unchanged); a case-management objective is refused measures",
    !m1.err && (await tv()) === tvBefore && pAfterM.changed === false && /Only objectives this agency delivers/.test(mCM.err || ""), `measures ${m1.err || "ok"}; tv ${tvBefore}->${await tv()}; CM "${(mCM.err || "ACCEPTED").slice(0, 50)}"`);

  // sequence preserved after edits (reorder goal 2 objective list, add one; ids kept)
  const reo = await tree(); reo[0].objectives = [ { ...reo[0].objectives[1], seq: 1 }, { ...reo[0].objectives[0], seq: 2 } ];
  reo[1].objectives.push({ seq: 2, letter: "B", objective_text: "Second respite objective", service_type: "respite", responsible_party: "this_agency" });
  const pr = (await call("mgrX", WB, [plan, JSON.stringify(reo)])).v; const rr = (await call("mgrX", UP, [plan, JSON.stringify(reo)])).v;
  const back = await tree();
  rec("S5-f reorder + add: the preview predicts the bump the save makes, and the saved order follows seq (ids kept)",
    pr.would_bump === true && rr.training_version === tvBefore + 1 && back[0].objectives.map((o) => o.objective_text).join("|") === "Arrange transport|Order at a cafe"
      && back[0].objectives[1].id === objA && back[1].objectives.length === 2,
    `preview bump ${pr.would_bump}; tv ${rr.training_version}; order ${back[0].objectives.map((o) => o.letter + ":" + o.objective_text).join(", ")}`);

  const bad = await call("mgrX", WB, [plan, JSON.stringify([{ seq: "x", goal_text: "g" }])]);
  const dl = []; let dn = 0;
  for (const w of ["schX", "hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, WB, [plan, "[]"]); dn++; if (!r.err || !H.DENY.test(r.err)) dl.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("S5-g malformed list refused (22023); preview refused for scheduler, hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin",
    /not valid/.test(bad.err || "") && dl.length === 0, `${bad.err}; ${dl.join("; ") || `${dn} refused`}`);
  const acl = await H.aclCheck(q, ["would_bump_training_version"]);
  rec("ACL SECURITY DEFINER + authenticated, no PUBLIC/anon", acl.ok, acl.detail);
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });
