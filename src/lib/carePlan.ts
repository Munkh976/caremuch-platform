/** Pure helpers for the client care-plan screens (S4 IPOS / authorizations / onboarding, S5 goals). No I/O. */
import type { TemplateField } from "@/lib/formTemplates";
import { humanize } from "@/lib/formTemplates";

// ---------------------------------------------------------------------------------------------
// Template resolution + field values (mirror the server; the server stays authoritative)
// ---------------------------------------------------------------------------------------------

export interface ShellRow {
  id: string;
  name: string;
  kind: string;
  virtual_office_id: string | null;
  intake_doc_type: string | null;
  is_active: boolean;
  created_at: string;
  current_version_id: string | null;
  current_version: number | null;
}

/**
 * The shell the server will use for a new instance (cp_resolve_template): an active shell of the
 * kind with a current published version, the office's own before an agency-wide one, newest first.
 */
export function resolveShell(shells: ShellRow[], kind: string, officeId: string | null, intakeDocType: string | null = null): ShellRow | null {
  const ok = shells.filter((s) => s.kind === kind && s.is_active && !!s.current_version_id
    && (s.virtual_office_id === officeId || s.virtual_office_id === null)
    && (intakeDocType === null || s.intake_doc_type === intakeDocType));
  ok.sort((a, b) => (Number(b.virtual_office_id !== null) - Number(a.virtual_office_id !== null)) || b.created_at.localeCompare(a.created_at));
  return ok[0] ?? null;
}

export type FieldValue = string | number | boolean | null | Record<string, unknown>[];
export type FieldValues = Record<string, FieldValue>;

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Client-side copy of cp_validate_field_values: the first problem, or null. */
export function validateFieldValues(fields: TemplateField[], values: FieldValues): string | null {
  const own = fields.filter((f) => f.storage === "field_value");
  for (const k of Object.keys(values)) {
    if (k === "_retired") continue;
    if (!own.some((f) => f.field_key === k)) return `Unknown field "${k}" for this template version`;
  }
  for (const f of own) {
    const v = values[f.field_key];
    if (isBlank(v)) { if (f.required) return `${f.label} is required`; continue; }
    switch (f.field_type) {
      case "text": case "longtext":
        if (typeof v !== "string") return `${f.label} must be text`;
        if (v.length > (f.field_type === "text" ? 2000 : 20000)) return `${f.label} is too long`;
        break;
      case "number": case "units": case "money":
        if (typeof v !== "number" || Number.isNaN(v)) return `${f.label} must be a number`;
        break;
      case "checkbox":
        if (typeof v !== "boolean") return `${f.label} must be yes or no`;
        break;
      case "date":
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return `${f.label} must be a valid date`;
        break;
      case "select":
        if (typeof v !== "string" || !(f.options ?? []).includes(v)) return `${f.label} must be one of its options`;
        break;
      case "table":
        if (!Array.isArray(v)) return `${f.label} must be a list of rows`;
        if (v.length > 200 || v.some((r) => typeof r !== "object" || r === null || Array.isArray(r))) return `${f.label} must be at most 200 rows`;
        break;
      default:
        return `${f.label} has an unsupported type`;
    }
  }
  return null;
}

/** Field values without blanks (what the RPC should receive). */
export function cleanFieldValues(fields: TemplateField[], values: FieldValues): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) {
    if (f.storage !== "field_value") continue;
    const v = values[f.field_key];
    if (isBlank(v) || (Array.isArray(v) && v.length === 0)) continue;
    out[f.field_key] = v as FieldValue;
  }
  if (values._retired) out._retired = values._retired;
  return out;
}

/** Read-only value of a field (summary view). */
export function fieldDisplay(field: Pick<TemplateField, "field_type">, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field.field_type === "checkbox") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((r) => String((r as Record<string, unknown>).text ?? JSON.stringify(r))).join("; ") || "—";
  return String(value);
}

/** The plan header columns a care-plan spine field can write (cp_spine_columns('care_plan')). */
export const PLAN_HEADER_COLUMNS = ["meeting_date", "effective_date", "expiration_date", "next_review_date", "review_frequency",
  "michicans_date", "facilitator_name", "recorder_name", "discharge_criteria", "signed_by", "signed_date"] as const;
