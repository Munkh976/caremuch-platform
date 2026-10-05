import { useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldInput } from "@/components/compliance/careplan/FieldInput";
import { cleanFieldValues, validateFieldValues, type FieldValues } from "@/lib/carePlan";
import { docTypeFor, METHOD_LABEL, PLAN_DOC_TYPES, type PlanDocType, type TrainingContext } from "@/lib/training";
import { rpcErrorText } from "@/lib/rpcError";

/** A date (YYYY-MM-DD) as a timestamp at local noon, for signed_at (the server refuses future times). */
const atNoon = (d: string) => new Date(`${d}T12:00:00`).toISOString();

/** Step 1 (record_inservice_form): the case manager trains the program lead, who signs. */
export function InserviceDialog({ open, onOpenChange, ctx, today, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; ctx: TrainingContext; today: string; onSaved: () => void }) {
  const [cm, setCm] = useState(""); const [lead, setLead] = useState<string>(""); const [on, setOn] = useState(today); const [signed, setSigned] = useState(today);
  const [values, setValues] = useState<FieldValues>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCm(""); setLead(""); setOn(today); setSigned(today); setValues({}); } }, [open, today]);
  const fields = ctx.inservice_fields ?? [];
  const save = async () => {
    if (!ctx.plan) return;
    if (!cm.trim() || !lead || !on || !signed) { toast.error("Case manager, program lead, training date and signed date are required"); return; }
    const p = validateFieldValues(fields, cleanFieldValues(fields, values)); if (p) { toast.error(p); return; }
    setBusy(true);
    const { error } = await supabase.rpc("record_inservice_form", { _care_plan_id: ctx.plan.care_plan_id, _case_manager_name: cm.trim(), _program_lead_id: lead,
      _trained_on: on, _signed_at: atNoon(signed), _field_values: cleanFieldValues(fields, values) as Json });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`In-service recorded for training version ${ctx.plan.training_version}`); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[560px]" data-testid="inservice-dialog">
        <DialogHeader><DialogTitle>In-service form · training version {ctx.plan?.training_version}</DialogTitle>
          <DialogDescription>The case manager trained the program lead on {ctx.client_name}'s plan v{ctx.plan?.version}; the program lead signs.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="in-cm">Case manager (trainer) *</Label><Input id="in-cm" value={cm} onChange={(e) => setCm(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="in-lead">Program lead (signs) *</Label>
            <Select value={lead || undefined} onValueChange={setLead}><SelectTrigger id="in-lead"><SelectValue placeholder="Manager of this office or agency admin" /></SelectTrigger>
              <SelectContent>{ctx.program_leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name ?? "Staff"}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor="in-on">Trained on *</Label><Input id="in-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="in-signed">Signed *</Label><Input id="in-signed" type="date" value={signed} onChange={(e) => setSigned(e.target.value)} /></div>
        </div>
        {fields.filter((f) => f.storage === "field_value").map((f) => <FieldInput key={f.field_key} field={f} value={values[f.field_key]} onChange={(v) => setValues((x) => ({ ...x, [f.field_key]: v }))} />)}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={busy}>Record in-service</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Row { caregiver_id: string; training_date: string; training_method: "pcp_meeting" | "outside_pcp" | ""; primary_clinician_name: string; trainer_name: string; signed_date: string }

/** Step 2 (record_training_form, ISK 33.01_01F): one row per trained caregiver. Refused before the in-service at the current version. */
export function TrainingFormDialog({ open, onOpenChange, ctx, today, onSaved, onGoToInservice }: {
  open: boolean; onOpenChange: (o: boolean) => void; ctx: TrainingContext; today: string; onSaved: () => void; onGoToInservice: () => void;
}) {
  const [docType, setDocType] = useState<PlanDocType>("ipos_annual"); const [eff, setEff] = useState(""); const [loc, setLoc] = useState("");
  const [rows, setRows] = useState<Row[]>([]); const [values, setValues] = useState<FieldValues>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDocType(docTypeFor(ctx.plan?.plan_type)); setEff(ctx.plan?.effective_date ?? ""); setLoc(""); setRows([]); setValues({}); } }, [open, ctx.plan]);
  const fields = ctx.training_fields ?? [];
  const set = (i: number, r: Partial<Row>) => setRows((x) => x.map((y, j) => (j === i ? { ...y, ...r } : y)));
  const used = new Set(rows.map((r) => r.caregiver_id));
  const save = async () => {
    if (!ctx.plan) return;
    if (!rows.length || rows.some((r) => !r.caregiver_id || !r.training_date)) { toast.error("Add at least one caregiver, each with a training date"); return; }
    const p = validateFieldValues(fields, cleanFieldValues(fields, values)); if (p) { toast.error(p); return; }
    setBusy(true);
    const records = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")));
    const { error } = await supabase.rpc("record_training_form", { _care_plan_id: ctx.plan.care_plan_id, _plan_document_type: docType, // both parameters have no default: send null (an omitted key makes PostgREST look for another signature)
      _plan_effective_date: (eff || null) as string, _location: (loc.trim() || null) as string, _records: records as Json, _field_values: cleanFieldValues(fields, values) as Json });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`Training recorded for ${rows.length} caregiver${rows.length === 1 ? "" : "s"}`); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[760px]" data-testid="training-dialog">
        <DialogHeader><DialogTitle>Training form (ISK 33.01_01F) · training version {ctx.plan?.training_version}</DialogTitle>
          <DialogDescription>Caregivers trained on {ctx.client_name}'s plan by the case manager, clinician or program lead.</DialogDescription></DialogHeader>
        {!ctx.inservice_current ? (
          <Alert variant="destructive" data-testid="training-refused">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p><span className="font-medium">The in-service form for training version {ctx.plan?.training_version} isn't recorded yet.</span> Caregivers are trained after the program lead is: record and sign the in-service first, then this form.</p>
              <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onGoToInservice(); }}>Go to the in-service step</Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label htmlFor="tr-type">Type of plan *</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as PlanDocType)}><SelectTrigger id="tr-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAN_DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label htmlFor="tr-eff">Plan effective date</Label><Input id="tr-eff" type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="tr-loc">Location</Label><Input id="tr-loc" value={loc} onChange={(e) => setLoc(e.target.value)} /></div>
            </div>
            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2" data-training-row={i}>
                  <div className="space-y-1 sm:col-span-2"><Label htmlFor={`tr-${i}-cg`} className="text-xs">Caregiver *</Label>
                    <Select value={r.caregiver_id || undefined} onValueChange={(v) => set(i, { caregiver_id: v })}><SelectTrigger id={`tr-${i}-cg`}><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>{ctx.caregivers.filter((c) => c.caregiver_id === r.caregiver_id || !used.has(c.caregiver_id)).map((c) => <SelectItem key={c.caregiver_id} value={c.caregiver_id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label htmlFor={`tr-${i}-date`} className="text-xs">Training / PCP meeting date *</Label><Input id={`tr-${i}-date`} type="date" value={r.training_date} onChange={(e) => set(i, { training_date: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor={`tr-${i}-method`} className="text-xs">Method</Label>
                    <Select value={r.training_method || undefined} onValueChange={(v) => set(i, { training_method: v as Row["training_method"] })}><SelectTrigger id={`tr-${i}-method`}><SelectValue placeholder="PCP / outside PCP" /></SelectTrigger>
                      <SelectContent>{Object.entries(METHOD_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label htmlFor={`tr-${i}-clin`} className="text-xs">Primary clinician</Label><Input id={`tr-${i}-clin`} value={r.primary_clinician_name} onChange={(e) => set(i, { primary_clinician_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor={`tr-${i}-trainer`} className="text-xs">Trainer</Label><Input id={`tr-${i}-trainer`} value={r.trainer_name} onChange={(e) => set(i, { trainer_name: e.target.value })} /></div>
                  <div className="flex justify-end sm:col-span-2"><Button size="sm" variant="ghost" className="gap-1" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" />Remove</Button></div>
                </div>
              ))}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setRows((x) => [...x, { caregiver_id: "", training_date: today, training_method: "", primary_clinician_name: "", trainer_name: "", signed_date: "" }])}>
                <Plus className="h-3 w-3" />Add caregiver</Button>
            </div>
            {fields.filter((f) => f.storage === "field_value").map((f) => <FieldInput key={f.field_key} field={f} value={values[f.field_key]} onChange={(v) => setValues((x) => ({ ...x, [f.field_key]: v }))} />)}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>{ctx.inservice_current && <Button onClick={save} disabled={busy}>Record training</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
