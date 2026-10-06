// Ripple care-plan module — Phase A (schema, RLS composition, derived units, flag guard, ACLs).
// Usage: node tests/ripple/dev/phase-a.cjs <after|before>
//   before: Phase A objects must be absent (historical: only meaningful before Phase A is applied)
//   after : RLS composition, non-staff + staff direct-write denial, units cycle, flag guard, ACLs, NB1
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, URL_, ANON, LABEL, RUN, SUFFIX, admin, opts, createClient, fs, path, BASELINE, ids, rows, log, rec, pass, ins, mkUser,
  dbNow, reportSkew, pgRead, setup, noBreak, checkNoBreak, DENY, setupB1, rpc, evIds, eventsSince, dbDay, teardownB1, teardown,
  teardownB2, closeDb, summary } = require("./lib.cjs");

const NEW_TABLES = ["form_templates", "form_template_versions", "form_template_fields", "measure_types", "care_plans", "care_plan_goals",
  "care_plan_objectives", "care_plan_attendees", "care_plan_needs", "care_plan_treatment_needs", "care_plan_objective_needs",
  "care_plan_dsm_recommendations", "care_plan_natural_supports", "care_plan_external_services", "objective_measures", "care_plan_reviews",
  "office_service_types", "service_authorizations", "billing_batches", "progress_notes", "progress_note_entries", "client_documents",
  "credential_types", "plan_inservice_forms", "plan_training_forms", "plan_training_records"];
const NEW_FUNCTIONS = ["guard_virtual_office_flags", "cp_staff_in_scope", "cp_staff_in_agency", "cp_check_row_scope", "cp_form_template_readable",
  "cp_form_template_version_readable", "cp_check_client_order_care_plan", "cp_care_plan_in_scope", "cp_care_plan_goal_in_scope",
  "cp_care_plan_objective_in_scope", "cp_check_order_service_authorization", "cp_progress_note_in_scope", "cp_check_certification_type",
  "cp_derive_progress_note_units", "cp_derive_authorization_units", "cp_refresh_authorization_units"];