export type PlanHeaderColumn = (typeof PLAN_HEADER_COLUMNS)[number];
export const HEADER_LABEL: Record<PlanHeaderColumn, string> = {
  meeting_date: "Meeting date", effective_date: "Effective date", expiration_date: "Expiration date", next_review_date: "Next review",
  review_frequency: "Review frequency", michicans_date: "MichiCANS date", facilitator_name: "Facilitator", recorder_name: "Recorder",
  discharge_criteria: "Discharge criteria", signed_by: "Signed by", signed_date: "Signed date",
};
export const isDateHeader = (c: string) => c.endsWith("_date");

/** Header problems the RPC would refuse (cp_validate_plan_header with dates required). */
export function validateHeader(h: Partial<Record<PlanHeaderColumn, string>>, requireDates: boolean): string | null {
  for (const [k, v] of Object.entries(h)) {
    if (!v) continue;
    if (isDateHeader(k) && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) return `${HEADER_LABEL[k as PlanHeaderColumn] ?? k} must be a date`;
    if (v.length > (k === "discharge_criteria" ? 8000 : 200)) return `${HEADER_LABEL[k as PlanHeaderColumn] ?? k} is too long`;
  }
  if (requireDates && (!h.effective_date || !h.expiration_date)) return "A plan needs an effective and an expiration date";
  if (h.effective_date && h.expiration_date && h.expiration_date < h.effective_date) return "The expiration date is before the effective date";
  return null;
}

// ---------------------------------------------------------------------------------------------
// IPOS child rows (set_care_plan_rows)
// ---------------------------------------------------------------------------------------------
export type ColKind = "text" | "longtext" | "bool" | "date" | "int" | { options: string[] };
export interface RowSection { entity: string; table: string; title: string; cols: { key: string; label: string; kind: ColKind; required?: boolean }[] }

export const ROW_SECTIONS: RowSection[] = [
  { entity: "care_plan_attendee", table: "care_plan_attendees", title: "Meeting attendees", cols: [
    { key: "name", label: "Name", kind: "text" }, { key: "relationship", label: "Relationship", kind: "text" },
    { key: "attended", label: "Attended", kind: "bool" }, { key: "contributed", label: "Contributed", kind: "bool" }] },
  { entity: "care_plan_need", table: "care_plan_needs", title: "Needs and strengths", cols: [
    { key: "source", label: "Source", kind: { options: ["michicans", "other"] }, required: true },
    { key: "item_kind", label: "Kind", kind: { options: ["need", "centerpiece_strength", "strength_present"] } },
    { key: "domain", label: "Domain", kind: "text" }, { key: "item_text", label: "Item", kind: "longtext" },
    { key: "level_of_need", label: "Level of need", kind: "text" }, { key: "addressed", label: "Addressed", kind: "bool" },
    { key: "additional_info", label: "Additional info", kind: "longtext" }] },
  { entity: "care_plan_treatment_need", table: "care_plan_treatment_needs", title: "Treatment needs", cols: [
    { key: "domain", label: "Domain", kind: "text", required: true }, { key: "to_address", label: "To address", kind: "bool" },
    { key: "new_need", label: "New need", kind: "bool" }, { key: "treatment_recommendation", label: "Recommendation", kind: "longtext" }] },
  { entity: "care_plan_dsm_recommendation", table: "care_plan_dsm_recommendations", title: "DSM recommendations", cols: [
    { key: "service", label: "Service", kind: "text", required: true }, { key: "outcome_code", label: "Outcome code", kind: "text", required: true },
    { key: "notes", label: "Notes", kind: "longtext" }] },
  { entity: "care_plan_natural_support", table: "care_plan_natural_supports", title: "Natural and professional supports", cols: [
    { key: "name", label: "Name", kind: "text" }, { key: "support_type", label: "Type", kind: { options: ["natural", "professional"] } },
    { key: "status", label: "Status", kind: "text" }, { key: "how_they_help", label: "How they help", kind: "longtext" }] },
  { entity: "care_plan_external_service", table: "care_plan_external_services", title: "Other providers' services (reference only)", cols: [
    { key: "provider_program", label: "Provider / program", kind: "text" }, { key: "service", label: "Service", kind: "text" },
    { key: "auth_reference", label: "Auth reference", kind: "text" }, { key: "units_text", label: "Units", kind: "text" },
    { key: "effective_date", label: "From", kind: "date" }, { key: "expiration_date", label: "To", kind: "date" },
    { key: "description", label: "Description", kind: "longtext" }] },
  { entity: "care_plan_review", table: "care_plan_reviews", title: "Reviews", cols: [
    { key: "review_date", label: "Review date", kind: "date" }, { key: "next_review_date", label: "Next review", kind: "date" },
    { key: "notes", label: "Notes", kind: "longtext" }] },
];
/** Child-row structures the S4 form edits (goals/objectives are on the Goals tab). */
export const rowSectionFor = (entity: string | null | undefined) => ROW_SECTIONS.find((s) => s.entity === entity) ?? null;
export const GOAL_ENTITIES = new Set(["care_plan_goal", "care_plan_objective"]);
export type PlanRow = Record<string, string | number | boolean | null>;

/** First problem in a set of child rows (set_care_plan_rows checks the same). */
export function validateRows(section: RowSection, rows: PlanRow[]): string | null {
  if (rows.length > 200) return "At most 200 rows";
  for (const [i, r] of rows.entries()) {
    for (const c of section.cols) {
      const v = r[c.key];
      if (isBlank(v)) { if (c.required) return `Row ${i + 1}: ${c.label} is required`; continue; }
      if (c.kind === "text" && String(v).length > 200) return `Row ${i + 1}: ${c.label} is too long`;
      if (c.kind === "longtext" && String(v).length > 4000) return `Row ${i + 1}: ${c.label} is too long`;
      if (c.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return `Row ${i + 1}: ${c.label} must be a date`;
      if (typeof c.kind === "object" && !c.kind.options.includes(String(v))) return `Row ${i + 1}: ${c.label} has an invalid value`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Onboarding (get_client_onboarding_status)
// ---------------------------------------------------------------------------------------------
export type ItemStatus = "complete" | "missing" | "expired" | "not_applicable";
export interface OnboardingItem { key: string; status: ItemStatus; training_version?: number | null; documents?: Record<string, number> | null; caregivers_trained?: number;
  objectives?: number; objectives_without_measures?: number; care_plan_id?: string | null }
export interface Onboarding { client_id: string; as_of: string; onboarded: boolean; items: OnboardingItem[] }

export type CarePlanTab = "ipos" | "goals" | "notes" | "scheduling" | "onboarding";
export const ONBOARDING_LABEL: Record<string, { label: string; tab: CarePlanTab; anchor?: string }> = {
  ipos: { label: "IPOS (plan of service)", tab: "ipos" },
  assessment: { label: "Assessment", tab: "onboarding", anchor: "doc-assessment" },
  inservice: { label: "In-service signed", tab: "scheduling" },
  client_forms: { label: "Client forms", tab: "onboarding", anchor: "client-forms" },
  safety_behavior_plan: { label: "Safety / behavior plan", tab: "onboarding", anchor: "doc-safety_behavior_plan" },
  training: { label: "Caregiver training", tab: "scheduling" },
  authorization: { label: "Authorization", tab: "ipos", anchor: "authorizations" },
  cls_note_setup: { label: "Progress note set up (measures)", tab: "goals" },
};
export const onboardedCount = (o: Pick<Onboarding, "items">) => o.items.filter((i) => i.status === "complete" || i.status === "not_applicable").length;

/** One line under an onboarding item ("redo at version N" for an expired in-service/training). */
export function onboardingDetail(item: OnboardingItem, trainingVersion: number | null): string | null {
  if ((item.key === "inservice" || item.key === "training") && item.status === "expired") return trainingVersion ? `Redo at version ${trainingVersion}` : "Redo for the current plan";
  if (item.key === "training" && item.status === "complete") return `${item.caregivers_trained ?? 0} caregiver(s) trained`;
  if (item.key === "cls_note_setup" && item.status === "missing")
    return item.objectives ? `${item.objectives_without_measures} of ${item.objectives} objectives have no measures` : "No objectives delivered by this agency yet";
  if (item.key === "client_forms" && item.documents) return Object.entries(item.documents).map(([s, n]) => `${n} ${humanize(s).toLowerCase()}`).join(" · ");
  return null;
}

/** The single intake documents and the five client forms, in Bren's order. */
export const SINGLE_DOCS = ["assessment", "safety_behavior_plan"];
export const CLIENT_FORMS = ["consent", "insurance", "emergency_contacts", "allergies", "release_of_information"];
export const DOC_LABEL: Record<string, string> = {
  assessment: "Assessment", safety_behavior_plan: "Safety / behavior plan", consent: "Consent", insurance: "Insurance",
  emergency_contacts: "Emergency contacts", allergies: "Allergies", release_of_information: "Release of information",
};
export type DocStatus = "pending" | "complete" | "expired" | "not_applicable";

// ---------------------------------------------------------------------------------------------
// Goals (S5)
// ---------------------------------------------------------------------------------------------
export interface ObjectiveRow { id?: string; letter?: string | null; seq: number; objective_text: string; staff_instructions?: string | null; service_type?: string | null;
  responsible_party: string; target_start?: string | null; target_end?: string | null }
export interface GoalRow { id?: string; seq: number; goal_text: string; target_start?: string | null; target_end?: string | null; objectives: ObjectiveRow[] }

export const SERVICE_NAME: Record<string, string> = { cls: "CLS", respite: "Respite" };
export const serviceName = (s: string) => SERVICE_NAME[s] ?? humanize(s);
export const RESPONSIBLE_LABEL: Record<string, string> = {
  this_agency: "This agency", case_management: "Case management", evaluator: "Evaluator", family: "Family", other_provider: "Other provider",
};

export interface GoalGroup { key: string; title: string; reference: boolean; items: { goal: GoalRow; objectives: ObjectiveRow[] }[] }

/**
 * Goals grouped by the services of the objectives this agency delivers ("CLS — goals"), a heading
 * for an offered service with none ("Respite — no goals"), and objectives delivered by others under
 * "Other providers — reference". Goal and objective order (seq) is kept inside every group.
 */
export function groupGoals(goals: GoalRow[], services: string[]): GoalGroup[] {
  const sorted = [...goals].sort((a, b) => a.seq - b.seq);
  const byService = new Map<string, GoalGroup>();
  const other: GoalGroup = { key: "other", title: "Other providers — reference", reference: true, items: [] };
  const order = [...services];
  for (const g of sorted) {
    const objs = [...g.objectives].sort((a, b) => a.seq - b.seq);
    const mine = new Map<string, ObjectiveRow[]>();
    const theirs: ObjectiveRow[] = [];
    for (const o of objs) {
      if (o.responsible_party === "this_agency" && o.service_type) {
        if (!mine.has(o.service_type)) mine.set(o.service_type, []);
        mine.get(o.service_type)!.push(o);
      } else theirs.push(o);
    }
    for (const [svc, list] of mine) {
      if (!order.includes(svc)) order.push(svc);
      if (!byService.has(svc)) byService.set(svc, { key: svc, title: `${serviceName(svc)} — goals`, reference: false, items: [] });
      byService.get(svc)!.items.push({ goal: g, objectives: list });
    }
    if (theirs.length || (mine.size === 0)) other.items.push({ goal: g, objectives: theirs });
  }
  const out: GoalGroup[] = order.map((svc) => byService.get(svc) ?? { key: svc, title: `${serviceName(svc)} — no goals`, reference: false, items: [] });
  if (other.items.length) out.push(other);
  return out;
}

/** The payload upsert_care_plan_goals / would_bump_training_version expect (blank optional values dropped). */
export function goalsPayload(goals: GoalRow[]) {
  const opt = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
  return goals.map((g) => ({
    ...opt({ id: g.id, target_start: g.target_start, target_end: g.target_end }),
    seq: g.seq, goal_text: g.goal_text.trim(),
    objectives: g.objectives.map((o) => ({
      ...opt({ id: o.id, letter: o.letter, staff_instructions: o.staff_instructions, target_start: o.target_start, target_end: o.target_end,
        service_type: o.responsible_party === "this_agency" ? o.service_type : o.service_type || null }),
      seq: o.seq, objective_text: o.objective_text.trim(), responsible_party: o.responsible_party,
    })),
  }));
}

/** Renumber seq 1..n in the current order (goals, then each goal's objectives). */
export function renumber(goals: GoalRow[]): GoalRow[] {
  return goals.map((g, i) => ({ ...g, seq: i + 1, objectives: g.objectives.map((o, j) => ({ ...o, seq: j + 1 })) }));
}

/** Problems the RPC would refuse, before calling it. */
export function validateGoals(goals: GoalRow[], services: string[]): string | null {
  if (goals.length > 50) return "At most 50 goals";
  for (const [i, g] of goals.entries()) {
    if (!g.goal_text.trim()) return `Goal ${i + 1} needs text`;
    if (g.goal_text.length > 4000) return `Goal ${i + 1} is too long`;
    if (g.objectives.length > 50) return `Goal ${i + 1} has more than 50 objectives`;
    for (const [j, o] of g.objectives.entries()) {
      const at = `Goal ${i + 1}, objective ${o.letter || j + 1}`;
      if (!o.objective_text.trim()) return `${at} needs text`;
      if (o.objective_text.length > 4000 || (o.staff_instructions ?? "").length > 8000 || (o.letter ?? "").length > 10) return `${at} is too long`;
      if (o.responsible_party === "this_agency" && (!o.service_type || !services.includes(o.service_type))) return `${at}: choose a service this office provides`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Measures (S5): per-kind settings for set_objective_measures
// ---------------------------------------------------------------------------------------------
export type MeasureKind = "yes_no_na" | "prompt_level" | "graded_steps" | "tally" | "trials" | "short_answer" | "narrative" | "staff_note";
export const MEASURE_SETTING: Record<MeasureKind, { prompt: string; options?: string; trials?: boolean }> = {
  yes_no_na: { prompt: "Question" },
  prompt_level: { prompt: "Question", options: "Prompt levels" },
  graded_steps: { prompt: "Question", options: "Graded steps" },
  tally: { prompt: "Tally label" },
  trials: { prompt: "Question", trials: true },
  short_answer: { prompt: "Question" },
  narrative: { prompt: "Narrative prompt" },
  staff_note: { prompt: "Staff note text" },
};
export interface MeasureDraft { measure_type_id: string; kind: MeasureKind; prompt_text: string; options: string[]; trial_count: number | null }

export function validateMeasures(ms: MeasureDraft[]): string | null {
  if (ms.length > 30) return "At most 30 measures";
  for (const [i, m] of ms.entries()) {
    if (!m.prompt_text.trim()) return `Measure ${i + 1} needs ${MEASURE_SETTING[m.kind].prompt.toLowerCase()}`;
    if (m.prompt_text.length > 1000) return `Measure ${i + 1} is too long`;
    if (MEASURE_SETTING[m.kind].trials && (!m.trial_count || m.trial_count < 1 || m.trial_count > 20)) return `Measure ${i + 1} needs 1-20 trials`;
  }
  return null;
}
export function measuresPayload(ms: MeasureDraft[]) {
  return ms.map((m, i) => ({
    measure_type_id: m.measure_type_id, seq: i, prompt_text: m.prompt_text.trim(),
    ...(MEASURE_SETTING[m.kind].options && m.options.length ? { options: m.options } : {}),
    ...(MEASURE_SETTING[m.kind].trials ? { trial_count: m.trial_count } : {}),
  }));
}

/** Retraining wording (UI plan §3.2). */
export const RETRAINING_TEXT = "This change requires retraining all caregivers for this client";
export const RENEWAL_TEXT = "Renewal starts retraining for all caregivers";
