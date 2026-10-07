// Read-only check that the demo office has the data every demo flow needs. Calls the same reads the screens use,
// as the demo program lead (Pat Morgan), inside a READ ONLY transaction that is rolled back (no session, no password).
// Usage: node tests/ripple/demo/verify-demo.cjs
const D = require("./demo-lib.cjs");
const { pgRead } = D;
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };

(async () => {
  const [off] = await D.findOffice();
  if (!off) { console.log("no demo office"); process.exitCode = 1; return; }
  const r = await pgRead(async (c) => {
    const pat = (await c.query(`SELECT id FROM public.profiles WHERE email = $1`, [D.email("pat.morgan")])).rows[0].id;
    const sam = (await c.query(`SELECT id FROM public.profiles WHERE email = $1`, [D.email("sam.rivera")])).rows[0].id;
    await c.query("BEGIN READ ONLY");
    try {
      const pre = {
        agency: (await c.query(`SELECT (SELECT count(*)::int FROM public.virtual_office WHERE agency_id = $1) offices,
          (SELECT count(*)::int FROM public.profiles WHERE email LIKE $2 AND agency_id <> $1) + (SELECT count(*)::int FROM public.virtual_office WHERE code = 'RPLDEMO' AND agency_id <> $1) elsewhere`, [off.agency_id, `%${D.EMAIL_TAG}`])).rows[0],
        office: (await c.query(`SELECT name, care_plan_module_enabled m, compliance_enforcement_enabled e FROM public.virtual_office WHERE id = $1`, [off.id])).rows[0],
        clients: (await c.query(`SELECT id, first_name || ' ' || last_name n, case_number FROM public.clients WHERE virtual_office_id = $1 ORDER BY 2`, [off.id])).rows,
      };
      const clock = (await c.query(`SELECT d::text today, (d - ((extract(isodow FROM d)::int - (SELECT billing_week_start FROM public.virtual_office WHERE id = $1) + 7) % 7))::text w0, (SELECT billing_week_start FROM public.virtual_office WHERE id = $1) wks FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date d) x`, [off.id])).rows[0];
      const lastW = (await c.query(`SELECT ($1::date - 7)::text a, ($1::date - 14)::text b`, [clock.w0])).rows[0];
      await c.query("SET LOCAL ROLE authenticated");
      const as = async (uid, sql, p = []) => { await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]); return (await c.query(sql, p)).rows[0].v; };
      const out = {
        clock, ...pre,
        onboarding: await as(pat, `SELECT list_clients_onboarding($1) v`, [off.id]),
        creds: await as(pat, `SELECT list_credential_expirations($1, 60) v`, [off.id]),
        risk: await as(pat, `SELECT list_authorization_risk($1, 60) v`, [off.id]),
        retrain: await as(pat, `SELECT list_caregivers_needing_retraining($1) v`, [off.id]),
        notes: await as(pat, `SELECT get_notes_review_counts() v`),
        readiness: await as(pat, `SELECT get_enforcement_readiness($1, 14) v`, [off.id]),
        lastWeek: await as(pat, `SELECT get_billing_week($1, $2::date) v`, [off.id, lastW.a]),
        weekBefore: await as(pat, `SELECT get_billing_week($1, $2::date) v`, [off.id, lastW.b]),
        status: await as(sam, `SELECT list_billing_week_status() v`),
      };
      await c.query("RESET ROLE");
      out.units = (await c.query(`SELECT to_char(n.scheduled_start AT TIME ZONE 'America/New_York', 'Dy') dy, n.units_used::int u, n.units_scheduled::int s, n.arrived_late late,
          date_trunc('minute', n.actual_end) < n.scheduled_end early FROM public.progress_notes n JOIN public.clients cl ON cl.id = n.client_id
          WHERE cl.virtual_office_id = $1 AND cl.first_name = 'Zoe' AND n.service_date BETWEEN $2::date AND $2::date + 6 AND n.status IN ('reviewed','submitted','returned') ORDER BY n.scheduled_start`, [off.id, lastW.a])).rows;
      out.kinds = (await c.query(`SELECT count(DISTINCT mt.kind)::int n, string_agg(DISTINCT mt.kind::text, ',') k FROM public.objective_measures om
        JOIN public.measure_types mt ON mt.id = om.measure_type_id JOIN public.care_plan_objectives o ON o.id = om.objective_id JOIN public.care_plan_goals g ON g.id = o.goal_id
        JOIN public.care_plans p ON p.id = g.care_plan_id WHERE p.virtual_office_id = $1 AND p.status = 'active'`, [off.id])).rows[0];
      out.zoePlan = (await c.query(`SELECT version, training_version, status FROM public.care_plans p JOIN public.clients cl ON cl.id = p.client_id WHERE cl.virtual_office_id = $1 AND cl.first_name = 'Zoe' ORDER BY version`, [off.id])).rows;
      out.group = (await c.query(`SELECT gs.staff_client_ratio r, gs.max_clients m, count(s.id)::int shifts, string_agg(cl.first_name, ',' ORDER BY cl.first_name) clients FROM public.group_sessions gs
        JOIN public.shifts s ON s.group_session_id = gs.id JOIN public.clients cl ON cl.id = s.client_id WHERE gs.virtual_office_id = $1 GROUP BY 1, 2`, [off.id])).rows;
      out.thisWeek = (await c.query(`SELECT count(*) FILTER (WHERE n.status = 'draft')::int drafts, (SELECT count(*)::int FROM public.shifts s WHERE s.virtual_office_id = $1 AND s.shift_date > $2::date) upcoming
        FROM public.progress_notes n JOIN public.clients cl ON cl.id = n.client_id WHERE cl.virtual_office_id = $1 AND n.service_date >= $3::date`, [off.id, clock.today, clock.w0])).rows[0];
      return out;
    } finally { await c.query("ROLLBACK"); }
  });
  const name = new Map(r.clients.map((x) => [x.id, x.n]));
  const onb = Object.fromEntries(r.onboarding.map((o) => [name.get(o.client_id), o.onboarded ? "onboarded" : `${o.items.filter((i) => ["complete", "not_applicable"].includes(i.status)).length} of 8`]));
  rec("O own agency 'Ripple Effects – Demo Agency' with one office 'Ripple Effects – Demo', module on, enforcement OFF; nothing of the demo in any other agency",
    r.office.name === D.OFFICE_NAME && r.office.m && !r.office.e && r.agency.offices === 1 && r.agency.elsewhere === 0, `${JSON.stringify(r.office)}; ${JSON.stringify(r.agency)}`);
  rec("F1 setup: active plans use ≥ 6 of the 8 measure types", r.kinds.n >= 6, `${r.kinds.n}: ${r.kinds.k}`);
  rec("F2 onboarding: Zoe and Max onboarded, Lily 5 of 8 (Clients pending); Zoe's IPOS v2 after a renewal (v1 superseded)",
    onb["Zoe Nguyen"] === "onboarded" && onb["Max Ortiz"] === "onboarded" && onb["Lily Park"] === "5 of 8" && r.zoePlan.length === 2 && r.zoePlan[1].version === 2 && r.zoePlan[1].status === "active",
    `${JSON.stringify(onb)}; Zoe plans ${r.zoePlan.map((p) => `v${p.version}/${p.status}`).join(",")}; cases ${r.clients.map((x) => x.case_number).join(",")}`);
  const bands = r.creds.reduce((m, x) => ({ ...m, [`${x.caregiver_name}:${x.band}`]: true }), {});
  rec("F2 credentials: Ben yellow + red, Mia ★ overdue, Ana all current", bands["Ben Carter:yellow"] && bands["Ben Carter:red"] && bands["Mia Lopez:overdue"] && !r.creds.some((x) => x.caregiver_name === "Ana Brooks"),
    r.creds.map((x) => `${x.caregiver_name}:${x.band}`).join(", "));
  rec("F2 units at risk: Zoe's first authorization expires within 60 days", r.risk.some((x) => x.auth_number === "DEMO-AUTH-1001-A"), r.risk.map((x) => `${x.auth_number} ${x.days}d at-risk ${x.units_at_risk}`).join("; "));
  rec("F3 retraining: Mia needs retraining for Zoe's v2 (next visit scheduled)", r.retrain.some((x) => name.get(x.client_id) === "Zoe Nguyen"), `${r.retrain.length} shift(s)`);
  rec("F3 readiness: upcoming shifts the switch would block, by reason", r.readiness.would_block > 0 && !r.readiness.enforcement, `${r.readiness.would_block} of ${r.readiness.shifts_checked}; ${JSON.stringify(r.readiness.by_reason)}`);
  rec("F3 group session 1:2 (CLS) with Zoe and Lily", r.group.length === 1 && r.group[0].r === "1:2" && r.group[0].clients === "Lily,Zoe", JSON.stringify(r.group));
  rec("F4 this week: a draft note and upcoming shifts", r.thisWeek.drafts >= 1 && r.thisWeek.upcoming > 0, JSON.stringify(r.thisWeek));
  const nc = r.notes.find((x) => x.office_id === off.id) || {};
  rec("F5 Notes to Review: 1 submitted, ≥ 1 overdue", Number(nc.to_review) === 1 && Number(nc.overdue) >= 1, JSON.stringify(nc));
  const lw = r.lastWeek, reasons = lw.excluded.map((x) => x.reason).sort();
  const lines = lw.batches.length ? lw.batches[0].lines : [];
  rec("F5 last week: NOT built (next action 'build'); preview exclusions: submitted, returned, overdue/no note; reviewed notes waiting to be built incl. a late arrival",
    lw.batches.length === 0 && lw.next_action === "build" && reasons.includes("not_reviewed") && reasons.includes("returned") && reasons.includes("no_note") && reasons.filter((x) => x === "not_in_bill_yet").length === 4,
    `${lw.week_start}: ${lw.next_action}; reasons ${reasons.join(",")}; pending ${lw.pending_review}`);
  rec("W billing week Sunday–Saturday (the office's billing_week_start = 7): last week starts on a Sunday", r.clock.wks === 7 && lw.week_start === r.lastWeek.week_start && new Date(`${lw.week_start}T12:00:00Z`).getUTCDay() === 0, `${lw.week_start}..${lw.week_end}`);
  const u = r.units.map((x) => `${x.dy} ${x.u}/${x.s}${x.late ? " late" : ""}${x.early ? " early" : ""}`);
  rec("F4 units: only full 15-minute blocks — last week a 09:20 arrival bills 2 of 4 and a 09:50 departure bills 3 of 4",
    r.units.some((x) => x.late && x.u === 2 && x.s === 4) && r.units.some((x) => x.early && !x.late && x.u === 3 && x.s === 4), u.join(", "));
  const wb = r.weekBefore.batches[0];
  rec("F5 the week before last: main bill billed (locked)", !!wb && wb.status === "billed" && wb.supplement === 0, wb ? `${wb.status}, ${wb.totals.notes} notes, ${wb.totals.units_billed} units` : "none");
  const st = (r.status || []).find((x) => x.office_id === off.id);
  rec("F5 dashboard billing line: last week not built", st && st.status === "not_built", JSON.stringify(st));
  console.log("summary: " + rows.map((x) => `${x.id.split(" ")[0]}=${x.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((x) => !x.ok)) process.exitCode = 1;
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());
