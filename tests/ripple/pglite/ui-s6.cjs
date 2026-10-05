// UI S6 backend on PGlite: get_client_training_context + list_client_training_status (training tier,
// no clinical content), the training workflow order (training refused before the in-service; after a
// renewal everyone needs retraining; back after in-service + training at the new version),
// credentials_current, denials, ACLs. Usage: node tests/ripple/pglite/ui-s6.cjs   (local, no network)
const H = require("./harness.cjs");
const S6 = "20261016120000_ui_s6_training.sql";
let seq = 0; const nid = () => H.U(9700 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S6); const { db, q, day, call, must } = t;
  await H.applyFiles(db, [S6]);
  const { CX, G, OX } = H;
  const G2 = nid(); await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,'Hal','Second',$3,true)`, [G2, H.A, OX]);
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330), discharge_criteria: "CLINICAL-DISCHARGE-TEXT" }), "{}"]);
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify([{ seq: 1, goal_text: "CLINICAL-GOAL-TEXT", objectives: [{ seq: 1, objective_text: "CLINICAL-OBJECTIVE", staff_instructions: "CLINICAL-INSTR", service_type: "cls", responsible_party: "this_agency" }] }])]);
  const CTX = "SELECT get_client_training_context($1)";
  const c0 = (await call("hrX", CTX, [CX])).v;
  const raw = JSON.stringify(c0);
  rec("T1 hr_staff reads the training context: plan spine only (id, version, training version, type, dates); no goals, objectives, instructions, discharge text; hr still reads no care_plans rows",
    !!c0 && JSON.stringify(Object.keys(c0.plan).sort()) === JSON.stringify(["care_plan_id", "effective_date", "expiration_date", "plan_type", "training_version", "version"])
      && !/CLINICAL-/.test(raw) && c0.client_name === "Carla Fixture" && c0.client_short === "Carla F." && (await call("hrX", "SELECT count(*)::int FROM care_plans")).v === 0,
    `plan keys ${Object.keys(c0.plan).join(",")}; clinical text ${/CLINICAL-/.test(raw) ? "LEAKED" : "absent"}`);
  const leads = c0.program_leads.map((l) => l.name).sort();
  rec("T2 program leads = agency admins + managers whose scope covers the office (not the office-Y manager)", leads.includes("Manager X") && leads.includes("Admin A") && leads.includes("Manager All") && !leads.includes("Manager Y"), leads.join(", "));
  const cg = (ctx, id) => ctx.caregivers.find((x) => x.caregiver_id === id);
  rec("T3 credentials_current false while a required credential is missing; true once all required are current", cg(c0, G).credentials_current === false, `G credentials_current ${cg(c0, G).credentials_current}`);
  const types = await q(`SELECT id FROM credential_types WHERE agency_id = $1 AND is_active AND required`, [H.A]);
  for (const ty of types) await must("hrX", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date)", [G, ty.id, await day(-10), await day(300)]);
  const c1 = (await call("hrX", CTX, [CX])).v;

  // workflow order
  const TRAIN = "SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)";
  const recs = async (ids) => JSON.stringify(ids.map((id) => ({ caregiver_id: id, training_date: "TODAY" })));
  const tday = await day(0);
  const early = await call("hrX", TRAIN, [plan, (await recs([G])).replace(/TODAY/g, tday)]);
  await must("hrX", "SELECT record_inservice_form($1,'CM Name',$2,$3::date,now())", [plan, H.users.mgrX, tday]);
  const c2 = (await call("hrX", CTX, [CX])).v;
  await must("hrX", TRAIN, [plan, (await recs([G, G2])).replace(/TODAY/g, tday)]);
  const c3 = (await call("hrX", CTX, [CX])).v;
  rec("T4 training refused before the in-service at the current version; after the in-service it succeeds and both caregivers are trained_current",
    /Record the signed in-service form for this plan version first/.test(early.err || "") && cg(c1, G).credentials_current === true && c2.inservice_current === true
      && cg(c3, G).trained_current && cg(c3, G2).trained_current && c3.training_forms.length === 1 && c3.training_forms[0].records.length === 2,
    `early "${(early.err || "ACCEPTED").slice(0, 60)}"; credentials ${cg(c1, G).credentials_current}; in-service ${c2.inservice_current}; trained ${cg(c3, G).trained_current}/${cg(c3, G2).trained_current}`);
  await must("mgrX", "SELECT renew_care_plan($1)", [plan]);
  const c4 = (await call("hrX", CTX, [CX])).v;
  const p2 = c4.plan.care_plan_id;
  await must("hrX", "SELECT record_inservice_form($1,'CM Name',$2,$3::date,now())", [p2, H.users.aaA, tday]);
  await must("hrX", TRAIN, [p2, (await recs([G])).replace(/TODAY/g, tday)]);
  const c5 = (await call("hrX", CTX, [CX])).v;
  rec("T5 after a renewal everyone needs retraining (trained v1, current v2, in-service not current); after in-service + training at v2 G is back, G2 still needs it",
    c4.plan.training_version === 2 && !c4.inservice_current && !cg(c4, G).trained_current && cg(c4, G).trained_version === 1 && !cg(c4, G2).trained_current
      && c5.inservice_current && cg(c5, G).trained_current && cg(c5, G).trained_version === 2 && !cg(c5, G2).trained_current,
    `after renewal: v${c4.plan.training_version}, G trained v${cg(c4, G).trained_version}; after retraining: G ${cg(c5, G).trained_current}, G2 ${cg(c5, G2).trained_current}`);

  // status list
  const s1 = await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
    VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'assigned',1,$6)`, [nid(), H.A, CX, await day(4), OX, G2]); void s1;
  const st = (await call("hrX", "SELECT list_client_training_status($1)", [OX])).v.find((r) => r.client_id === CX);
  rec("T6 office training status: training v2, in-service current, 1 caregiver trained, 1 assigned caregiver needing retraining; client shown as first name + initial",
    st && st.training_version === 2 && st.inservice_current && st.caregivers_trained === 1 && st.needing_retraining === 1 && st.client_short === "Carla F.", JSON.stringify(st));
  const dl = []; let dn = 0;
  for (const w of ["schX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) {
    for (const [sql, p] of [[CTX, [CX]], ["SELECT list_client_training_status($1)", [OX]]]) { const r = await call(w, sql, p); dn++; if (!r.err || !H.DENY.test(r.err)) dl.push(`${w}: ${r.err || "ALLOWED"}`); } }
  const okRoles = []; for (const w of ["mgrX", "aaA", "hrX", "mgrA"]) okRoles.push(!(await call(w, CTX, [CX])).err);
  rec("T7 both reads refused for scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; allowed for manager, agency admin, hr_staff", dl.length === 0 && okRoles.every(Boolean), dl.join("; ") || `${dn} refused; allowed ${okRoles}`);
  const acl = await H.aclCheck(q, ["get_client_training_context", "list_client_training_status"]);
  rec("ACL SECURITY DEFINER + authenticated, no PUBLIC/anon", acl.ok, acl.detail);
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });
