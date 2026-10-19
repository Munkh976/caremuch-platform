// Read-only inventory of the Ripple demo office (RPLDEMO): counts and status breakdowns per area, as of a given date.
// Usage: node tests/ripple/demo/inventory-demo.cjs [--as-of YYYY-MM-DD]   (default: today in the office time zone)
// Date-based buckets (past / today / future, credential bands, weeks) use --as-of; the "server" lines (overdue, Notes to
// Review) are what the app shows right now (server clock). Prints counts only: no names of real people, no secrets.
const D = require("./demo-lib.cjs");
const { pgRead } = D;
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

(async () => {
  const [off] = await D.findOffice();
  if (!off) { console.log("no demo office"); process.exitCode = 1; return; }
  const out = await pgRead(async (c) => {
    const q = async (sql, p = []) => (await c.query(sql, p)).rows;
    const asOf = arg("--as-of") || (await q(`SELECT (now() AT TIME ZONE $1)::date::text d`, [D.TZ]))[0].d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of must be YYYY-MM-DD");
    const P = [off.id, asOf];
    const W = (await q(`SELECT ($2::date - ((extract(isodow FROM $2::date)::int - v.billing_week_start + 7) % 7))::text w0 FROM public.virtual_office v WHERE v.id = $1`, P))[0].w0;
    const r = { asOf, w0: W };
    r.users = await q(`SELECT ur.role::text k, count(*)::int n FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id WHERE p.agency_id = $1 GROUP BY 1 ORDER BY 1`, [off.agency_id]);
    r.caregivers = await q(`SELECT CASE WHEN is_active THEN 'active' ELSE 'inactive' END k, count(*)::int n FROM public.caregivers WHERE virtual_office_id = $1 GROUP BY 1`, [off.id]);
    r.clients = await q(`SELECT count(*)::int n FROM public.clients WHERE virtual_office_id = $1`, [off.id]);
    r.plans = await q(`SELECT cl.first_name k, string_agg('v' || p.version || ' ' || p.status || ' (training v' || p.training_version || ')', ', ' ORDER BY p.version) v
      FROM public.care_plans p JOIN public.clients cl ON cl.id = p.client_id WHERE cl.virtual_office_id = $1 GROUP BY 1 ORDER BY 1`, [off.id]);
    r.goals = await q(`SELECT cl.first_name k, count(DISTINCT g.id)::int goals, count(DISTINCT o.id)::int objectives, count(om.id)::int questions
      FROM public.care_plans p JOIN public.clients cl ON cl.id = p.client_id JOIN public.care_plan_goals g ON g.care_plan_id = p.id
      LEFT JOIN public.care_plan_objectives o ON o.goal_id = g.id LEFT JOIN public.objective_measures om ON om.objective_id = o.id
      WHERE cl.virtual_office_id = $1 AND p.status = 'active' GROUP BY 1 ORDER BY 1`, [off.id]);
    r.auths = await q(`SELECT cl.first_name || ' ' || a.auth_number k, a.units_authorized::int au, a.units_available::int av, a.period_type::text per, a.units_per_period::int cap,
      a.expiration_date - $2::date days, CASE WHEN a.expiration_date - $2::date <= 30 THEN 'expiring <=30d' WHEN a.expiration_date - $2::date <= 60 THEN 'expiring <=60d'
      WHEN a.units_available < a.units_authorized * 0.1 THEN 'low units' ELSE 'healthy' END band
      FROM public.service_authorizations a JOIN public.clients cl ON cl.id = a.client_id WHERE cl.virtual_office_id = $1 AND a.voided_at IS NULL ORDER BY 1`, P);
    r.creds = await q(`SELECT g.first_name k, CASE WHEN c.id IS NULL THEN 'missing' WHEN c.expiry_date < $2::date THEN 'star overdue' WHEN c.expiry_date - $2::date <= 30 THEN 'red'
        WHEN c.expiry_date - $2::date <= 60 THEN 'yellow' ELSE 'green' END band, count(*)::int n
      FROM public.caregivers g JOIN public.credential_types t ON t.agency_id = g.agency_id AND t.is_active AND t.required
      LEFT JOIN public.caregiver_certifications c ON c.caregiver_id = g.id AND c.credential_type_id = t.id
      WHERE g.virtual_office_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, P);
    r.training = await q(`SELECT g.first_name || ' on ' || cl.first_name k, CASE WHEN bool_or(t.training_version = p.training_version) THEN 'current' ELSE 'needs retraining' END v
      FROM public.plan_training_records t JOIN public.caregivers g ON g.id = t.caregiver_id JOIN public.clients cl ON cl.id = t.client_id
      JOIN public.care_plans p ON p.client_id = t.client_id AND p.status = 'active' WHERE cl.virtual_office_id = $1 GROUP BY 1 ORDER BY 1`, [off.id]);
    r.shifts = await q(`SELECT CASE WHEN shift_date < $2::date THEN '1 past' WHEN shift_date = $2::date THEN '2 today' ELSE '3 future' END k,
      count(*) FILTER (WHERE caregiver_id IS NOT NULL)::int assigned, count(*) FILTER (WHERE caregiver_id IS NULL)::int unassigned
      FROM public.shifts WHERE virtual_office_id = $1 AND status IS DISTINCT FROM 'cancelled' GROUP BY 1 ORDER BY 1`, P);
    r.notes = await q(`SELECT status::text k, count(*)::int n FROM public.progress_notes WHERE virtual_office_id = $1 AND NOT voided GROUP BY 1 ORDER BY 1`, [off.id]);
    r.noNote = await q(`SELECT CASE WHEN s.shift_date < $2::date THEN 'past' WHEN s.shift_date = $2::date THEN 'today' END k, count(*)::int n
      FROM public.shifts s WHERE s.virtual_office_id = $1 AND s.caregiver_id IS NOT NULL AND s.status IS DISTINCT FROM 'cancelled' AND s.shift_date <= $2::date
      AND NOT EXISTS (SELECT 1 FROM public.progress_notes n WHERE n.shift_id = s.id AND NOT n.voided) GROUP BY 1`, P);
    r.overdueAsOf = (await q(`SELECT count(*)::int n FROM public.cp_office_note_queue($1) x WHERE x.status IN ('draft','returned','not_started')
      AND x.due_at <= (($2::date)::timestamp AT TIME ZONE $3)`, [off.id, asOf, D.TZ]))[0].n;
    r.overdueNowByWeek = await q(`SELECT x.status k, x.service_date::text d, count(*)::int n FROM public.cp_office_note_queue($1) x WHERE x.overdue GROUP BY 1, 2 ORDER BY 2, 1`, [off.id]);
    r.weeks = await q(`SELECT w::date::text k, COALESCE((SELECT string_agg(b.status::text || CASE WHEN b.supplement > 0 THEN ' (supplement ' || b.supplement || ')' ELSE '' END, ', ' ORDER BY b.supplement)
        FROM public.billing_batches b WHERE b.virtual_office_id = $1 AND b.week_start = w::date), 'not built') v
      FROM generate_series(($2::date - 28), $2::date, interval '7 day') g(w) ORDER BY 1`, [off.id, W]);
    r.enforcement = off.compliance_enforcement_enabled;
    return r;
  });
  const t = (label, rows, f) => { console.log(`\n## ${label}`); if (!rows.length) console.log("  (none)"); for (const x of rows) console.log("  " + f(x)); };
  console.log(`=== demo inventory — office RPLDEMO, as of ${out.asOf} (billing week from ${out.w0}) ===`);
  t("users by role", out.users, (x) => `${x.k}: ${x.n}`);
  t("caregivers", out.caregivers, (x) => `${x.k}: ${x.n}`);
  console.log(`\n## clients: ${out.clients[0].n}`);
  t("care plans / IPOS versions", out.plans, (x) => `${x.k}: ${x.v}`);
  t("goals / objectives / data questions (active plan)", out.goals, (x) => `${x.k}: ${x.goals} goals, ${x.objectives} objectives, ${x.questions} questions`);
  t("authorizations", out.auths, (x) => `${x.k}: ${x.band}; ${x.av}/${x.au} units left, expires in ${x.days} d${x.cap ? `, cap ${x.cap} ${x.per}` : ""}`);
  t("credentials (required types)", out.creds, (x) => `${x.k}: ${x.band} ${x.n}`);
  t("training records (caregiver on client)", out.training, (x) => `${x.k}: ${x.v}`);
  t("shifts", out.shifts, (x) => `${x.k.slice(2)}: ${x.assigned} assigned, ${x.unassigned} unassigned`);
  t("notes by status", out.notes, (x) => `${x.k}: ${x.n}`);
  t("assigned visits with no note", out.noNote, (x) => `${x.k}: ${x.n}`);
  console.log(`\n## overdue as of ${out.asOf} 00:00 office time: ${out.overdueAsOf}`);
  t("overdue right now (server clock), by status and visit date", out.overdueNowByWeek, (x) => `${x.d} ${x.k}: ${x.n}`);
  t("billing weeks", out.weeks, (x) => `${x.k}: ${x.v}`);
  console.log(`\n## compliance enforcement: ${out.enforcement ? "ON" : "OFF"}`);
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());
