// W1 audit on PGlite: the events CHECK keeps all 44 previous types and adds exactly 6; the three
// measure-library writes each record one event (fail closed); signatures, ACLs and refusals unchanged.
// Usage: node tests/ripple/pglite/w1-audit.cjs   (local PGlite, no network)
const H = require("./harness.cjs");
const W1 = "20261014120000_w1_audit_event_types.sql";
const NEW_TYPES = ["measure_type_upserted", "measure_type_activated", "measure_type_deactivated", "measure_type_deleted", "authorization_corrected", "authorization_voided"];
const FNS = ["upsert_measure_type", "set_measure_type_active", "delete_measure_type"];

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(W1);   // everything before W1
  const { db, q, call, must } = t;
  const types = async () => (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`))[0].d.match(/'([a-z_]+)'::text/g).map((s) => s.slice(1, s.indexOf("'", 1)));
  const aclOf = async () => q(`SELECT p.oid::regprocedure::text sig, p.prosecdef, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.proname = ANY($1) ORDER BY 1`, [FNS]);
  const before = await types(), aclBefore = JSON.stringify(await aclOf());
  await H.applyFiles(db, [W1]);
  const after = await types(), aclAfter = JSON.stringify(await aclOf());
  rec("W1-check the CHECK keeps all 44 previous event types and adds exactly the 6 new ones",
    before.length === 44 && after.length === 50 && before.every((x) => after.includes(x)) && NEW_TYPES.every((x) => after.includes(x)),
    `before ${before.length}, after ${after.length}; added ${after.filter((x) => !before.includes(x)).join(", ")}`);
  rec("W1-acl same three signatures, SECURITY DEFINER, identical ACLs (authenticated only)", aclBefore === aclAfter && (await H.aclCheck(q, FNS)).ok, aclAfter);

  const UPS = "SELECT upsert_measure_type($1,$2::measure_kind,$3,$4::jsonb)";
  const ev = async (id) => q(`SELECT event_type, actor_id, agency_id, virtual_office_id, subject_type, payload FROM events WHERE subject_id = $1 ORDER BY occurred_at, event_type`, [id]);
  const id = await must("mgrX", UPS, [null, "tally", "ZZ Audit tally", null]);
  await must("mgrX", UPS, [id, null, "ZZ Audit tally 2", JSON.stringify(["a"])]);
  await must("mgrX", "SELECT set_measure_type_active($1,false)", [id]);
  await must("aaA", "SELECT set_measure_type_active($1,true)", [id]);
  await must("mgrX", "SELECT delete_measure_type($1)", [id]);
  const e = await ev(id);
  const okShape = e.length === 5 && e.every((x) => x.agency_id === H.A && x.virtual_office_id === null && x.subject_type === "measure_type" && x.payload.measure_type_id === id);
  rec("W1-events create, edit, deactivate, activate, delete each write one event (actor = caller, agency, no office, ids + kind only)",
    okShape && e.filter((x) => x.event_type === "measure_type_upserted").length === 2 && e.some((x) => x.event_type === "measure_type_deactivated" && x.actor_id === H.users.mgrX)
      && e.some((x) => x.event_type === "measure_type_activated" && x.actor_id === H.users.aaA) && e.some((x) => x.event_type === "measure_type_deleted" && x.payload.kind === "tally")
      && e.every((x) => !JSON.stringify(x.payload).includes("ZZ Audit")),
    e.map((x) => `${x.event_type}:${JSON.stringify(x.payload)}`).join(" | "));

  // fail closed: when the audit insert fails, the write itself is rolled back
  await db.exec(`CREATE FUNCTION zz_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit store down'; END $$;
                 CREATE TRIGGER zz_block BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION zz_block();`);
  const keep = await must("aaA", "SELECT 1"); void keep;
  const fc = await call("mgrX", UPS, [null, "tally", "ZZ Blocked", null]);
  const mtCount = (await q(`SELECT count(*)::int n FROM measure_types WHERE label = 'ZZ Blocked'`))[0].n;
  await db.exec(`DROP TRIGGER zz_block ON events; DROP FUNCTION zz_block();`);
  const live = await must("mgrX", UPS, [null, "tally", "ZZ Live", null]);
  const fc2 = await (async () => { await db.exec(`CREATE FUNCTION zz_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit store down'; END $$;
    CREATE TRIGGER zz_block BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION zz_block();`);
    const r1 = await call("mgrX", "SELECT set_measure_type_active($1,false)", [live]); const r2 = await call("mgrX", "SELECT delete_measure_type($1)", [live]);
    await db.exec(`DROP TRIGGER zz_block ON events; DROP FUNCTION zz_block();`); return [r1, r2]; })();
  const liveRow = (await q(`SELECT is_active FROM measure_types WHERE id = $1`, [live]))[0];
  rec("W1-failclosed with the audit insert failing, create / deactivate / delete are refused and nothing changes",
    /audit store down/.test(fc.err || "") && mtCount === 0 && fc2.every((r) => /audit store down/.test(r.err || "")) && liveRow && liveRow.is_active === true,
    `create "${fc.err || "ACCEPTED"}", rows ${mtCount}; deactivate/delete ${fc2.map((r) => r.err ? "refused" : "ACCEPTED").join("/")}; row still active ${liveRow && liveRow.is_active}`);

  // behaviour unchanged: refusals and denials as in UI S2
  const sysId = (await q(`SELECT id FROM measure_types WHERE agency_id IS NULL LIMIT 1`))[0].id;
  const r = [await call("aaA", UPS, [sysId, null, "Hacked", null]), await call("schX", UPS, [null, "tally", "ZZ sch", null]),
    await call("aaB", "SELECT set_measure_type_active($1,false)", [live]), await call("mgrX", UPS, [null, "tally", "zz LIVE", null])];
  rec("W1-same system types read-only, scheduler and other-agency admin refused, duplicate label refused; no event written for a refused call",
    H.DENY.test(r[0].err || "") && H.DENY.test(r[1].err || "") && H.DENY.test(r[2].err || "") && /already exists/.test(r[3].err || "")
      && (await q(`SELECT count(*)::int n FROM events WHERE subject_id = $1`, [sysId]))[0].n === 0,
    r.map((x) => x.err || "ACCEPTED").join(" | "));
  const old = await call("aaA", `INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'shift_created','staff','shift','{}') RETURNING 1`, []);
  const ins = await db.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) SELECT $1, t, 'staff', 'x', '{}' FROM unnest($2::text[]) t RETURNING 1`, [H.A, before]);
  const bad = await call("aaA", "SELECT 1").then(async () => { try { await db.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'zz_unknown','staff','x','{}')`, [H.A]); return "ACCEPTED"; } catch (x) { return "refused"; } });
  void old;
  rec("W1-old every one of the 44 previous types still inserts; an unknown type is still refused", ins.rows.length === 44 && bad === "refused", `${ins.rows.length} inserted; unknown ${bad}`);
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });
