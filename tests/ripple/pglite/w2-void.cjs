// W2 void on PGlite (owner approval, round 3 review): schema, void_service_authorization rules and
// audit, every reader skipping voided rows, re-entering a voided number, ACLs kept, and no change for
// data without voided rows (projection, onboarding, eligibility read before vs after the migration).
// Usage: node tests/ripple/pglite/w2-void.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
const W2 = "20261015120000_w2_void_authorization.sql";
const READERS = ["cp_projected_units", "cp_authorization_projection", "review_progress_note", "cp_client_onboarding", "cp_check_order_service_authorization",
  "create_service_authorization", "correct_service_authorization", "get_client_authorizations", "list_authorization_risk"];
let seq = 0; const nid = () => H.U(9500 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(W2); const { db, q, day, call, must } = t;
  const { CX, G, OX } = H;
  const shift = async (clientId, off, assigned = true) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'open',1)`, [id, H.A, clientId, await day(off), OX]);
    if (assigned) await db.query(`INSERT INTO shift_assignments (shift_id, caregiver_id, status) VALUES ($1,$2,'scheduled')`, [id, G]);
    return id; };
  const AUTH = (c, num, eff, exp, units = 40) => must("mgrX", "SELECT create_service_authorization($1,'cls',$2,$3,$4::date,$5::date)", [c, num, units, eff, exp]);
  const client = async (first) => { const id = nid(); await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,$3,'Fixture',$4)`, [id, H.A, first, OX]); return id; };

  // ---------- no-change baseline: outputs of the readers BEFORE the migration ----------
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) })]);
  const a1 = await AUTH(CX, "ZZ-A1", await day(-30), await day(20));
  const a2 = await AUTH(CX, "ZZ-A2", await day(-30), await day(200), 100);
  await shift(CX, 3); await shift(CX, 30); await shift(CX, 5, false);
  const snapReaders = async () => JSON.stringify({
    proj: (await q(`SELECT cp_projected_units($1,'cls',$2::date,4,NULL) v`, [CX, await day(3)]))[0].v,
    proj2: (await q(`SELECT cp_projected_units($1,'cls',$2::date,4,NULL) v`, [CX, await day(30)]))[0].v,
    onb: (await q(`SELECT cp_client_onboarding($1) v`, [CX]))[0].v.items,
    units: (await call("mgrX", "SELECT get_client_authorizations($1)", [CX])).v.authorizations.map(({ void_available, ...r }) => r),
    risk: (await call("mgrX", "SELECT list_authorization_risk($1,60)", [OX])).v.map(({ client_name, ...r }) => r),
  });
  const before = await snapReaders();
  const acl = async () => JSON.stringify(await q(`SELECT p.oid::regprocedure::text sig, p.prosecdef, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [READERS]));
  const aclBefore = await acl();
  await H.applyFiles(db, [W2]);
  const after = await snapReaders();
  rec("V0 no voided rows: projection (eligibility), onboarding, units table and risk list give identical output before and after the migration", before === after, before === after ? "identical" : `before ${before.slice(0, 200)} | after ${after.slice(0, 200)}`);
  rec("V0-acl the nine changed readers keep their signatures, SECURITY DEFINER flags and ACLs", aclBefore === (await acl()), "compared proacl before/after");
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='service_authorizations' AND column_name LIKE 'void%' ORDER BY 1`);
  const idx = await q(`SELECT indexdef FROM pg_indexes WHERE tablename='service_authorizations' AND indexname='service_authorizations_active_number_key'`);
  const oldCon = await q(`SELECT 1 FROM pg_constraint WHERE conname='service_authorizations_agency_id_auth_number_key'`);
  rec("V1 schema: voided_at / voided_by / void_reason, the void check, a partial unique index over active rows; the old table constraint is gone",
    cols.map((c) => c.column_name).join() === "void_reason,voided_at,voided_by" && /WHERE \(voided_at IS NULL\)/.test(idx[0]?.indexdef || "") && oldCon.length === 0, idx[0]?.indexdef);

  // ---------- void rules ----------
  const VOID = "SELECT void_service_authorization($1,$2)";
  const ga = (await call("mgrX", "SELECT get_client_authorizations($1)", [CX])).v.authorizations;
  rec("V2 void_available: false for A1 (assigned shifts are pending on it) and for A2 (the day-30 shift)... computed by the server",
    ga.find((x) => x.id === a1).void_available === false && ga.find((x) => x.id === a2).void_available === false, ga.map((x) => `${x.auth_number}:${x.void_available}`).join(" "));
  const pend = await call("mgrX", VOID, [a1, "mistake"]);
  const C2 = await client("Vera");
  const b1 = await AUTH(C2, "ZZ-B1", await day(-10), await day(100));
  const noteAuth = await AUTH(C2, "ZZ-B2", await day(-10), await day(100));
  await db.query(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, authorization_id, note_kind, service_type, service_date, units_scheduled, billable, status, voided)
    VALUES ($1,$2,$3,$4,$5,$6,'cls','cls',$7::date,4,true,'draft',true)`, [nid(), H.A, OX, C2, G, noteAuth, await day(-2)]);
  const charged = await call("mgrX", VOID, [noteAuth, "mistake"]);
  const ord = nid(), osv = nid(); const orderAuth = await AUTH(C2, "ZZ-B3", await day(-10), await day(100));
  await db.query(`INSERT INTO client_orders (id, agency_id, client_id, virtual_office_id) VALUES ($1,$2,$3,$4)`, [ord, H.A, C2, OX]);
  await db.query(`INSERT INTO order_services (id, order_id, care_type_code, service_authorization_id) VALUES ($1,$2,'CLS0001',$3)`, [osv, ord, orderAuth]);
  const linked = await call("mgrX", VOID, [orderAuth, "mistake"]);
  const noReason = await call("mgrX", VOID, [b1, " "]);
  const dl = []; for (const w of ["schX", "hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, VOID, [b1, "x"]); if (!r.err || !H.DENY.test(r.err)) dl.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("V3 refused: pending projection on it; any note referencing it (even a voided note); a schedule line pointing at it; no reason; 8 other roles/scopes (generic)",
    /Scheduled visits are counted against/.test(pend.err || "") && /Visits were charged/.test(charged.err || "") && /service schedule points at/.test(linked.err || "")
      && /reason/.test(noReason.err || "") && dl.length === 0, [pend, charged, linked, noReason].map((x) => (x.err || "ACCEPTED").slice(0, 40)).join(" | ") + (dl.length ? " LEAK " + dl.join("; ") : ""));
  const ok = await call("mgrX", VOID, [b1, "Entered twice by mistake"]);
  const row = (await q(`SELECT voided_at IS NOT NULL v, voided_by, void_reason FROM service_authorizations WHERE id = $1`, [b1]))[0];
  const ev = await q(`SELECT payload, actor_id, virtual_office_id FROM events WHERE event_type = 'authorization_voided' AND subject_id = $1`, [b1]);
  const again = await call("mgrX", VOID, [b1, "again"]);
  rec("V4 an unused authorization is voided (stays on record with who/why), audited once with the reason; voiding again is refused",
    !ok.err && row.v && row.voided_by === H.users.mgrX && row.void_reason === "Entered twice by mistake" && ev.length === 1 && ev[0].payload.reason === "Entered twice by mistake"
      && ev[0].virtual_office_id === OX && /already voided/.test(again.err || ""), `${ok.err || "voided"}; events ${ev.length}; again "${again.err}"`);

  // ---------- readers skip voided ----------
  const C3 = await client("Otto");
  const v3 = await AUTH(C3, "ZZ-C1", await day(-10), await day(30));
  const pBefore = (await q(`SELECT cp_projected_units($1,'cls',$2::date,4,NULL) v`, [C3, await day(3)]))[0].v.status;
  const oBefore = (await q(`SELECT cp_client_onboarding($1) v`, [C3]))[0].v.items.find((i) => i.key === "authorization").status;
  await must("mgrX", VOID, [v3, "wrong client"]);
  const pAfter = (await q(`SELECT cp_projected_units($1,'cls',$2::date,4,NULL) v`, [C3, await day(3)]))[0].v.status;
  const oAfter = (await q(`SELECT cp_client_onboarding($1) v`, [C3]))[0].v.items.find((i) => i.key === "authorization").status;
  const gs = (await call("mgrX", "SELECT get_client_onboarding_status($1)", [C3])).v.items.find((i) => i.key === "authorization").status;
  const tab = (await call("mgrX", "SELECT get_client_authorizations($1)", [C3])).v.authorizations.length;
  const risk = (await call("mgrX", "SELECT list_authorization_risk($1,60)", [OX])).v;
  rec("V5 projection (eligibility): 'ok' -> 'missing'; onboarding (cp_client_onboarding and get_client_onboarding_status): complete -> missing; the units table and the risk list drop it",
    pBefore === "ok" && pAfter === "missing" && oBefore === "complete" && oAfter === "missing" && gs === "missing" && tab === 0 && !risk.some((r) => r.authorization_id === v3),
    `projection ${pBefore}->${pAfter}; onboarding ${oBefore}->${oAfter} (RPC ${gs}); units rows ${tab}; risk has it ${risk.some((r) => r.authorization_id === v3)}`);
  // review: a voided authorization expiring earlier is never picked; with only a voided one the note isn't billable
  const C4 = await client("Ruth");
  const early = await AUTH(C4, "ZZ-D1", await day(-10), await day(10));
  const late = await AUTH(C4, "ZZ-D2", await day(-10), await day(100));
  await must("mgrX", VOID, [early, "duplicate"]);
  const mkNote = async (c) => { const id = nid(); await db.query(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, note_kind, service_type, service_date, units_scheduled, billable, status)
      VALUES ($1,$2,$3,$4,$5,'cls','cls',$6::date,4,true,'submitted')`, [id, H.A, OX, c, G, await day(-1)]); return id; };
  const r1 = await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [await mkNote(C4)]);
  const C5 = await client("Sam"); const only = await AUTH(C5, "ZZ-E1", await day(-10), await day(100)); await must("mgrX", VOID, [only, "mistake"]);
  const r2 = await call("mgrX", "SELECT review_progress_note($1,true,NULL)", [await mkNote(C5)]);
  rec("V6 review: the earlier-expiring voided authorization is skipped (the active one is charged); with only a voided one: 'no authorization for this service'",
    r1.authorization_id === late && /no authorization for this service/.test(r2.err || ""), `charged ${r1.authorization_id === late ? "active" : r1.authorization_id}; only-voided "${(r2.err || "ACCEPTED").slice(0, 70)}"`);
  // order line, correct, re-enter
  const ord2 = nid(); await db.query(`INSERT INTO client_orders (id, agency_id, client_id, virtual_office_id) VALUES ($1,$2,$3,$4)`, [ord2, H.A, C5, OX]);
  let trig = "ACCEPTED"; try { await db.query(`INSERT INTO order_services (id, order_id, care_type_code, service_authorization_id) VALUES ($1,$2,'CLS0001',$3)`, [nid(), ord2, only]); } catch (e) { trig = e.message; }
  const cor = await call("mgrX", "SELECT correct_service_authorization($1,$2::jsonb,$3)", [only, JSON.stringify({ units_authorized: 50 }), "x"]);
  const reenter = await call("mgrX", "SELECT create_service_authorization($1,'cls','zz-e1',10,$2::date,$3::date)", [C5, await day(0), await day(50)]);
  const dupActive = await call("mgrX", "SELECT create_service_authorization($1,'cls','ZZ-E1',10,$2::date,$3::date)", [C5, await day(0), await day(50)]);
  let idxDup = "ACCEPTED"; try { await db.query(`INSERT INTO service_authorizations (agency_id, virtual_office_id, client_id, auth_number, service_type, units_authorized, effective_date, expiration_date) SELECT agency_id, virtual_office_id, client_id, auth_number, service_type, 1, effective_date, expiration_date FROM service_authorizations WHERE id = $1`, [reenter.v]); } catch (e) { idxDup = e.message; }
  rec("V7 a schedule line can't point at a voided authorization; correcting a voided one is refused; its number may be entered again (case-insensitive), but not twice while active (RPC and index)",
    /This authorization was voided/.test(trig) && /was voided/.test(cor.err || "") && !reenter.err && /already exists/.test(dupActive.err || "") && /duplicate key|unique/.test(idxDup),
    `trigger "${trig.slice(0, 40)}"; correct "${(cor.err || "ACCEPTED").slice(0, 40)}"; re-enter ${reenter.err || "ok"}; active dup "${(dupActive.err || "ACCEPTED").slice(0, 40)}"; index "${idxDup.slice(0, 40)}"`);
  const fullName = (await call("mgrX", "SELECT list_authorization_risk($1,60)", [OX])).v.find((r) => r.authorization_id === a1);
  rec("V8 risk list shows the full client name (polish 3)", fullName && fullName.client_name === "Carla Fixture", fullName && fullName.client_name);
  const a = await H.aclCheck(q, ["void_service_authorization"]);
  rec("ACL void_service_authorization SECURITY DEFINER + authenticated only", a.ok, a.detail);
  void plan; void osv;
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });
