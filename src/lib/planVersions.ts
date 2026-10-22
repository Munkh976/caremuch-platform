/** S17: IPOS versions — the "What changed" diff between two revision snapshots, and the expiry warning text. */
type Obj = Record<string, unknown>;
export interface PlanSnapshot {
  header?: Obj; field_values?: Obj;
  goals?: { seq: number; goal_text: string; objectives?: { letter: string; objective_text: string; staff_instructions?: string | null; service_type?: string | null }[] }[];
  measures?: { letter: string; seq: number; prompt_text: string; kind?: string }[];
  rows?: Record<string, unknown[]>;
}
const HEADER_LABEL: Record<string, string> = {
  plan_type: "Plan type", meeting_date: "Meeting date", effective_date: "Effective date", expiration_date: "Expiration date",
  next_review_date: "Next review", review_frequency: "Review frequency", michicans_date: "MichiCANS date", facilitator_name: "Facilitator",
  recorder_name: "Recorder", discharge_criteria: "Discharge criteria", signed_by: "Signed by", signed_date: "Signed date",
};
const ROWS_LABEL: Record<string, string> = {
  care_plan_treatment_needs: "Treatment needs", care_plan_attendees: "Attendees", care_plan_needs: "Needs and strengths",
  care_plan_dsm_recommendations: "DSM recommendations", care_plan_natural_supports: "Natural supports", care_plan_external_services: "External services",
};
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const short = (v: unknown) => { const t = show(v); return t.length > 80 ? `${t.slice(0, 77)}…` : t; };

/** Human-readable lines for what changed from `before` to `after` (display only). */
export function diffSnapshots(before: PlanSnapshot | null, after: PlanSnapshot): string[] {
  if (!before) return ["First recorded revision."];
  const out: string[] = [];
  for (const k of Object.keys(HEADER_LABEL)) {
    const a = before.header?.[k] ?? null, b = after.header?.[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${HEADER_LABEL[k]}: ${short(a)} → ${short(b)}`);
  }
  const fk = new Set([...Object.keys(before.field_values ?? {}), ...Object.keys(after.field_values ?? {})]);
  for (const k of [...fk].sort()) {
    if (k === "_retired") continue;
    const a = before.field_values?.[k], b = after.field_values?.[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push(`${k.replace(/_/g, " ")}: ${short(a)} → ${short(b)}`);
  }
  const goals = (s: PlanSnapshot) => new Map((s.goals ?? []).map((g) => [g.seq, g.goal_text]));
  const ga = goals(before), gb = goals(after);
  for (const seq of [...new Set([...ga.keys(), ...gb.keys()])].sort((x, y) => x - y)) {
    if (!ga.has(seq)) out.push(`Goal ${seq} added: ${short(gb.get(seq))}`);
    else if (!gb.has(seq)) out.push(`Goal ${seq} removed`);
    else if (ga.get(seq) !== gb.get(seq)) out.push(`Goal ${seq}: ${short(ga.get(seq))} → ${short(gb.get(seq))}`);
  }
  const objs = (s: PlanSnapshot) => new Map((s.goals ?? []).flatMap((g) => g.objectives ?? []).map((o) => [o.letter, o]));
  const oa = objs(before), ob = objs(after);
  for (const l of [...new Set([...oa.keys(), ...ob.keys()])].sort()) {
    const a = oa.get(l), b = ob.get(l);
    if (!a) out.push(`Objective ${l} added: ${short(b?.objective_text)}`);
    else if (!b) out.push(`Objective ${l} removed`);
    else {
      if (a.objective_text !== b.objective_text) out.push(`Objective ${l}: ${short(a.objective_text)} → ${short(b.objective_text)}`);
      if ((a.staff_instructions ?? null) !== (b.staff_instructions ?? null)) out.push(`Objective ${l} Instructions for Staff: ${short(a.staff_instructions)} → ${short(b.staff_instructions)}`);
    }
  }
  const ms = (s: PlanSnapshot) => new Map((s.measures ?? []).map((m) => [`${m.letter}.${m.seq}`, m.prompt_text]));
  const ma = ms(before), mb = ms(after);
  for (const k of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    if (!ma.has(k)) out.push(`Data question ${k} added: ${short(mb.get(k))}`);
    else if (!mb.has(k)) out.push(`Data question ${k} removed`);
    else if (ma.get(k) !== mb.get(k)) out.push(`Data question ${k}: ${short(ma.get(k))} → ${short(mb.get(k))}`);
  }
  for (const t of Object.keys(ROWS_LABEL)) {
    const a = before.rows?.[t] ?? [], b = after.rows?.[t] ?? [];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${ROWS_LABEL[t]}: ${a.length} → ${b.length} row${b.length === 1 ? "" : "s"} (changed)`);
  }
  return out.length ? out : ["No visible change."];
}

export interface IposExpiry {
  client_id: string; client_name: string; care_plan_id: string; version: number; expiration_date: string; days_left: number; band: "red" | "amber" | "none";
  pending: { care_plan_id: string; version: number; effective_date: string | null; inservice_signed: boolean; sessions: number } | null;
  shifts_after_count: number; shifts_after: { shift_id: string; shift_date: string; start_time: string }[];
}
/** "IPOS v1 expires in N days; v2 is waiting for its in-service / training" (owner decision 1c). */
export function expiryText(e: IposExpiry): string {
  const when = e.days_left < 0 ? `expired ${-e.days_left} day${e.days_left === -1 ? "" : "s"} ago` : e.days_left === 0 ? "expires today" : `expires in ${e.days_left} day${e.days_left === 1 ? "" : "s"}`;
  if (!e.pending) return `IPOS v${e.version} ${when}; no new version has been started`;
  const waiting = [!e.pending.inservice_signed && "in-service", Number(e.pending.sessions) === 0 && "training"].filter(Boolean).join(" / ");
  return `IPOS v${e.version} ${when}; v${e.pending.version} ${waiting ? `is waiting for its ${waiting}` : "is ready and becomes effective on its date"}`;
}
/** What a pending version still needs before it becomes effective. */
export function pendingNeeds(inserviceSigned: boolean, sessions: number): string {
  const n = [!inserviceSigned && "in-service", sessions === 0 && "training"].filter(Boolean);
  return n.length ? `Pending: ${n.join(" / ")}` : "Pending: ready";
}
