// W1 audit on DEV (owner approval, UI round 2 review): events CHECK + measure-library audit events.
// Usage: node tests/ripple/dev/w1-audit.cjs <before|after>
//   before: the CHECK has the 44 previous types; a measure-type write records no event; NB1
//   after : 50 types; create / edit / deactivate / activate / delete each record one event through
//           real logins (actor, agency, no office, ids + kind only); refusals unchanged; ACLs; NB1
// DEV run: disposable fixtures, verified teardown (events of the fixture measure types included).
const { A, REF, LABEL, RUN, admin, log, rec, pass, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, teardownB1, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");

const NEW_TYPES = ["measure_type_upserted", "measure_type_activated", "measure_type_deactivated", "measure_type_deleted", "authorization_corrected", "authorization_voided"];
const FNS = ["upsert_measure_type", "set_measure_type_active", "delete_measure_type"];
const created = [];
const checkTypes = () => pgRead(async (c) => (await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`)).rows[0].d
  .match(/'([a-z_]+)'::text/g).map((s) => s.slice(1, s.indexOf("'", 1))));
const eventsFor = (id) => pgRead(async (c) => (await c.query(`SELECT event_type, actor_id, agency_id, virtual_office_id, payload FROM public.events WHERE subject_id = $1 ORDER BY occurred_at, event_type`, [id])).rows);

async function before(F) {
  const t = await checkTypes();
  rec("B0 the CHECK has the 44 previous types and none of the 6 new ones", pass(t.length === 44 && !NEW_TYPES.some((x) => t.includes(x))), `${t.length} types`);
  const r = await rpc(F.mgrX.c, "upsert_measure_type", { _id: null, _kind: "tally", _label: `ZZ W1 before ${RUN}`, _default_options: null });
  if (r.v) created.push(r.v);
  const e = r.v ? await eventsFor(r.v) : [];
  rec("B1 a measure-type create works and records no event yet", pass(!!r.v && e.length === 0), r.err || `${e.length} events`);
}

async function after(F) {
  const t = await checkTypes();
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [FNS])).rows);
  rec("A0 the CHECK has 50 types (44 + 6); the 3 RPCs keep SECURITY DEFINER + authenticated only",
    pass(t.length === 50 && NEW_TYPES.every((x) => t.includes(x)) && acl.length === 3 && acl.every((f) => f.d && /authenticated=X/.test(f.acl) && !/(^|[{,])=X|anon=X/.test(f.acl))),
    `${t.length} types; ${acl.map((f) => `${f.proname} ${f.acl}`).join("; ")}`);
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const id = await must(F.mgrX.c, "upsert_measure_type", { _id: null, _kind: "tally", _label: `ZZ W1 audit ${RUN}`, _default_options: null }); created.push(id);
  await must(F.mgrX.c, "upsert_measure_type", { _id: id, _kind: null, _label: `ZZ W1 audit 2 ${RUN}`, _default_options: ["a"] });
  await must(F.mgrX.c, "set_measure_type_active", { _id: id, _active: false });
  await must(F.aaA.c, "set_measure_type_active", { _id: id, _active: true });
  await must(F.mgrX.c, "delete_measure_type", { _id: id });
  const e = await eventsFor(id);
  rec("A1 create, edit, deactivate, activate, delete each record one event (actor = caller, agency, no office, ids + kind only, no label)",
    pass(e.length === 5 && e.every((x) => x.agency_id === A && x.virtual_office_id === null && x.payload.measure_type_id === id && !JSON.stringify(x.payload).includes("ZZ W1"))
      && e.filter((x) => x.event_type === "measure_type_upserted").length === 2 && e.some((x) => x.event_type === "measure_type_deactivated" && x.actor_id === F.mgrX.id)
      && e.some((x) => x.event_type === "measure_type_activated" && x.actor_id === F.aaA.id) && e.some((x) => x.event_type === "measure_type_deleted")),
    e.map((x) => x.event_type).join(", "));
  const sys = (await admin.from("measure_types").select("id").is("agency_id", null).limit(1)).data[0].id;
  const r = [await rpc(F.aaA.c, "upsert_measure_type", { _id: sys, _kind: null, _label: "Hacked", _default_options: null }),
    await rpc(F.schX.c, "upsert_measure_type", { _id: null, _kind: "tally", _label: `ZZ W1 sch ${RUN}`, _default_options: null }),
    await rpc(F.aaB.c, "upsert_measure_type", { _id: null, _kind: "tally", _label: `ZZ W1 aab ${RUN}`, _default_options: null })];
  const bAgency = (await admin.from("measure_types").select("id").eq("label", `ZZ W1 aab ${RUN}`)).data || []; created.push(...bAgency.map((x) => x.id));
  rec("A2 refusals unchanged: system type read-only, scheduler refused; no event for the system type",
    pass(DENY.test(r[0].err || "") && DENY.test(r[1].err || "") && (await eventsFor(sys)).length === 0),
    r.map((x) => x.err || "ACCEPTED").join(" | "));
}

(async () => {
  log(`=== W1 audit — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL === "before") await before(F); else await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    for (const id of created) { await admin.from("events").delete().eq("subject_id", id); await admin.from("measure_types").delete().eq("id", id); }
    await teardownB1(F); await teardown(F);
    const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.measure_types WHERE label LIKE $1)::int types,
      (SELECT count(*) FROM public.events WHERE subject_id = ANY($2::uuid[]))::int ev`, [`%${RUN}`, created.length ? created : ["00000000-0000-0000-0000-000000000000"]])).rows[0]);
    log(`W1 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`);
    await closeDb();
  }
  summary();
})();
