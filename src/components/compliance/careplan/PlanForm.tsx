import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldInput } from "./FieldInput";
import { RowsFields } from "./RowsEditor";
import { useVersionFields } from "@/components/compliance/templates/useVersionFields";
import { diffFields, type TemplateField } from "@/lib/formTemplates";
import {
  cleanFieldValues, GOAL_ENTITIES, HEADER_LABEL, isDateHeader, PLAN_HEADER_COLUMNS, RENEWAL_TEXT, rowSectionFor, validateFieldValues, validateHeader, validateRows,
  type FieldValues, type PlanHeaderColumn, type PlanRow, type ShellRow,
} from "@/lib/carePlan";
import { rpcErrorText } from "@/lib/rpcError";
import type { PlanRowFull } from "./useCarePlanData";

type Header = Partial<Record<PlanHeaderColumn, string>>;
const PLAN_TYPES = [["initial", "Initial"], ["annual", "Annual"], ["addendum", "Addendum"]] as const;

/** Header columns the shell's spine fields write (all of them when there is no shell). */
function headerColumns(fields: TemplateField[] | null): { col: PlanHeaderColumn; label: string }[] {
  if (!fields) return PLAN_HEADER_COLUMNS.map((c) => ({ col: c, label: HEADER_LABEL[c] }));
  const spine = fields.filter((f) => f.storage === "spine_column" && f.writes_to_entity === "care_plan" && (PLAN_HEADER_COLUMNS as readonly string[]).includes(f.writes_to_column ?? ""));
  const cols = spine.map((f) => ({ col: f.writes_to_column as PlanHeaderColumn, label: f.label }));
  for (const c of ["effective_date", "expiration_date"] as const) if (!cols.some((x) => x.col === c)) cols.push({ col: c, label: HEADER_LABEL[c] });
  return cols;
}

function HeaderInputs({ cols, header, onChange }: { cols: { col: PlanHeaderColumn; label: string }[]; header: Header; onChange: (h: Header) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {cols.map(({ col, label }) => (
        <div key={col} className={col === "discharge_criteria" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
          <Label htmlFor={`h-${col}`} className="flex items-center gap-1"><Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />{label}{col === "effective_date" || col === "expiration_date" ? " *" : ""}</Label>
          {col === "discharge_criteria"
            ? <Textarea id={`h-${col}`} rows={2} value={header[col] ?? ""} onChange={(e) => onChange({ ...header, [col]: e.target.value })} />
            : <Input id={`h-${col}`} type={isDateHeader(col) ? "date" : "text"} value={header[col] ?? ""} onChange={(e) => onChange({ ...header, [col]: e.target.value })} />}
        </div>
      ))}
    </div>
  );
}
const cleanHeader = (h: Header) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined && v !== "")) as Header;

/** Fields grouped by their section, in field order. */
function bySection(fields: TemplateField[]) {
  const out: { section: string; fields: TemplateField[] }[] = [];
  for (const f of [...fields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const s = f.section || "Plan";
    const last = out[out.length - 1];
    if (last && last.section === s) last.fields.push(f); else out.push({ section: s, fields: [f] });
  }
  return out;
}

/**
 * Create the plan from the resolved IPOS shell, or edit the active plan's header + narrative
 * (update_care_plan_fields; never bumps a version). Rendered from the field list: spine fields as
 * fixed header inputs, child-row structures as repeatable sections (create only; goals on the Goals
 * tab), field values validated as the RPC does.
 */
export function PlanFormDialog({ open, onOpenChange, mode, clientId, shell, plan, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; mode: "create" | "edit"; clientId: string; shell: ShellRow | null; plan?: PlanRowFull | null; onSaved: () => void;
}) {
  const live = useVersionFields(mode === "create" ? shell?.current_version_id ?? null : null);
  const fields: TemplateField[] | null = mode === "create" ? (shell ? live.data ?? null : null) : (plan?.field_snapshot?.fields ?? null);
  const [planType, setPlanType] = useState<string>("initial");
  const [header, setHeader] = useState<Header>({});
  const [values, setValues] = useState<FieldValues>({});
  const [rows, setRows] = useState<Record<string, PlanRow[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && plan) {
      setHeader(Object.fromEntries(PLAN_HEADER_COLUMNS.map((c) => [c, (plan[c] as string | null) ?? ""])) as Header);
      setValues((plan.field_values ?? {}) as FieldValues);
    } else { setHeader({}); setValues({}); setRows({}); setPlanType("initial"); }
  }, [open, mode, plan]);
  const cols = useMemo(() => headerColumns(mode === "edit" && !plan?.field_snapshot ? null : fields), [fields, mode, plan]);
  const valueFields = (fields ?? []).filter((f) => f.storage === "field_value" || f.storage === "static_text");
  const childFields = (fields ?? []).filter((f) => f.storage === "child_rows");
  const waiting = mode === "create" && !!shell && live.isLoading;

  const submit = async () => {
    const h = cleanHeader(header);
    const problem = validateHeader(h, true) ?? validateFieldValues(fields ?? [], cleanFieldValues(fields ?? [], values));
    if (problem) { toast.error(problem); return; }
    for (const f of childFields) { const s = rowSectionFor(f.writes_to_entity); if (s) { const p = validateRows(s, rows[s.entity] ?? []); if (p) { toast.error(`${s.title}: ${p}`); return; } } }
    setBusy(true);
    if (mode === "create") {
      const { data: planId, error } = await supabase.rpc("create_care_plan", { _client_id: clientId, _plan_type: planType as "initial", _header: h, _field_values: cleanFieldValues(fields ?? [], values) as Json });
      if (error) { setBusy(false); toast.error(rpcErrorText(error)); return; }
      for (const [entity, list] of Object.entries(rows)) {
        const s = rowSectionFor(entity); if (!s || !list.length) continue;
        const payload = list.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "" && v !== null && v !== undefined)));
        const r = await supabase.rpc("set_care_plan_rows", { _care_plan_id: planId as string, _entity: entity, _rows: payload });
        if (r.error) toast.error(`${s.title}: ${rpcErrorText(r.error)}`);
      }
      toast.success("Plan created");
    } else if (plan) {
      const { error } = await supabase.rpc("update_care_plan_fields", { _care_plan_id: plan.id, _header: Object.fromEntries(cols.map(({ col }) => [col, h[col] ?? null])), _field_values: cleanFieldValues(fields ?? [], values) as Json });
      if (error) { setBusy(false); toast.error(rpcErrorText(error)); return; }
      toast.success("Plan updated");
    }
    setBusy(false); onSaved(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[760px]" data-testid="plan-form">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create plan of service (IPOS)" : "Edit header and narrative"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? (shell ? `From ${shell.name} v${shell.current_version}. Fixed fields (lock) write to the plan itself.` : "No IPOS shell is published for this office; the plan is created with its standard fields only.")
              : "Header and narrative edits never change the plan version or training version."}
          </DialogDescription>
        </DialogHeader>
        {waiting ? <p className="text-sm text-muted-foreground">Loading the form…</p> : (
          <div className="space-y-5">
            {mode === "create" && (
              <div className="space-y-1">
                <Label htmlFor="plan-type">Plan type</Label>
                <Select value={planType} onValueChange={setPlanType}>
                  <SelectTrigger id="plan-type" className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAN_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <section className="space-y-2"><h3 className="text-sm font-semibold">Plan header</h3><HeaderInputs cols={cols} header={header} onChange={setHeader} /></section>
            {bySection(valueFields).map((s) => (
              <section key={s.section} className="space-y-3">
                <h3 className="text-sm font-semibold">{s.section}</h3>
                {s.fields.map((f) => f.storage === "static_text"
                  ? <p key={f.field_key} className="text-sm text-muted-foreground">{f.label}</p>
                  : <FieldInput key={f.field_key} field={f} value={values[f.field_key]} onChange={(v) => setValues((x) => ({ ...x, [f.field_key]: v }))} />)}
              </section>
            ))}
            {mode === "create" && childFields.map((f) => {
              if (GOAL_ENTITIES.has(f.writes_to_entity ?? "")) {
                return f.writes_to_entity === "care_plan_goal"
                  ? <p key={f.field_key} className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{f.label}:</span> goals and objectives are added on the Goals tab once the plan exists.</p>
                  : null;
              }
              const s = rowSectionFor(f.writes_to_entity); if (!s) return null;
              return (
                <section key={f.field_key} className="space-y-2">
                  <h3 className="flex items-center gap-1 text-sm font-semibold"><Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />{f.label}</h3>
                  <RowsFields section={s} rows={rows[s.entity] ?? []} onChange={(r) => setRows((x) => ({ ...x, [s.entity]: r }))} />
                </section>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || waiting}>{mode === "create" ? "Create plan" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renew the active plan: type + new dates, then the retraining confirmation before the RPC. */
export function RenewDialog({ open, onOpenChange, plan, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; plan: PlanRowFull; onSaved: () => void }) {
  const [planType, setPlanType] = useState<string>("annual");
  const [eff, setEff] = useState(""); const [exp, setExp] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPlanType("annual"); setEff(""); setExp(""); setStep("form"); } }, [open]);
  const header = () => {
    const h: Header = Object.fromEntries(PLAN_HEADER_COLUMNS.map((c) => [c, (plan[c] as string | null) ?? ""])) as Header;
    if (eff) h.effective_date = eff; if (exp) h.expiration_date = exp;
    return cleanHeader(h);
  };
  const next = () => { const p = validateHeader(header(), true); if (p) { toast.error(p); return; } setStep("confirm"); };
  const renew = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("renew_care_plan", { _care_plan_id: plan.id, _plan_type: planType as "annual", _header: header() });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`Renewed: plan v${plan.version + 1}`); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[520px]">
        <DialogHeader><DialogTitle>Renew plan v{plan.version}</DialogTitle>
          <DialogDescription>Creates plan v{plan.version + 1} from the current IPOS shell; goals, objectives, measures and other rows are copied forward. v{plan.version} becomes read-only.</DialogDescription></DialogHeader>
        {step === "form" ? (
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="renew-type">Plan type</Label>
              <Select value={planType} onValueChange={setPlanType}><SelectTrigger id="renew-type" className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>{PLAN_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="renew-eff">New effective date</Label><Input id="renew-eff" type="date" value={eff} onChange={(e) => setEff(e.target.value)} placeholder={plan.effective_date ?? ""} /></div>
              <div className="space-y-1"><Label htmlFor="renew-exp">New expiration date</Label><Input id="renew-exp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Leave a date empty to keep the current one.</p>
          </div>
        ) : (
          <Alert variant="destructive" data-testid="renewal-confirm">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription><span className="font-medium">{RENEWAL_TEXT}.</span> Every caregiver must sign the in-service and be trained again at version {plan.training_version + 1} before the client is fully onboarded.</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (step === "confirm" ? setStep("form") : onOpenChange(false))}>{step === "confirm" ? "Back" : "Cancel"}</Button>
          {step === "form" ? <Button onClick={next}>Continue</Button> : <Button onClick={renew} disabled={busy}>Renew and start retraining</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Upgrade to template vN": the field diff first, values for the new fields, then upgrade_instance_template. */
export function UpgradeDialog({ open, onOpenChange, plan, shell, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; plan: PlanRowFull; shell: ShellRow; onSaved: () => void }) {
  const { data: next = [], isLoading } = useVersionFields(open ? shell.current_version_id : null);
  const cur = useMemo(() => plan.field_snapshot?.fields ?? [], [plan]);
  const changes = useMemo(() => diffFields(cur, next), [cur, next]);
  const added = next.filter((f) => f.storage === "field_value" && !cur.some((c) => c.field_key === f.field_key));
  const [values, setValues] = useState<FieldValues>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setValues({}); }, [open]);
  const upgrade = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("upgrade_instance_template", { _instance_table: "care_plans", _instance_id: plan.id, _new_values: cleanFieldValues(added, values) as Json });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`Plan now uses ${shell.name} v${shell.current_version}`); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader><DialogTitle>Upgrade to {shell.name} v{shell.current_version}</DialogTitle>
          <DialogDescription>This plan was built from v{plan.template_version}. Values of removed fields are kept as retired values; nothing else changes.</DialogDescription></DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm" data-testid="upgrade-diff">
              {changes.length === 0 && <li className="text-muted-foreground">No field changes.</li>}
              {changes.map((c, i) => (
                <li key={i}>{c.type === "added" ? <>Added <span className="font-medium">{c.label}</span></> : c.type === "removed" ? <>Removed <span className="font-medium">{c.label}</span></>
                  : c.type === "changed" ? <><span className="font-medium">{c.label}</span>: {c.what.join(", ")}</> : c.type === "reordered" ? "Fields reordered" : `Layout: ${c.what}`}</li>
              ))}
            </ul>
            {added.map((f) => <FieldInput key={f.field_key} field={f} value={values[f.field_key]} onChange={(v) => setValues((x) => ({ ...x, [f.field_key]: v }))} />)}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={upgrade} disabled={busy || isLoading}>Upgrade</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
