/** Pure helpers for the Form Templates screen (S2). No I/O. */

export type FieldStorage = "spine_column" | "child_rows" | "field_value" | "static_text";

export interface TemplateField {
  field_key: string;
  section?: string | null;
  label: string;
  field_type: string;
  storage: FieldStorage;
  writes_to_entity?: string | null;
  writes_to_column?: string | null;
  shown_on_progress_note?: boolean;
  default_value?: string | null;
  required?: boolean;
  sort_order?: number;
  options?: string[] | null;
}

export interface NoteLayout {
  billing_footer?: { enabled?: boolean; fields?: string[] } | null;
  notes_prompt?: string | null;
  [k: string]: unknown;
}

export interface ShellVersion {
  version_id: string;
  version: number;
  status: "draft" | "published";
  is_current: boolean;
  published_at: string | null;
  published_by: string | null;
  usage: number;
}

export interface Shell {
  template_id: string;
  name: string;
  kind: string;
  intake_doc_type: string | null;
  service_type: string | null;
  is_required_for_client: boolean;
  office_id: string | null;
  scope: "office" | "agency";
  can_edit: boolean;
  current_version: number | null;
  draft_version: number | null;
  versions: ShellVersion[];
}

/** Fields the constrained editor (Q13) may not change: they write to fixed columns / child tables. */
export const isLockedField = (f: Pick<TemplateField, "storage">) => f.storage === "spine_column" || f.storage === "child_rows";

export const STORAGE_LABEL: Record<FieldStorage, string> = {
  spine_column: "Spine",
  child_rows: "Child rows",
  field_value: "Field value",
  static_text: "Static text",
};

const KIND_ORDER = ["ipos", "progress_note", "inservice", "training", "intake", "authorization", "credential"];
const KIND_LABEL: Record<string, string> = {
  ipos: "IPOS",
  progress_note: "Progress notes",
  inservice: "In-service",
  training: "Training forms",
  intake: "Intake documents",
  authorization: "Authorizations",
  credential: "Credentials",
};
const SERVICE_LABEL: Record<string, string> = { cls: "CLS", respite: "Respite" };

/** Group label for one shell: progress notes per service (CLS / Respite / Any service), intake per document type. */
export function shellGroup(s: Pick<Shell, "kind" | "service_type" | "intake_doc_type">): string {
  const base = KIND_LABEL[s.kind] ?? s.kind;
  if (s.kind === "progress_note") return `${base} · ${s.service_type ? SERVICE_LABEL[s.service_type] ?? s.service_type : "Any service"}`;
  if (s.kind === "intake") return `${base} · ${humanize(s.intake_doc_type ?? "other")}`;
  return base;
}

/** Shells grouped and ordered: by kind (IPOS first), then service / document type, then name. */
export function groupShells<T extends Shell>(shells: T[]): { group: string; shells: T[] }[] {
  const sorted = [...shells].sort((a, b) =>
    (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) ||
    shellGroup(a).localeCompare(shellGroup(b)) || a.name.localeCompare(b.name));
  const out: { group: string; shells: T[] }[] = [];
  for (const s of sorted) {
    const g = shellGroup(s);
    const last = out[out.length - 1];
    if (last && last.group === g) last.shells.push(s); else out.push({ group: g, shells: [s] });
  }
  return out;
}

export function humanize(code: string): string {
  return code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A field_key for a new field from its label: lower snake case, unique among `taken`. */
export function fieldKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
  const start = /^[a-z]/.test(base) ? base : `f_${base}`;
  let key = start;
  for (let i = 2; used.has(key); i++) key = `${start}_${i}`;
  return key;
}

export type FieldChange =
  | { type: "added"; key: string; label: string }
  | { type: "removed"; key: string; label: string }
  | { type: "changed"; key: string; label: string; what: string[] }
  | { type: "reordered" }
  | { type: "layout"; what: string };

const sameOptions = (a?: string[] | null, b?: string[] | null) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** What a draft changes compared with the current version (for the publish dialog). */
export function diffFields(current: TemplateField[], draft: TemplateField[], curLayout?: NoteLayout | null, newLayout?: NoteLayout | null): FieldChange[] {
  const changes: FieldChange[] = [];
  const cur = new Map(current.map((f) => [f.field_key, f]));
  const nxt = new Map(draft.map((f) => [f.field_key, f]));
  for (const f of draft) {
    const c = cur.get(f.field_key);
    if (!c) { changes.push({ type: "added", key: f.field_key, label: f.label }); continue; }
    const what: string[] = [];
    if (c.label !== f.label) what.push(`label "${c.label}" → "${f.label}"`);
    if (!!c.required !== !!f.required) what.push(f.required ? "now required" : "no longer required");
    if (!sameOptions(c.options, f.options)) what.push("options");
    if (!!c.shown_on_progress_note !== !!f.shown_on_progress_note) what.push(f.shown_on_progress_note ? "shown on progress note" : "hidden from progress note");
    if (what.length) changes.push({ type: "changed", key: f.field_key, label: f.label, what });
  }
  for (const c of current) if (!nxt.has(c.field_key)) changes.push({ type: "removed", key: c.field_key, label: c.label });
  const order = (fs: TemplateField[], keep: Set<string>) => fs.filter((f) => keep.has(f.field_key)).map((f) => f.field_key).join(",");
  const common = new Set(current.map((f) => f.field_key).filter((k) => nxt.has(k)));
  if (order(current, common) !== order(draft, common)) changes.push({ type: "reordered" });
  const bf = (l?: NoteLayout | null) => JSON.stringify(l?.billing_footer ?? null);
  if (bf(curLayout) !== bf(newLayout)) changes.push({ type: "layout", what: "billing footer" });
  if ((curLayout?.notes_prompt ?? "") !== (newLayout?.notes_prompt ?? "")) changes.push({ type: "layout", what: "notes prompt" });
  return changes;
}
