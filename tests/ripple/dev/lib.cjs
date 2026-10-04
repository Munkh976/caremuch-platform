// Ripple care-plan module — shared DEV test library: environment, disposable fixtures, DB clock,
// no-break (NB1) check, verified teardown. Used by every suite in this folder.
//
// Real JWTs through PostgREST against the LINKED Supabase project (DEV). Every run creates its own
// disposable agency, offices, users and rows, tagged with a run id, and deletes them at the end
// (teardown re-queries and prints what is left). DEV runs need the owner's approval.
//
// Configuration (read like the app reads it: process.env first, then the repo's .env / .env.local):
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PROJECT_ID   (public app config)
//   SUPABASE_SERVICE_ROLE_KEY   optional; otherwise fetched in memory with `npx supabase projects
//                               api-keys` (never printed or written)
//   SUPABASE_DB_PASSWORD        READ-ONLY catalog/clock/count checks only (every connection runs
//                               SET default_transaction_read_only = on); never printed or written
//   RIPPLE_TEST_AGENCY_ID       optional; the DEV demo agency the fixtures attach to
// Time: every "now", deadline and date window comes from the DATABASE clock (dbNow / dbDay), never
// from this machine's clock (owner rule after the B1 A1 clock-skew finding).
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const REPO = path.resolve(__dirname, "../../..");
const fileEnv = {};
for (const f of [".env", ".env.local"]) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
if (!URL_ || !ANON || !REF) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID not set");
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error("SUPABASE_DB_PASSWORD not set (read-only checks need it)");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const SUITE = path.basename(process.argv[1] || "suite", ".cjs");
const LABEL = process.argv[2] || "after";
const RUN = `${SUITE}-${LABEL}-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { stdio: ["ignore", "pipe", "ignore"], cwd: REPO }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [] }; const rows = []; const log = (...a) => console.log(...a);
const rec = (id, outcome, detail) => { rows.push({ id, outcome }); log(`${id} ${outcome}${detail ? " :: " + detail : ""}`); };
const pass = (b) => (b ? "PASS" : "FAIL");
const pgConfig = () => ({ host: `db.${REF}.supabase.co`, port: 5432, user: "postgres", database: "postgres", password: process.env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
const BASELINE = path.join(__dirname, "baseline");

async function ins(t, row, idcol = "id") {
  const { data, error } = await admin.from(t).insert(row).select(idcol);
  if (error) throw new Error(`${t}: ${error.message}`);
  const out = data.map((d) => d[idcol]); (ids[t] = ids[t] || []).push(...out); return Array.isArray(row) ? out : out[0];
}
async function mkUser(tag, role, agency, office = null, restricted = false) {
  const e = `sec-${tag}${SUFFIX}`, p = pw();
  const { data, error } = await admin.auth.admin.createUser({ email: e, password: p, email_confirm: true, user_metadata: { full_name: `ZZ ${tag}`, agency_id: agency } });
  if (error) throw new Error(`user ${tag}: ${error.message}`); ids.users.push(data.user.id);
  const { error: pe } = await admin.from("profiles").upsert({ id: data.user.id, email: e, full_name: `ZZ ${tag}`, agency_id: agency, virtual_office_id: office, office_restricted: restricted });
  if (pe) throw new Error(`profile ${tag}: ${pe.message}`);
  if (role) { const { error: re } = await admin.from("user_roles").insert({ user_id: data.user.id, role, agency_id: agency }); if (re) throw new Error(`role ${tag}: ${re.message}`); }
  const c = createClient(URL_, ANON, opts); const { error: se } = await c.auth.signInWithPassword({ email: e, password: p }); if (se) throw new Error(`signIn ${tag}: ${se.message}`);
  return { id: data.user.id, c };
}
// "now" always comes from the database, never from this machine's clock (owner rule after B1 A1).
let _dbc = null;
async function dbNow() {
  if (!_dbc) { _dbc = new Client(pgConfig());
    await _dbc.connect(); await _dbc.query("SET default_transaction_read_only = on"); }
  return (await _dbc.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
}
async function reportSkew() {
  const t1 = Date.now(); const db = Date.parse(await dbNow()); const t2 = Date.now();
  log(`clock skew: local minus DB = ${Math.round((t1 + t2) / 2 - db)} ms (round trip ${t2 - t1} ms); all time windows use the DB clock`);
}
async function pgRead(fn) {
  const c = new Client(pgConfig());
  await c.connect(); await c.query("SET default_transaction_read_only = on");
  try { return await fn(c); } finally { await c.end(); }
}

async function setup() {
  const F = {};
  F.B = await ins("agency", { agency_name: `ZZ Agency B ${RUN}` });
  [F.OX, F.OY] = await ins("virtual_office", [{ agency_id: A, name: `ZZ CP X ${RUN}`, is_demo: true }, { agency_id: A, name: `ZZ CP Y ${RUN}`, is_demo: true }]);
  F.OZ = await ins("virtual_office", { agency_id: F.B, name: `ZZ CP Z ${RUN}`, is_demo: true });
  F.mgrX = await mkUser("mgrx", "manager", A, F.OX, true);
  F.mgrAll = await mkUser("mgrall", "manager", A);
  F.schX = await mkUser("schx", "scheduler", A, F.OX, true);
  F.hrX = await mkUser("hrx", "hr_staff", A, F.OX, true);
  F.aaA = await mkUser("aaa", "agency_admin", A);
  F.aaB = await mkUser("aab", "agency_admin", F.B);
  F.cg = await mkUser("cg", "caregiver", A);
  F.cl = await mkUser("cl", "client", A);
  const cl = (tag, agency, office, user = null) => ({ agency_id: agency, virtual_office_id: office, user_id: user, first_name: "ZZ", last_name: `${tag} ${RUN}`, phone: "555-0170", address: "1 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  [F.CX, F.CY] = await ins("clients", [cl("CX", A, F.OX, F.cl.id), cl("CY", A, F.OY)]);
  F.CZ = await ins("clients", cl("CZ", F.B, F.OZ));
  F.G = await ins("caregivers", { agency_id: A, virtual_office_id: F.OX, user_id: F.cg.id, first_name: "ZZ", last_name: `G ${RUN}`, email: `sec-g${SUFFIX}`, phone: "555-0171", is_demo: true });
  await ins("caregiver_skills", { caregiver_id: F.G, care_type_code: "CLS0001", is_demo: true });   // qualified, so assign can succeed
  F.GZ = await ins("caregivers", { agency_id: F.B, virtual_office_id: F.OZ, first_name: "ZZ", last_name: `GZ ${RUN}`, email: `sec-gz${SUFFIX}`, phone: "555-0172", is_demo: true });
  const sh = (d) => ({ agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: d, start_time: "13:00", end_time: "14:00", duration_hours: 1, status: "open", is_demo: true });
  F.shifts = await ins("shifts", [sh("2026-11-02"), sh("2026-11-03"), sh("2026-11-04"), sh("2026-11-05"), sh("2026-11-06"), sh("2026-11-07")]);
  return F;
}

// ---------------------------------------------------------------------------------------------
async function noBreak(F) {
  const out = {};
  out.eligibility_fn = await pgRead(async (c) => (await c.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) h FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('check_assignment_eligibility','check_assignment_eligibility_bulk','check_caregiver_shifts_eligibility','assign_caregiver_to_shift') ORDER BY 1`)).rows.map((r) => `${r.proname}:${r.h}`).join(" "));
  const codes = (j) => j ? `eligible=${j.eligible} hard=[${(j.hard || []).map((x) => x.code).sort()}] soft=[${(j.soft || []).map((x) => x.code).sort()}] advisory=[${(j.advisory || []).map((x) => x.code).sort()}]` : "null";
  const e1 = await F.mgrAll.c.rpc("check_assignment_eligibility", { _shift_id: F.shifts[0], _caregiver_id: F.G });
  out.single = e1.error ? `ERR ${e1.error.message}` : codes(e1.data);
  const eb = await F.mgrAll.c.rpc("check_assignment_eligibility_bulk", { _shift_id: F.shifts[0], _caregiver_ids: [F.G] });
  out.bulk = eb.error ? `ERR ${eb.error.message}` : JSON.stringify(eb.data).replace(/"(weekly_hours|projected_weekly_hours)":[0-9.]+/g, "").length + " chars";
  const ec = await F.cg.c.rpc("check_caregiver_shifts_eligibility", { _shift_ids: [F.shifts[3]] });
  out.caregiver_side = ec.error ? `ERR ${ec.error.message}` : `${(ec.data || []).length} rows`;
  const mc = await F.mgrAll.c.functions.invoke("match-caregiver", { body: { shiftId: F.shifts[0] } });
  out.smart_match = mc.error ? `ERR ${mc.error.context?.status}` : `ok (${Array.isArray(mc.data?.matches) ? "matches array" : typeof mc.data})`;
  for (const [i, method] of [[0, "manual"], [1, "ai_suggested"], [2, "auto_assigned"]]) {
    const r = await F.mgrAll.c.rpc("assign_caregiver_to_shift", { _shift_id: F.shifts[i], _caregiver_id: F.G, _method: method, _notes: "Phase A no-break test", _override_reason: "Phase A no-break test (disposable fixture)" });
    const { data: s } = await admin.from("shifts").select("caregiver_id").eq("id", F.shifts[i]).single();
    out[`assign_${method}`] = r.error ? `ERR ${r.error.message}` : `ok; shift.caregiver_id set=${s.caregiver_id === F.G}`;
  }
  return out;
}


// ---- shared fixture extension (Phase B1 onwards): office-Y manager, system_admin, more caregivers ----
const DENY = /Not found or not allowed|permission denied/;

async function setupB1(F) {
  F.mgrY = await mkUser("mgry", "manager", A, F.OY, true);
  F.sysA = await mkUser("sysa", "system_admin", A);
  F.GX2 = await ins("caregivers", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `GX2 ${RUN}`, email: `sec-gx2${SUFFIX}`, phone: "555-0173", is_demo: true });
  F.GY = await ins("caregivers", { agency_id: A, virtual_office_id: F.OY, first_name: "ZZ", last_name: `GY ${RUN}`, email: `sec-gy${SUFFIX}`, phone: "555-0174", is_demo: true });
  return F;
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); return error ? { err: error.message, code: error.code } : { v: data }; };
const evIds = new Set();
async function eventsSince(t0, offices) {
  const { data } = await admin.from("events").select("id, event_type, payload, virtual_office_id, subject_id").gte("created_at", t0).order("created_at");
  return (data || []).filter((e) => offices.includes(e.virtual_office_id) || e.subject_id);
}

async function dbDay(off, tz = "America/New_York") {
  return pgRead(async (c) => (await c.query(`SELECT ((now() AT TIME ZONE $1)::date + $2::int)::text d`, [tz, off])).rows[0].d);
}

// ---- verified teardown ----
async function teardownB1(F) {
  const del = async (t, col, list) => { for (const id of list || []) await admin.from(t).delete().eq(col, id); };
  if (F) {
    const clientIds = [F.CX, F.CY, F.CZ].filter(Boolean), offices = [F.OX, F.OY, F.OZ].filter(Boolean);
    for (const c of clientIds) { await admin.from("plan_training_forms").delete().eq("client_id", c); await admin.from("plan_inservice_forms").delete().eq("client_id", c);
      await admin.from("client_documents").delete().eq("client_id", c); await admin.from("care_plans").delete().eq("client_id", c); await admin.from("service_authorizations").delete().eq("client_id", c); }
    for (const g of [F.G, F.GX2, F.GY, F.GZ].filter(Boolean)) await admin.from("caregiver_certifications").delete().eq("caregiver_id", g);
    for (const o of offices) { await admin.from("office_service_types").delete().eq("virtual_office_id", o); await admin.from("events").delete().eq("virtual_office_id", o); }
    await del("form_templates", "id", ids.form_templates);
    for (const id of evIds) await admin.from("events").delete().eq("id", id);
    for (const t of ids.form_templates || []) await admin.from("events").delete().eq("subject_id", t);
  }
}
async function teardown(F) {
  const del = async (t, col, list) => { for (const id of list || []) await admin.from(t).delete().eq(col, id); };
  const allIds = (t) => ids[t] || [];
  await del("progress_notes", "id", allIds("progress_notes"));
  for (const t of ["billing_batches", "client_documents", "plan_training_records", "plan_inservice_forms", "plan_training_forms", "service_authorizations", "office_service_types", "care_plans", "form_templates", "measure_types", "credential_types"]) await del(t, "id", allIds(t));
  const shiftIds = F ? F.shifts : allIds("shifts");
  for (const s of shiftIds || []) { await admin.from("shift_assignments").delete().eq("shift_id", s); await admin.from("events").delete().eq("subject_id", s); }
  await del("shifts", "id", shiftIds);
  await del("caregiver_skills", "id", allIds("caregiver_skills"));
  await del("clients", "id", allIds("clients")); await del("caregivers", "id", allIds("caregivers"));
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  await del("virtual_office", "id", allIds("virtual_office")); await del("agency", "id", allIds("agency"));
  const left = [];
  for (const t of ["progress_notes", "service_authorizations", "care_plans", "form_templates", "measure_types", "credential_types", "office_service_types", "billing_batches", "client_documents", "plan_training_forms", "shifts", "clients", "caregivers", "caregiver_skills", "virtual_office", "agency"])
    for (const id of allIds(t)) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const s of shiftIds || []) { for (const t of ["shift_assignments", "events"]) { const { data } = await admin.from(t).select("id").eq(t === "events" ? "subject_id" : "shift_id", s); if (data && data.length) left.push(`${t} for shift ${s}`); } }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${Object.entries(ids).filter(([k]) => k !== "users").map(([k, v]) => `${v.length} ${k}`).join(", ")} → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query, incl. shift_assignments + events)"}`);
}

