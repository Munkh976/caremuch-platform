/** Pure helpers for the S6 training workflow and the client Scheduling tab. No I/O. */
import type { TemplateField } from "@/lib/formTemplates";

export interface TrainingCaregiver { caregiver_id: string; name: string; trained_version: number | null; trained_current: boolean; credentials_current: boolean }
export interface InserviceForm { id: string; training_version: number; case_manager_name: string | null; program_lead_id: string | null; program_lead_name: string | null;
  trained_on: string | null; signed_at: string | null; field_snapshot: TemplateField[] | null; field_values: Record<string, unknown>; created_at: string }
export interface TrainingRecord { caregiver_id: string; caregiver_name: string; training_date: string | null; training_method: "pcp_meeting" | "outside_pcp" | null;
  primary_clinician_name: string | null; trainer_name: string | null; signed_date: string | null }
export interface TrainingForm { id: string; training_version: number; plan_document_type: PlanDocType; plan_effective_date: string | null; location: string | null;
  field_snapshot: TemplateField[] | null; field_values: Record<string, unknown>; created_at: string; records: TrainingRecord[] }
export interface TrainingContext {
  client_id: string; client_name: string; client_short: string; case_number: string | null; agency_name: string | null; office_id: string | null; office_name: string | null; as_of: string;
  plan: { care_plan_id: string; version: number; training_version: number; plan_type: "initial" | "annual" | "addendum"; effective_date: string | null; expiration_date: string | null } | null;
  inservice_current: boolean; inservice_forms: InserviceForm[]; training_forms: TrainingForm[]; program_leads: { id: string; name: string | null }[];
  caregivers: TrainingCaregiver[]; inservice_fields: TemplateField[]; training_fields: TemplateField[];
}

export type PlanDocType = "ipos_initial" | "ipos_annual" | "ipos_addendum" | "behavior_support_plan" | "protocol";
/** The ISK form's "Type of plan" boxes, in the paper order. */
export const PLAN_DOC_TYPES: [PlanDocType, string][] = [["ipos_initial", "Initial"], ["ipos_annual", "Annual"], ["ipos_addendum", "Addendum"],
  ["behavior_support_plan", "Behavior Support Plan"], ["protocol", "Protocol"]];
export const docTypeLabel = (t: PlanDocType) => PLAN_DOC_TYPES.find(([v]) => v === t)?.[1] ?? t;
/** The plan document type that matches the plan type (the form's default). */
export const docTypeFor = (planType: "initial" | "annual" | "addendum" | undefined): PlanDocType =>
  planType === "initial" ? "ipos_initial" : planType === "addendum" ? "ipos_addendum" : "ipos_annual";
export const METHOD_LABEL = { pcp_meeting: "Received during the PCP meeting", outside_pcp: "Received outside the PCP meeting" } as const;

export type DeliverFilter = "trained" | "retrain" | "all";
/**
 * "Caregivers who can deliver" filter (arch §9.2 rule 6):
 *  trained  = trained on the plan's current training_version AND credentials current (the default)
 *  retrain  = trained for this client on an earlier version, not the current one
 *  all      = every active caregiver of the office
 */
export function filterCaregivers(list: TrainingCaregiver[], f: DeliverFilter): TrainingCaregiver[] {
  const out = f === "all" ? list
    : f === "trained" ? list.filter((c) => c.trained_current && c.credentials_current)
    : list.filter((c) => c.trained_version !== null && !c.trained_current);
  return [...out].sort((a, b) => a.name.localeCompare(b.name));
}
/** Short status words for a caregiver row. */
export function caregiverStatus(c: TrainingCaregiver, currentVersion: number | null): string[] {
  const s: string[] = [];
  if (c.trained_current) s.push(`Trained v${currentVersion}`);
  else if (c.trained_version !== null) s.push(`Needs retraining (trained v${c.trained_version})`);
  else s.push("Not trained for this client");
  s.push(c.credentials_current ? "Credentials current" : "Credentials not current");
  return s;
}

export interface RetrainShift { shift_id: string; shift_date: string; caregiver_id: string; client_id: string; care_plan_id: string; training_version: number }
/** list_caregivers_needing_retraining rows of one client, one entry per caregiver with their next shift. */
export function retrainingFor(rows: RetrainShift[], clientId: string, names: Map<string, string>) {
  const by = new Map<string, { caregiver_id: string; name: string; next: string; shifts: number; training_version: number }>();
  for (const r of rows.filter((x) => x.client_id === clientId).sort((a, b) => a.shift_date.localeCompare(b.shift_date))) {
    const cur = by.get(r.caregiver_id);
    if (cur) cur.shifts += 1;
    else by.set(r.caregiver_id, { caregiver_id: r.caregiver_id, name: names.get(r.caregiver_id) ?? "Caregiver", next: r.shift_date, shifts: 1, training_version: r.training_version });
  }
  return [...by.values()];
}

/** Units per service from the authorization rows (active ones), for the Scheduling tab's summary. */
export function unitsByService<T extends { service_type: string; status: string; units_authorized: number; units_used: number; units_pending: number; unit_minutes: number }>(rows: T[]) {
  const m = new Map<string, { service_type: string; authorized: number; used: number; pending: number; unit_minutes: number; count: number }>();
  for (const r of rows.filter((x) => x.status === "active")) {
    const cur = m.get(r.service_type) ?? { service_type: r.service_type, authorized: 0, used: 0, pending: 0, unit_minutes: r.unit_minutes, count: 0 };
    cur.authorized += Number(r.units_authorized); cur.used += Number(r.units_used); cur.pending += Number(r.units_pending); cur.count += 1;
    m.set(r.service_type, cur);
  }
  return [...m.values()].sort((a, b) => a.service_type.localeCompare(b.service_type));
}

// ---------------------------------------------------------------------------------------------
// S15 Training tab (ISK 33.01_01F): sessions = training forms; roster = office caregivers merged with the retraining list.
export const PLAN_TYPE_LABEL = { initial: "Initial", annual: "Annual", addendum: "Addendum" } as const;

/** One training form as a session row: date (earliest attendee date), trainer(s), attendee count. */
export function sessionSummary(f: TrainingForm) {
  const dates = f.records.map((r) => r.training_date).filter((d): d is string => !!d).sort();
  const trainers = [...new Set(f.records.map((r) => r.trainer_name?.trim()).filter((t): t is string => !!t))];
  return { id: f.id, date: dates[0] ?? f.created_at.slice(0, 10), trainer: trainers.join(", ") || null, attendees: f.records.length, docType: f.plan_document_type, version: f.training_version };
}

export type RosterFilter = "all" | "trained" | "retrain";
export interface RosterRow {
  caregiver_id: string; name: string; status: "trained" | "retrain" | "never"; trained_on: string | null; trainer: string | null;
  trained_version: number | null; credentials_current: boolean; next_shift: string | null;
}
/**
 * The caregiver roster for the current training version: Trained <date> by <trainer> (latest record at the current
 * version) / Needs retraining (trained on an earlier version, or on the retraining list) / Never trained.
 * `nextShift`: the caregiver's next shift with this client (from the retraining list or the client's shifts).
 */
export function buildRoster(ctx: TrainingContext, retrain: { caregiver_id: string; next: string }[], nextShift: Map<string, string>): RosterRow[] {
  const tv = ctx.plan?.training_version ?? null;
  const retrainIds = new Map(retrain.map((r) => [r.caregiver_id, r.next]));
  return ctx.caregivers.map((c) => {
    const recs = ctx.training_forms.filter((f) => f.training_version === tv).flatMap((f) => f.records).filter((r) => r.caregiver_id === c.caregiver_id)
      .sort((a, b) => (b.training_date ?? "").localeCompare(a.training_date ?? ""));
    const status: RosterRow["status"] = c.trained_current ? "trained" : c.trained_version !== null || retrainIds.has(c.caregiver_id) ? "retrain" : "never";
    return { caregiver_id: c.caregiver_id, name: c.name, status, trained_on: c.trained_current ? recs[0]?.training_date ?? null : null, trainer: c.trained_current ? recs[0]?.trainer_name ?? null : null,
      trained_version: c.trained_version, credentials_current: c.credentials_current, next_shift: retrainIds.get(c.caregiver_id) ?? nextShift.get(c.caregiver_id) ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export const filterRoster = (rows: RosterRow[], f: RosterFilter) => f === "all" ? rows : rows.filter((r) => r.status === (f === "trained" ? "trained" : "retrain"));
/** "N of M caregivers trained": M = caregivers who work with this client (trained on any version, on the retraining list, or with a next shift). */
export function trainedCount(rows: RosterRow[]) {
  const theirs = rows.filter((r) => r.status !== "never" || r.next_shift);
  return { trained: rows.filter((r) => r.status === "trained").length, of: theirs.length };
}