async function afterTests(F) {
  // ---- fixture rows in every new table: scope X (office X), Y (office Y), Z (agency B) ----
  const S = {};                                // table -> {X:[ids], Y:[ids], Z:[ids], W:[ids] (agency-wide shell)}
  const put = async (t, scope, row, idcol = "id") => { const r = await ins(t, row, idcol); ((S[t] = S[t] || {})[scope] = S[t][scope] || []).push(r); return r; };
  const T = {}; for (const [sc, ag, of] of [["X", A, F.OX], ["Y", A, F.OY], ["Z", F.B, null]]) T[sc] = await put("form_templates", sc, { agency_id: ag, virtual_office_id: of, name: `ZZ IPOS ${sc} ${RUN}`, kind: "ipos" });
  T.W = await put("form_templates", "W", { agency_id: A, virtual_office_id: null, name: `ZZ IPOS agency-wide ${RUN}`, kind: "ipos" });
  // fields first, then publish: since Phase B1 the fields of a published version can't be changed (guard trigger)
  const V = {}; for (const sc of ["X", "Y", "Z", "W"]) V[sc] = await put("form_template_versions", sc, { template_id: T[sc], version: 1, status: "draft", is_current: false });
  for (const sc of ["X", "Y", "Z", "W"]) await put("form_template_fields", sc, { template_version_id: V[sc], field_key: "f", label: "F", field_type: "text", storage: "field_value" });
  for (const sc of ["X", "Y", "Z", "W"]) { const { error } = await admin.from("form_template_versions").update({ status: "published", is_current: true }).eq("id", V[sc]); if (error) throw new Error(`publish ${sc}: ${error.message}`); }
  await put("measure_types", "Z", { agency_id: F.B, kind: "tally", label: `ZZ tally ${RUN}` });
  const mA = await put("measure_types", "A", { agency_id: A, kind: "tally", label: `ZZ tally A ${RUN}` });
  const mZ = S.measure_types.Z[0];
  await put("credential_types", "Z", { agency_id: F.B, name: `ZZ check ${RUN}`, category: "background_check" });
  await put("credential_types", "A", { agency_id: A, name: `ZZ check A ${RUN}`, category: "background_check" });
  const P = {}, Gl = {}, O = {}, N = {}, AU = {}, TF = {};
  const sc3 = [["X", A, F.OX, F.CX, F.G], ["Y", A, F.OY, F.CY, F.G], ["Z", F.B, F.OZ, F.CZ, F.GZ]];
  for (const [sc, ag, of, cid] of sc3) {
    P[sc] = await put("care_plans", sc, { agency_id: ag, virtual_office_id: of, client_id: cid });
    Gl[sc] = await put("care_plan_goals", sc, { care_plan_id: P[sc], seq: 1, goal_text: "g" });
    O[sc] = await put("care_plan_objectives", sc, { goal_id: Gl[sc], objective_text: "o" });
    N[sc] = await put("care_plan_treatment_needs", sc, { care_plan_id: P[sc], domain: "d" });
    await put("care_plan_objective_needs", sc, { objective_id: O[sc], treatment_need_id: N[sc] }, "objective_id");
    await put("objective_measures", sc, { objective_id: O[sc], measure_type_id: sc === "Z" ? mZ : mA, prompt_text: "p" });
    for (const t of ["care_plan_attendees", "care_plan_reviews", "care_plan_external_services", "care_plan_natural_supports"]) await put(t, sc, { care_plan_id: P[sc] });
    await put("care_plan_needs", sc, { care_plan_id: P[sc], source: "other" });
    await put("care_plan_dsm_recommendations", sc, { care_plan_id: P[sc], service: "s", outcome_code: "01" });
    await put("office_service_types", sc, { agency_id: ag, virtual_office_id: of, care_type_code: "CLS0001", service_type: "cls" });
    AU[sc] = await put("service_authorizations", sc, { agency_id: ag, virtual_office_id: of, client_id: cid, auth_number: `ZZ-${sc}-${RUN}`, service_type: "cls", units_authorized: 20, effective_date: "2026-10-01", expiration_date: "2026-12-31" });
    await put("billing_batches", sc, { agency_id: ag, virtual_office_id: of, week_start: "2026-11-02", week_end: "2026-11-08" });
    await put("client_documents", sc, { agency_id: ag, virtual_office_id: of, client_id: cid, doc_type: "consent" });
    await put("plan_inservice_forms", sc, { agency_id: ag, virtual_office_id: of, client_id: cid, care_plan_id: P[sc], training_version: 1 });
    TF[sc] = await put("plan_training_forms", sc, { agency_id: ag, virtual_office_id: of, client_id: cid, care_plan_id: P[sc], training_version: 1 });
  }
  for (const [sc, ag, of, cid, gid] of sc3) {
    await put("plan_training_records", sc, { training_form_id: TF[sc], agency_id: ag, virtual_office_id: of, caregiver_id: gid, client_id: cid, care_plan_id: P[sc], training_version: 1 });
    const n = await put("progress_notes", sc, { agency_id: ag, virtual_office_id: of, client_id: cid, caregiver_id: gid, authorization_id: AU[sc], note_kind: "cls", service_date: "2026-10-20", units_scheduled: 4, billable: false });
    await put("progress_note_entries", sc, { progress_note_id: n });
  }

  // ---- RLS composition (fixture rows only) ----
  const visible = async (c, t) => { const idcol = t === "care_plan_objective_needs" ? "objective_id" : "id"; const { data, error } = await c.from(t).select(idcol).limit(10000); return error ? null : new Set(data.map((d) => d[idcol])); };
  const expectFor = { mgrX: ["X", "W", "A"], mgrAll: ["X", "Y", "W", "A"], aaB: ["Z"] };
  const fails = [];
  for (const t of NEW_TABLES) {
    if (!S[t]) continue;
    for (const who of ["mgrX", "mgrAll", "aaB"]) {
      const v = await visible(F[who].c, t); if (!v) { fails.push(`${who} ${t}: error`); continue; }
      for (const [sc, list] of Object.entries(S[t])) for (const id of list) {
        const shouldSee = expectFor[who].includes(sc) || (sc === "A" && who !== "aaB") || (sc === "W" && who !== "aaB");
        if (v.has(id) !== shouldSee) fails.push(`${who} ${t} ${sc}: ${v.has(id) ? "sees" : "misses"}`);
      }
    }
  }
  rec("R1 RLS composes (office X mgr / agency-wide mgr / other agency)", pass(fails.length === 0), fails.length ? fails.slice(0, 8).join("; ") : `${Object.keys(S).length} tables: office-X manager sees X + agency-wide shells/catalogs only; agency-wide manager X+Y; agency B admin only B`);

  // ---- R1b: role tiers (minimum necessary) — office-X scheduler and office-X hr_staff ----
  const CLIN = ["care_plans", "care_plan_goals", "care_plan_objectives", "care_plan_objective_needs", "objective_measures", "care_plan_attendees",
    "care_plan_needs", "care_plan_treatment_needs", "care_plan_dsm_recommendations", "care_plan_natural_supports", "care_plan_external_services",
    "care_plan_reviews", "progress_notes", "progress_note_entries", "client_documents", "billing_batches"];
  const AUTHT = ["service_authorizations", "office_service_types"], TRN = ["credential_types", "plan_inservice_forms", "plan_training_forms", "plan_training_records"];
  const fixtureSeen = async (who, t) => { const v = await visible(F[who].c, t); if (!v) return -1; return Object.values(S[t] || {}).flat().filter((id) => v.has(id)).length; };
  const tb = [];
  for (const t of CLIN) for (const who of ["schX", "hrX"]) { const n = await fixtureSeen(who, t); if (n !== 0) tb.push(`${who} ${t}=${n}`); }
  for (const t of AUTHT) { const s = await fixtureSeen("schX", t), h = await fixtureSeen("hrX", t); if (s !== 1) tb.push(`schX ${t}=${s} (exp 1: office X)`); if (h !== 0) tb.push(`hrX ${t}=${h}`); }
  for (const t of TRN) { const h = await fixtureSeen("hrX", t), s = await fixtureSeen("schX", t); if (h !== 1) tb.push(`hrX ${t}=${h} (exp 1)`); if (s !== 0) tb.push(`schX ${t}=${s}`); }
  for (const t of ["form_templates", "form_template_versions", "form_template_fields"]) for (const who of ["schX", "hrX"]) { const n = await fixtureSeen(who, t); if (n !== 2) tb.push(`${who} ${t}=${n} (exp 2)`); }
  { const { data } = await F.schX.c.from("measure_types").select("id").is("agency_id", null); if (!data || data.length !== 8) tb.push(`schX system measure types=${data && data.length} (exp 8)`); }
  rec("R1b role tiers: scheduler/hr_staff 0 clinical rows; scheduler reads authorizations; hr reads training", pass(tb.length === 0),
    tb.length ? tb.join("; ") : `scheduler + hr_staff: 0 rows on ${CLIN.length} clinical tables; scheduler reads authorizations + service types (office X) only; hr_staff reads credential types + in-service/training forms/records only; both read shells + the 8 system measure types`);

  // ---- caregiver / client / anon: no rows, no writes ----
  const anon = createClient(URL_, ANON, opts); const leaks = [];
  for (const [who, c] of [["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon]]) for (const t of NEW_TABLES) {
    const idcol = t === "care_plan_objective_needs" ? "objective_id" : "id";
    const s = await c.from(t).select(idcol).limit(5); if (!s.error && s.data.length) leaks.push(`${who} reads ${t}`);
    const u = await c.from(t).update({ [idcol]: "00000000-0000-0000-0000-000000000000" }).neq(idcol, "00000000-0000-0000-0000-000000000000").select(idcol); if (!u.error && u.data.length) leaks.push(`${who} updates ${t}`);
    const i = await c.from(t).insert({}).select(idcol); if (!i.error) leaks.push(`${who} inserts ${t}`);
  }
  rec("R2 caregiver/client/anon direct SELECT/INSERT/UPDATE denied on every new table", pass(leaks.length === 0), leaks.length ? leaks.slice(0, 8).join("; ") : `${NEW_TABLES.length} tables x 3 roles: 0 rows, all writes refused`);
  const staffW = [];
  for (const t of NEW_TABLES) { const idcol = t === "care_plan_objective_needs" ? "objective_id" : "id";
    const u = await F.mgrAll.c.from(t).update({ [idcol]: "00000000-0000-0000-0000-000000000000" }).neq(idcol, "00000000-0000-0000-0000-000000000000").select(idcol); if (!u.error) staffW.push(`update ${t}`);
    const d = await F.aaA.c.from(t).delete().neq(idcol, "00000000-0000-0000-0000-000000000000").select(idcol); if (!d.error) staffW.push(`delete ${t}`); }
  rec("R3 staff direct writes refused (every write path is an RPC)", pass(staffW.length === 0), staffW.length ? staffW.slice(0, 6).join("; ") : "manager UPDATE + agency_admin DELETE refused on every new table");

  // ---- units trigger (service role, the Phase B RPCs' stand-in) ----
  const avail = async () => Number((await admin.from("service_authorizations").select("units_available").eq("id", AU.X).single()).data.units_available);
  const note = (shift, extra) => ({ agency_id: A, virtual_office_id: F.OX, client_id: F.CX, caregiver_id: F.G, shift_id: shift, authorization_id: AU.X, note_kind: "cls", units_scheduled: 4, ...extra });
  const steps = [`authorized 20 -> available ${await avail()}`];
  const n1 = await put("progress_notes", "U", note(F.shifts[0], { service_date: "2026-11-02", scheduled_start: "2026-11-02T13:00:00Z", client_arrived_at: "2026-11-02T13:00:00Z" }));
  const a1 = await avail(); steps.push(`on-time (13:00) 4 -> ${a1}`);
  const n2 = await put("progress_notes", "U", note(F.shifts[1], { service_date: "2026-11-03", scheduled_start: "2026-11-03T13:00:00Z", client_arrived_at: "2026-11-03T13:06:00Z" }));
  const l = (await admin.from("progress_notes").select("units_used, arrived_late").eq("id", n2).single()).data; const a2 = await avail();
  steps.push(`late (6 min) 4 -> used ${l.units_used} late=${l.arrived_late}, available ${a2}`);
  await admin.from("progress_notes").update({ voided: true }).eq("id", n2); const a3 = await avail(); steps.push(`void late -> ${a3}`);
  const n3 = await put("progress_notes", "U", note(F.shifts[2], { service_date: "2026-11-04", billable: false }));
  const nb = (await admin.from("progress_notes").select("units_used").eq("id", n3).single()).data; const a4 = await avail(); steps.push(`non-billable 4 -> used ${nb.units_used}, available ${a4}`);
  await admin.from("progress_notes").update({ units_used: 99 }).eq("id", n1); const forced = (await admin.from("progress_notes").select("units_used").eq("id", n1).single()).data;
  await admin.from("service_authorizations").update({ units_available: 999 }).eq("id", AU.X); const a5 = await avail();
  steps.push(`direct set units_used=99 -> ${forced.units_used}; units_available=999 -> ${a5}`);
  const e500 = await put("progress_notes", "U", note(F.shifts[4], { service_date: "2026-11-06", scheduled_start: "2026-11-06T13:00:00Z", client_arrived_at: "2026-11-06T13:00:59Z" }));
  const e501 = await put("progress_notes", "U", note(F.shifts[5], { service_date: "2026-11-07", scheduled_start: "2026-11-07T13:00:00Z", client_arrived_at: "2026-11-07T13:01:00Z" }));
  const r500 = (await admin.from("progress_notes").select("units_used, arrived_late").eq("id", e500).single()).data;
  const r501 = (await admin.from("progress_notes").select("units_used, arrived_late").eq("id", e501).single()).data;
  steps.push(`+0:59 -> used ${r500.units_used} late=${r500.arrived_late}; +1:00 -> used ${r501.units_used} late=${r501.arrived_late}`);   // no grace period (Oct 6): minute precision
  const colTypes = await pgRead(async (c) => (await c.query(`SELECT string_agg(column_name||':'||data_type, ', ' ORDER BY column_name) t FROM information_schema.columns WHERE table_schema='public' AND table_name='progress_notes' AND column_name IN ('scheduled_start','scheduled_end','client_arrived_at')`)).rows[0].t);
  steps.push(`types: ${colTypes}`);
  rec("U1 units trigger: insert/void cycle, non-billable 0, late 4 -> 3, +0:59 not late / +1:00 late (no grace period, Oct 6), derived columns not settable",
    pass(a1 === 16 && Number(l.units_used) === 3 && l.arrived_late === true && a2 === 13 && a3 === 16 && Number(nb.units_used) === 0 && a4 === 16 && Number(forced.units_used) === 4 && a5 === 16
      && Number(r500.units_used) === 4 && r500.arrived_late === false && Number(r501.units_used) === 3 && r501.arrived_late === true
      && colTypes === "client_arrived_at:timestamp with time zone, scheduled_end:timestamp with time zone, scheduled_start:timestamp with time zone"), steps.join("; "));

  // ---- flag guard (disposable office X of agency A) ----
  const res = {};
  for (const who of ["mgrAll", "mgrX", "schX", "hrX", "aaA"]) for (const col of ["compliance_enforcement_enabled", "care_plan_module_enabled"]) {
    const r = await F[who].c.from("virtual_office").update({ [col]: true }).eq("id", F.OX).select("id");
    res[`${who}.${col}`] = r.error ? "refused" : `changed ${r.data.length}`;
    await admin.from("virtual_office").update({ [col]: false }).eq("id", F.OX);
  }
  for (const who of ["mgrAll", "mgrX", "schX", "hrX", "aaA"]) {
    const r = await F[who].c.from("virtual_office").update({ billing_week_start: 7 }).eq("id", F.OX).select("id");
    res[`${who}.billing_week_start`] = r.error ? "refused" : `changed ${r.data.length}`;
    await admin.from("virtual_office").update({ billing_week_start: 1 }).eq("id", F.OX);
  }
  const ins2 = await F.mgrAll.c.from("virtual_office").insert({ agency_id: A, name: `ZZ week insert ${RUN}`, billing_week_start: 3, is_demo: true }).select("id");
  res["mgrAll.insert office with billing week"] = ins2.error ? "refused" : "accepted"; if (!ins2.error) (ids.virtual_office = ids.virtual_office || []).push(ins2.data[0].id);
  const ins1 = await F.mgrAll.c.from("virtual_office").insert({ agency_id: A, name: `ZZ flag insert ${RUN}`, care_plan_module_enabled: true, is_demo: true }).select("id");
  res["mgrAll.insert office with flag on"] = ins1.error ? "refused" : "accepted"; if (!ins1.error) (ids.virtual_office = ids.virtual_office || []).push(ins1.data[0].id);
  const other = await F.mgrAll.c.from("virtual_office").update({ name: `ZZ CP X renamed ${RUN}` }).eq("id", F.OX).select("id"); res["mgrAll.other column"] = other.error ? "refused" : `changed ${other.data.length}`;
  const ok = Object.entries(res).every(([k, v]) => k.startsWith("aaA.") || k === "mgrAll.other column" ? v === "changed 1" : v === "refused");
  rec("F1 flag + billing-week guard: manager/scheduler/hr refused, agency_admin allowed", pass(ok), JSON.stringify(res));

  // ---- grants (read-only catalog) ----
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default: PUBLIC)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [NEW_FUNCTIONS])).rows);
  acl.forEach((f) => log(`   ${f.proname} definer=${f.prosecdef} EXECUTE: ${f.g}`));
  const bad = acl.filter((f) => /PUBLIC|anon/.test(f.g));
  rec("A1 aclexplode: no PUBLIC/anon EXECUTE on any new function", pass(acl.length === NEW_FUNCTIONS.length && bad.length === 0), `${acl.length}/${NEW_FUNCTIONS.length} found; PUBLIC/anon on: ${bad.map((f) => f.proname).join(", ") || "none"}`);
  const tg = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name = ANY($1) AND (grantee='anon' OR (grantee='authenticated' AND privilege_type <> 'SELECT'))`, [NEW_TABLES])).rows[0].n);
  rec("A2 table grants: anon none, authenticated SELECT only", pass(tg === 0), `offending grants: ${tg}`);
}

async function beforeChecks() {
  const present = await pgRead(async (c) => ({
    tables: (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [NEW_TABLES])).rows[0].n,
    cols: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND ((table_name='virtual_office' AND column_name IN ('compliance_enforcement_enabled','care_plan_module_enabled','billing_week_start')) OR (table_name='client_orders' AND column_name='care_plan_id') OR (table_name='order_services' AND column_name='service_authorization_id') OR (table_name='caregiver_certifications' AND column_name IN ('credential_type_id','effective_date','entered_by')))`)).rows[0].n,
    fns: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [NEW_FUNCTIONS])).rows[0].n }));
  rec("B0 Phase A objects absent before push", pass(present.tables === 0 && present.cols === 0 && present.fns === 0), `new tables ${present.tables}/26, new columns ${present.cols}/8, new functions ${present.fns}/16`);
}

(async () => {
  log(`=== Ripple Phase A tests — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") await beforeChecks();
    F = await setup();
    await checkNoBreak(F);                 // first, so before/after see identical state
    if (LABEL !== "before") await afterTests(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally { await teardown(F); await closeDb(); }
  summary();
})();