async function teardownB2(F) {
  if (!F) return;
  const clients = [F.CX, F.CY, F.CZ, F.CR1, F.CR2, F.CR3].filter(Boolean);
  for (const c of clients) await admin.from("progress_notes").delete().eq("client_id", c);
  for (const s of F.b2shifts || []) { await admin.from("shift_assignments").delete().eq("shift_id", s); await admin.from("events").delete().eq("subject_id", s); }
  for (const s of F.b2shifts || []) await admin.from("shifts").delete().eq("id", s);
  for (const o of [F.OX, F.OY, F.OZ].filter(Boolean)) await admin.from("billing_batches").delete().eq("virtual_office_id", o);
  for (const k of Object.values(F.b2 || {})) await admin.from("events").delete().eq("subject_id", k);
}

// ---- NB1: assign paths + eligibility vs the saved baseline (baseline/nobreak_before.json) ----
// Default: the BEHAVIOUR keys must be identical; the eligibility function hashes are printed (they
// change by design whenever a phase replaces those functions). RIPPLE_NB1_HASHES=1 also compares
// the hashes (use it right before pushing a migration that must NOT touch those functions).
// RIPPLE_WRITE_NOBREAK_BASELINE=1 rewrites the baseline (intentional refresh only; see README).
async function checkNoBreak(F) {
  const nb = await noBreak(F);
  const file = path.join(BASELINE, "nobreak_before.json");
  if (process.env.RIPPLE_WRITE_NOBREAK_BASELINE === "1") {
    fs.writeFileSync(file, JSON.stringify(nb, null, 1) + "\n");
    rec("NB0 no-break baseline WRITTEN (intentional refresh)", "INFO", JSON.stringify(nb)); return nb;
  }
  const base = JSON.parse(fs.readFileSync(file, "utf8"));
  const strict = process.env.RIPPLE_NB1_HASHES === "1";
  const keys = Object.keys(base).filter((k) => strict || k !== "eligibility_fn");
  const diff = keys.filter((k) => base[k] !== nb[k]);
  rec(`NB1 assign paths + eligibility identical to the saved baseline (${strict ? "function hashes included" : "behaviour keys"})`, pass(diff.length === 0),
    diff.length ? diff.map((k) => `${k}: base "${base[k]}" now "${nb[k]}"`).join("; ") : `identical (${keys.length} keys)`);
  if (!strict) log(`   eligibility function hashes now: ${nb.eligibility_fn}${nb.eligibility_fn === base.eligibility_fn ? " (= baseline)" : " (differ from the baseline: expected after a phase that replaced them)"}`);
  return nb;
}
async function closeDb() { if (_dbc) { await _dbc.end(); _dbc = null; } }
function summary() {
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.outcome}`).join(" "));
  if (rows.some((r) => r.outcome === "FAIL")) process.exitCode = 1;
}

module.exports = { A, REF, URL_, ANON, LABEL, RUN, SUFFIX, REPO, BASELINE, admin, opts, createClient, Client, pgConfig, fs, path,
  ids, rows, log, rec, pass, ins, mkUser, dbNow, reportSkew, pgRead, setup, noBreak, checkNoBreak, DENY, setupB1, rpc, evIds,
  eventsSince, dbDay, teardownB1, teardown, teardownB2, closeDb, summary };
