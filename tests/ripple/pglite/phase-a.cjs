// Phase A on PGlite: migrations M-CP-01..07 on stubs of the live objects + the DEV reference seed.
// Usage: node tests/ripple/pglite/phase-a.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
// Local (PGlite) apply + behaviour test of the Phase A migrations. Touches no remote database.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const FILES = ["20261006120000_mcp01_office_settings_and_form_templates.sql", "20261006120100_mcp02_care_plan_spine.sql",
  "20261006120200_mcp03_authorizations_and_progress_notes.sql", "20261006120300_mcp03b_client_documents.sql",
  "20261006120400_mcp04_credentials_and_training.sql", "20261006120500_mcp05_units_triggers.sql", "20261006120700_mcp07_system_measure_types.sql"];
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OX = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1";
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { mgrX: U(1), mgrAll: U(2), schX: U(3), aaA: U(4), cg: U(5), cl: U(6), aaB: U(7), hrX: U(8) };
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };

(async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(__dirname + "/stub.sql", "utf8"));
  await db.exec(fs.readFileSync(__dirname + "/live_helpers.sql", "utf8"));
  await db.exec(`
    CREATE POLICY vo_select_same_agency ON public.virtual_office FOR SELECT TO authenticated USING ((agency_id = current_agency_id()) OR has_role(auth.uid(), 'system_admin'::app_role));
    CREATE POLICY vo_insert_staff ON public.virtual_office FOR INSERT TO authenticated WITH CHECK ((is_agency_staff(auth.uid()) AND (agency_id = current_agency_id()) AND ((NOT is_office_restricted(auth.uid())) OR (id = current_virtual_office_id()))) OR has_role(auth.uid(), 'system_admin'::app_role));
    CREATE POLICY vo_update_staff ON public.virtual_office FOR UPDATE TO authenticated USING ((is_agency_staff(auth.uid()) AND (agency_id = current_agency_id()) AND ((NOT is_office_restricted(auth.uid())) OR (id = current_virtual_office_id()))) OR has_role(auth.uid(), 'system_admin'::app_role)) WITH CHECK ((is_agency_staff(auth.uid()) AND (agency_id = current_agency_id()) AND ((NOT is_office_restricted(auth.uid())) OR (id = current_virtual_office_id()))) OR has_role(auth.uid(), 'system_admin'::app_role));
    INSERT INTO agency VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name) VALUES ('${OX}','${A}','Ripple'),('${OY}','${A}','Kind Care'),('${OZ}','${B}','B office');
    INSERT INTO care_types (code) VALUES ('CLS0001'),('RESP0001');`);
  const before = new Set((await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r) => r.table_name));
  for (const f of FILES) {
    try { await db.exec(fs.readFileSync(MIG + f, "utf8")); console.log("applied", f); }
    catch (e) { console.log("APPLY FAILED", f, "::", e.message); process.exit(1); }
  }
  const newTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`)).rows.map((r) => r.table_name).filter((t) => !before.has(t));
  console.log(`new tables (${newTables.length}):`, newTables.join(", "));

  // ---- fixtures (superuser) ----
  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted) VALUES
      ('${users.mgrX}','${A}','${OX}',true), ('${users.mgrAll}','${A}',NULL,false), ('${users.schX}','${A}','${OX}',true),
      ('${users.aaA}','${A}',NULL,false), ('${users.cg}','${A}','${OX}',false), ('${users.cl}','${A}',NULL,false),
      ('${users.aaB}','${B}',NULL,false), ('${users.hrX}','${A}','${OX}',true);
    INSERT INTO user_roles (user_id, role, agency_id) VALUES
      ('${users.mgrX}','manager','${A}'), ('${users.mgrAll}','manager','${A}'), ('${users.schX}','scheduler','${A}'),
      ('${users.aaA}','agency_admin','${A}'), ('${users.cg}','caregiver','${A}'), ('${users.cl}','client','${A}'),
      ('${users.aaB}','agency_admin','${B}'), ('${users.hrX}','hr_staff','${A}');
    INSERT INTO clients VALUES ('${U(101)}','${A}','${users.cl}','CX','${OX}'), ('${U(102)}','${A}',NULL,'CY','${OY}'), ('${U(103)}','${B}',NULL,'CZ','${OZ}');
    INSERT INTO caregivers VALUES ('${U(201)}','${A}','${users.cg}','G','${OX}'), ('${U(202)}','${B}',NULL,'GB','${OZ}');
    INSERT INTO shifts VALUES ('${U(301)}','${A}','${U(101)}','${U(201)}','CLS0001','2026-10-05','${OX}'), ('${U(302)}','${A}','${U(101)}','${U(201)}','CLS0001','2026-10-06','${OX}'),
                              ('${U(303)}','${A}','${U(101)}','${U(201)}','CLS0001','2026-10-07','${OX}'),
                              ('${U(304)}','${A}','${U(101)}','${U(201)}','CLS0001','2026-10-08','${OX}'), ('${U(305)}','${A}','${U(101)}','${U(201)}','CLS0001','2026-10-09','${OX}');
  `);
  // one row per new table in office X, office Y and agency B (where the table has an office)
  const fx = `
    INSERT INTO form_templates (id, agency_id, virtual_office_id, name, kind) VALUES
      ('${U(401)}','${A}','${OX}','IPOS X','ipos'), ('${U(402)}','${A}','${OY}','IPOS Y','ipos'), ('${U(403)}','${A}',NULL,'IPOS agency-wide','ipos'), ('${U(404)}','${B}',NULL,'IPOS B','ipos');
    INSERT INTO form_template_versions (id, template_id, version, status, is_current) VALUES
      ('${U(411)}','${U(401)}',1,'published',true), ('${U(412)}','${U(402)}',1,'published',true), ('${U(413)}','${U(403)}',1,'published',true), ('${U(414)}','${U(404)}',1,'published',true);
    INSERT INTO form_template_fields (template_version_id, field_key, label, field_type, storage) VALUES
      ('${U(411)}','f','F','text','field_value'), ('${U(412)}','f','F','text','field_value'), ('${U(413)}','f','F','text','field_value'), ('${U(414)}','f','F','text','field_value');
    INSERT INTO measure_types (agency_id, kind, label) VALUES ('${B}','tally','B tally');
    INSERT INTO care_plans (id, agency_id, virtual_office_id, client_id) VALUES
      ('${U(501)}','${A}','${OX}','${U(101)}'), ('${U(502)}','${A}','${OY}','${U(102)}'), ('${U(503)}','${B}','${OZ}','${U(103)}');
    INSERT INTO care_plan_goals (id, care_plan_id, seq, goal_text) VALUES ('${U(511)}','${U(501)}',1,'g'), ('${U(512)}','${U(502)}',1,'g'), ('${U(513)}','${U(503)}',1,'g');
    INSERT INTO care_plan_objectives (id, goal_id, objective_text) VALUES ('${U(521)}','${U(511)}','o'), ('${U(522)}','${U(512)}','o'), ('${U(523)}','${U(513)}','o');
    INSERT INTO care_plan_treatment_needs (id, care_plan_id, domain) VALUES ('${U(531)}','${U(501)}','d'), ('${U(532)}','${U(502)}','d'), ('${U(533)}','${U(503)}','d');
    INSERT INTO care_plan_objective_needs VALUES ('${U(521)}','${U(531)}'), ('${U(522)}','${U(532)}'), ('${U(523)}','${U(533)}');
    INSERT INTO objective_measures (objective_id, measure_type_id, prompt_text)
      SELECT o, (SELECT id FROM measure_types WHERE agency_id IS NULL LIMIT 1), 'p' FROM unnest(ARRAY['${U(521)}','${U(522)}']::uuid[]) o;
    INSERT INTO objective_measures (objective_id, measure_type_id, prompt_text) SELECT '${U(523)}', id, 'p' FROM measure_types WHERE agency_id='${B}';
    ${["care_plan_attendees", "care_plan_reviews", "care_plan_external_services"].map((t) => `INSERT INTO ${t} (care_plan_id) VALUES ('${U(501)}'),('${U(502)}'),('${U(503)}');`).join("\n")}
    INSERT INTO care_plan_needs (care_plan_id, source) VALUES ('${U(501)}','other'),('${U(502)}','other'),('${U(503)}','other');
    INSERT INTO care_plan_dsm_recommendations (care_plan_id, service, outcome_code) VALUES ('${U(501)}','s','01'),('${U(502)}','s','01'),('${U(503)}','s','01');
    INSERT INTO care_plan_natural_supports (care_plan_id) VALUES ('${U(501)}'),('${U(502)}'),('${U(503)}');
    INSERT INTO office_service_types (agency_id, virtual_office_id, care_type_code, service_type) VALUES ('${A}','${OX}','RESP0001','respite'), ('${A}','${OY}','CLS0001','cls'), ('${B}','${OZ}','CLS0001','cls');
    INSERT INTO service_authorizations (id, agency_id, virtual_office_id, client_id, auth_number, service_type, units_authorized, effective_date, expiration_date) VALUES
      ('${U(601)}','${A}','${OX}','${U(101)}','AX','cls',20,'2026-10-01','2026-12-31'), ('${U(602)}','${A}','${OY}','${U(102)}','AY','cls',20,'2026-10-01','2026-12-31'),
      ('${U(603)}','${B}','${OZ}','${U(103)}','AZ','cls',20,'2026-10-01','2026-12-31');
    INSERT INTO billing_batches (agency_id, virtual_office_id, week_start, week_end) VALUES ('${A}','${OX}','2026-10-05','2026-10-11'), ('${A}','${OY}','2026-10-05','2026-10-11'), ('${B}','${OZ}','2026-10-05','2026-10-11');
    INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, authorization_id, note_kind, service_date, units_scheduled) VALUES
      ('${U(701)}','${A}','${OY}','${U(102)}','${U(201)}','${U(602)}','cls','2026-10-05',4),
      ('${U(702)}','${B}','${OZ}','${U(103)}','${U(202)}','${U(603)}','cls','2026-10-05',4);
    INSERT INTO progress_note_entries (progress_note_id) VALUES ('${U(701)}'), ('${U(702)}');
    INSERT INTO client_documents (agency_id, virtual_office_id, client_id, doc_type) VALUES ('${A}','${OX}','${U(101)}','consent'), ('${A}','${OY}','${U(102)}','consent'), ('${B}','${OZ}','${U(103)}','consent');
    INSERT INTO credential_types (agency_id, name, category) VALUES ('${B}','B check','background_check'), ('${A}','A check','background_check');
    INSERT INTO plan_inservice_forms (agency_id, virtual_office_id, client_id, care_plan_id, training_version) VALUES ('${A}','${OX}','${U(101)}','${U(501)}',1), ('${A}','${OY}','${U(102)}','${U(502)}',1), ('${B}','${OZ}','${U(103)}','${U(503)}',1);
    INSERT INTO plan_training_forms (id, agency_id, virtual_office_id, client_id, care_plan_id, training_version) VALUES ('${U(801)}','${A}','${OX}','${U(101)}','${U(501)}',1), ('${U(802)}','${A}','${OY}','${U(102)}','${U(502)}',1), ('${U(803)}','${B}','${OZ}','${U(103)}','${U(503)}',1);
    INSERT INTO plan_training_records (training_form_id, agency_id, virtual_office_id, caregiver_id, client_id, care_plan_id, training_version) VALUES
      ('${U(801)}','${A}','${OX}','${U(201)}','${U(101)}','${U(501)}',1), ('${U(802)}','${A}','${OY}','${U(201)}','${U(102)}','${U(502)}',1), ('${U(803)}','${B}','${OZ}','${U(202)}','${U(103)}','${U(503)}',1);`;
  try { await db.exec(fx); } catch (e) { console.log("FIXTURE FAILED ::", e.message); process.exit(1); }

  const as = async (who, sql) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql); await db.exec("ROLLBACK"); return { rows: r.rows, n: r.affectedRows };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const count = async (who, t) => { const r = await as(who, `SELECT count(*)::int n FROM public.${t}`); return r.err ? `ERR` : r.rows[0].n; };

  // ---- RLS composition ----
  const total = {}; for (const t of newTables) total[t] = (await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  const officeTables = ["care_plans", "service_authorizations", "billing_batches", "client_documents", "plan_inservice_forms", "plan_training_forms", "plan_training_records"];
  for (const t of officeTables) {
    const x = await count("mgrX", t), all = await count("mgrAll", t), b = await count("aaB", t);
    const exp = (await db.query(`SELECT count(*) FILTER (WHERE agency_id='${A}' AND virtual_office_id='${OX}')::int x, count(*) FILTER (WHERE agency_id='${A}')::int a, count(*) FILTER (WHERE agency_id='${B}')::int b FROM public.${t}`)).rows[0];
    rec(`R-${t}`, x === exp.x && all === exp.a && b === exp.b, `office-X mgr ${x}/${exp.x}, agency-wide mgr ${all}/${exp.a}, agency-B admin ${b}/${exp.b}`);
  }
  const childOk = async (t) => { const x = await count("mgrX", t), all = await count("mgrAll", t), b = await count("aaB", t); return { x, all, b }; };
  for (const t of ["care_plan_goals", "care_plan_objectives", "care_plan_objective_needs", "care_plan_treatment_needs", "objective_measures", "care_plan_attendees", "care_plan_reviews", "care_plan_external_services", "care_plan_needs", "care_plan_dsm_recommendations", "care_plan_natural_supports"]) {
    const c = await childOk(t); rec(`R-${t}`, c.x === 1 && c.all === 2 && c.b === 1, `X mgr ${c.x} (exp 1), agency-wide ${c.all} (exp 2), B admin ${c.b} (exp 1)`);
  }
  { const x = await count("mgrX", "progress_notes"), all = await count("mgrAll", "progress_notes"), b = await count("aaB", "progress_notes");
    rec("R-progress_notes", x === 0 && all === 1 && b === 1, `X mgr ${x} (exp 0: note is office Y), agency-wide ${all} (exp 1), B ${b} (exp 1)`);
    const ex = await count("mgrX", "progress_note_entries"), ea = await count("mgrAll", "progress_note_entries");
    rec("R-progress_note_entries", ex === 0 && ea === 1, `X mgr ${ex} (exp 0), agency-wide ${ea} (exp 1)`); }
  { const x = await count("mgrX", "office_service_types"), all = await count("mgrAll", "office_service_types");
    rec("R-office_service_types", x === 1 && all === 2, `X mgr ${x} (exp 1), agency-wide ${all} (exp 2)`); }
  { const x = await count("mgrX", "form_templates"), b = await count("aaB", "form_templates"), fv = await count("mgrX", "form_template_versions"), ff = await count("mgrX", "form_template_fields");
    rec("R-form_templates (+versions, fields)", x === 2 && b === 1 && fv === 2 && ff === 2, `X mgr sees office-X + agency-wide shells: ${x}/${fv}/${ff} (exp 2/2/2), not office Y; B ${b} (exp 1)`); }
  { const a = await count("schX", "measure_types"), b = await count("aaB", "measure_types");
    rec("R-measure_types", a === 8 && b === 9, `agency A scheduler ${a} (exp 8 system rows), agency B admin ${b} (exp 8 system + 1 own)`); }
  { const a = await count("hrX", "credential_types"), b = await count("aaB", "credential_types"), s = await count("schX", "credential_types");
    rec("R-credential_types", a === 1 && b === 1 && s === 0, `A hr ${a} (exp 1), B admin ${b} (exp 1), A scheduler ${s} (exp 0)`); }

  // ---- R1b: role tiers (minimum necessary) ----
  const CLIN = ["care_plans", "care_plan_goals", "care_plan_objectives", "care_plan_objective_needs", "objective_measures", "care_plan_attendees",
    "care_plan_needs", "care_plan_treatment_needs", "care_plan_dsm_recommendations", "care_plan_natural_supports", "care_plan_external_services",
    "care_plan_reviews", "progress_notes", "progress_note_entries", "client_documents", "billing_batches"];
  const AUTHT = ["service_authorizations", "office_service_types"], TRN = ["credential_types", "plan_inservice_forms", "plan_training_forms", "plan_training_records"];
  const tierBad = [];
  for (const t of CLIN) for (const who of ["schX", "hrX"]) { const n = await count(who, t); if (n !== 0) tierBad.push(`${who} ${t}=${n}`); }
  for (const t of AUTHT) { if ((await count("schX", t)) < 1) tierBad.push(`schX misses ${t}`); if ((await count("hrX", t)) !== 0) tierBad.push(`hrX reads ${t}`); }
  for (const t of TRN) { if ((await count("hrX", t)) < 1) tierBad.push(`hrX misses ${t}`); if ((await count("schX", t)) !== 0) tierBad.push(`schX reads ${t}`); }
  for (const t of ["form_templates", "form_template_versions", "form_template_fields"]) for (const who of ["schX", "hrX"]) if ((await count(who, t)) !== 2) tierBad.push(`${who} ${t}`);
  rec("R1b-tiers", tierBad.length === 0, tierBad.length ? tierBad.join("; ") : `scheduler + hr_staff: 0 rows on ${CLIN.length} clinical tables; scheduler reads authorizations + service types only; hr_staff reads training tables only; both read shells`);

  // caregiver / client / anon: no SELECT rows, no INSERT/UPDATE/DELETE on any new table
  let leaks = [];
  for (const who of ["cg", "cl", "anon"]) for (const t of newTables) {
    const s = await as(who, `SELECT count(*)::int n FROM public.${t}`); if (!s.err && s.rows[0].n > 0) leaks.push(`${who} reads ${t}`);
    const u = await as(who, `UPDATE public.${t} SET ${t === "care_plan_objective_needs" ? "objective_id = objective_id" : "id = id"}`); if (!u.err && u.n > 0) leaks.push(`${who} updates ${t}`);
    const i = await as(who, `INSERT INTO public.${t} DEFAULT VALUES`); if (!i.err || !/permission denied|row-level security/.test(i.err)) leaks.push(`${who} insert ${t}: ${i.err || "ok"}`);
  }
  rec("D-nonstaff", leaks.length === 0, leaks.length ? leaks.slice(0, 6).join("; ") : `caregiver, client, anon: 0 rows and every INSERT/UPDATE refused on all ${newTables.length} tables`);
  // staff direct writes are refused too (every write path is an RPC)
  let staffWrites = [];
  for (const t of newTables) { const u = await as("mgrAll", `UPDATE public.${t} SET ${t === "care_plan_objective_needs" ? "objective_id = objective_id" : "id = id"}`); if (!u.err) staffWrites.push(t);
    const d = await as("aaA", `DELETE FROM public.${t}`); if (!d.err) staffWrites.push(t + "(delete)"); }
  rec("D-staff-direct-write", staffWrites.length === 0, staffWrites.length ? staffWrites.join(", ") : "manager UPDATE and agency_admin DELETE refused (permission denied) on every new table");
  // existing tables keep working: staff link/unlink with consistency guard
  await db.exec(`INSERT INTO client_orders VALUES ('${U(901)}','${A}','${U(101)}','${OX}'), ('${U(902)}','${A}','${U(102)}','${OY}')`);
  let g1, g2; try { await db.exec(`UPDATE client_orders SET care_plan_id='${U(501)}' WHERE id='${U(901)}'`); g1 = "ok"; } catch (e) { g1 = e.message; }
  try { await db.exec(`UPDATE client_orders SET care_plan_id='${U(501)}' WHERE id='${U(902)}'`); g2 = "ok"; } catch (e) { g2 = e.message; }
  rec("G-client_orders.care_plan_id", g1 === "ok" && /same client/.test(g2), `own client's plan: ${g1}; another client's plan: ${g2.slice(0, 70)}`);

  // ---- units trigger ----
  const avail = async () => Number((await db.query(`SELECT units_available FROM service_authorizations WHERE id='${U(601)}'`)).rows[0].units_available);
  const out = [`new auth 20 -> ${await avail()}`];
  await db.exec(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, shift_id, authorization_id, note_kind, service_date, units_scheduled, scheduled_start, client_arrived_at)
                 VALUES ('${U(711)}','${A}','${OX}','${U(101)}','${U(201)}','${U(301)}','${U(601)}','cls','2026-10-05',4,'2026-10-05 13:00+00','2026-10-05 13:03+00')`);
  const a1 = await avail(); out.push(`on-time 4 (3 min after) -> ${a1}`);
  await db.exec(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, shift_id, authorization_id, note_kind, service_date, units_scheduled, scheduled_start, client_arrived_at)
                 VALUES ('${U(712)}','${A}','${OX}','${U(101)}','${U(201)}','${U(302)}','${U(601)}','cls','2026-10-06',4,'2026-10-06 13:00+00','2026-10-06 13:06+00')`);
  const late = (await db.query(`SELECT units_used, arrived_late FROM progress_notes WHERE id='${U(712)}'`)).rows[0]; const a2 = await avail();
  out.push(`late 4 (6 min) used ${late.units_used} late=${late.arrived_late} -> ${a2}`);
  await db.exec(`UPDATE progress_notes SET voided = true WHERE id='${U(712)}'`); const a3 = await avail(); out.push(`void late -> ${a3}`);
  await db.exec(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, shift_id, authorization_id, note_kind, service_date, units_scheduled, billable)
                 VALUES ('${U(713)}','${A}','${OX}','${U(101)}','${U(201)}','${U(303)}','${U(601)}','cls','2026-10-07',4,false)`);
  const nb = (await db.query(`SELECT units_used FROM progress_notes WHERE id='${U(713)}'`)).rows[0]; const a4 = await avail(); out.push(`non-billable 4 used ${nb.units_used} -> ${a4}`);
  await db.exec(`UPDATE progress_notes SET units_used = 99, arrived_late = true WHERE id='${U(711)}'`); const forced = (await db.query(`SELECT units_used, arrived_late FROM progress_notes WHERE id='${U(711)}'`)).rows[0];
  await db.exec(`UPDATE service_authorizations SET units_available = 999 WHERE id='${U(601)}'`); const a5 = await avail();
  out.push(`direct set units_used=99 -> ${forced.units_used}/${forced.arrived_late}; units_available=999 -> ${a5}`);
  await db.exec(`DELETE FROM progress_notes WHERE id='${U(711)}'`); const a6 = await avail(); out.push(`delete on-time note -> ${a6}`);
  const edge = async (id, shift, d, arr) => { await db.exec(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, shift_id, authorization_id, note_kind, service_date, units_scheduled, scheduled_start, client_arrived_at)
      VALUES ('${id}','${A}','${OX}','${U(101)}','${U(201)}','${shift}','${U(601)}','cls','${d}',4,'${d} 13:00:00+00','${d} ${arr}+00')`);
    return (await db.query(`SELECT units_used, arrived_late FROM progress_notes WHERE id='${id}'`)).rows[0]; };
  const e500 = await edge(U(714), U(304), "2026-10-08", "13:05:00"), e501 = await edge(U(715), U(305), "2026-10-09", "13:05:01");
  rec("UNITS-5min-boundary", Number(e500.units_used) === 4 && e500.arrived_late === false && Number(e501.units_used) === 3 && e501.arrived_late === true,
    `+5:00 -> used ${e500.units_used} late=${e500.arrived_late} (exp 4/false); +5:01 -> used ${e501.units_used} late=${e501.arrived_late} (exp 3/true)`);
  await db.exec(`DELETE FROM progress_notes WHERE id IN ('${U(714)}','${U(715)}')`);
  rec("UNITS", a1 === 16 && Number(late.units_used) === 3 && late.arrived_late === true && a2 === 13 && a3 === 16 && Number(nb.units_used) === 0 && a4 === 16 && Number(forced.units_used) === 4 && forced.arrived_late === false && a5 === 16 && a6 === 20, out.join("; "));
  let dup; try { await db.exec(`INSERT INTO progress_notes (agency_id, virtual_office_id, client_id, caregiver_id, shift_id, authorization_id, note_kind, service_date) VALUES ('${A}','${OX}','${U(101)}','${U(201)}','${U(303)}','${U(601)}','cls','2026-10-07')`); dup = "accepted"; } catch (e) { dup = e.message; }
  rec("ONE-NOTE-PER-SHIFT", /one_note_per_shift/.test(dup), dup.slice(0, 80));
  let xs; try { await db.exec(`INSERT INTO service_authorizations (agency_id, virtual_office_id, client_id, auth_number, service_type, effective_date, expiration_date) VALUES ('${A}','${OZ}','${U(101)}','BAD','cls','2026-10-01','2026-10-31')`); xs = "accepted"; } catch (e) { xs = e.message; }
  rec("ROW-SCOPE", /office does not belong/.test(xs), `office of another agency: ${xs.slice(0, 70)}`);

  // ---- flag guard ----
  const flip = (who, col, office) => as(who, `UPDATE public.virtual_office SET ${col} = true WHERE id='${office}' RETURNING id`);
  const res = {};
  for (const who of ["mgrAll", "mgrX", "schX", "hrX"]) for (const col of ["compliance_enforcement_enabled", "care_plan_module_enabled"]) { const r = await flip(who, col, OX); res[`${who}.${col}`] = r.err ? "refused" : `changed ${r.rows.length}`; }
  for (const col of ["compliance_enforcement_enabled", "care_plan_module_enabled"]) { const r = await flip("aaA", col, OX); res[`aaA.${col}`] = r.err ? r.err : `changed ${r.rows.length}`; }
  for (const who of ["mgrAll", "mgrX", "schX", "hrX", "aaA"]) { const r = await as(who, `UPDATE public.virtual_office SET billing_week_start = 7 WHERE id='${OX}' RETURNING id`); res[`${who}.billing_week_start`] = r.err ? "refused" : `changed ${r.rows.length}`; }
  { const r = await as("mgrAll", `INSERT INTO public.virtual_office (id, agency_id, name, billing_week_start) VALUES (gen_random_uuid(),'${A}','new2',3)`); res["mgrAll.insert with billing week"] = r.err ? "refused" : "accepted"; }
  const r2 = await as("mgrAll", `UPDATE public.virtual_office SET name = 'Ripple renamed' WHERE id='${OX}' RETURNING id`); res["mgrAll.other column"] = r2.err ? r2.err : `changed ${r2.rows.length}`;
  const r3 = await as("mgrAll", `INSERT INTO public.virtual_office (id, agency_id, name, care_plan_module_enabled) VALUES (gen_random_uuid(),'${A}','new',true)`); res["mgrAll.insert with flag"] = r3.err ? "refused" : "accepted";
  const r4 = await as("aaB", `UPDATE public.virtual_office SET care_plan_module_enabled = true WHERE id='${OX}' RETURNING id`); res["agency-B admin on A office"] = r4.err ? r4.err : `changed ${r4.rows.length}`;
  const okFlags = Object.entries(res).every(([k, v]) => k.startsWith("aaA.") ? v === "changed 1" : k === "mgrAll.other column" ? v === "changed 1" : k === "agency-B admin on A office" ? v === "changed 0" : v === "refused");
  rec("FLAGS", okFlags, JSON.stringify(res));

  // ---- grants on every new function ----
  const fns = (await db.query(`SELECT p.proname, p.prosecdef, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'cp\\_%' OR p.proname = 'guard_virtual_office_flags') ORDER BY 1`)).rows;
  const bad = fns.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g));
  fns.forEach((f) => console.log(`   ${f.proname} definer=${f.prosecdef} EXECUTE: ${f.g}`));
  rec("ACL", bad.length === 0, `${fns.length} new functions; PUBLIC/anon EXECUTE on: ${bad.map((f) => f.proname).join(", ") || "none"}`);
  const tg = (await db.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name = ANY($1) AND (grantee='anon' OR (grantee='authenticated' AND privilege_type <> 'SELECT'))`, [newTables])).rows[0].n;
  rec("TABLE-GRANTS", tg === 0, `anon grants or authenticated non-SELECT grants on new tables: ${tg}`);
  // ---- DEV seed script (run twice: first inserts the missing rows, second is a checked no-op) ----
  const seedSql = fs.readFileSync(path.resolve(__dirname, "../../../scripts/seed/ripple_dev_reference_seed.sql"), "utf8");
  const notices = []; const seedRun = async () => { try { const r = await db.exec(seedSql); return "ok"; } catch (e) { return e.message; } };
  const s1 = await seedRun();
  const c1 = (await db.query(`SELECT (SELECT count(*)::int FROM credential_types WHERE agency_id='${A}' AND name <> 'A check') ct, (SELECT count(*)::int FROM office_service_types WHERE virtual_office_id='${OX}') ost`)).rows[0];
  const s2 = await seedRun();
  const c2 = (await db.query(`SELECT (SELECT count(*)::int FROM credential_types WHERE agency_id='${A}' AND name <> 'A check') ct, (SELECT count(*)::int FROM office_service_types WHERE virtual_office_id='${OX}') ost`)).rows[0];
  let s3; await db.exec(`UPDATE virtual_office SET agency_id='${B}' WHERE id='${OX}'`).catch(() => {}); s3 = await seedRun();
  rec("SEED", s1 === "ok" && c1.ct === 22 && c1.ost === 2 && s2 === "ok" && c2.ct === 22 && c2.ost === 2 && /DEV project only|not found/.test(s3),
    `run 1: ${s1}, credential types ${c1.ct} (exp 22), mappings ${c1.ost} (exp 2; 1 pre-existing); run 2: ${s2}, ${c2.ct}/${c2.ost}; wrong agency: ${s3.slice(0, 60)}`);
  console.log("summary: " + rows.map((r) => `${r.id}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
})();
