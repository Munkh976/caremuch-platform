import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { humanize } from "@/lib/formTemplates";
import { MEASURE_SETTING, measuresPayload, validateMeasures, type MeasureDraft } from "@/lib/carePlan";
import { rpcErrorText } from "@/lib/rpcError";
import type { MeasureRow, MeasureTypeRow } from "./useCarePlanData";

const move = <T,>(list: T[], i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };

/** Measures of one objective from the measure library, with per-kind settings (set_objective_measures). Never asks about retraining. */
export function MeasuresEditor({ open, onOpenChange, objectiveId, objectiveLabel, measures, types, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; objectiveId: string; objectiveLabel: string; measures: MeasureRow[]; types: MeasureTypeRow[]; onSaved: () => void;
}) {
  const byId = new Map(types.map((t) => [t.id, t]));
  const toDraft = (m: MeasureRow): MeasureDraft => ({ measure_type_id: m.measure_type_id, kind: byId.get(m.measure_type_id)?.kind ?? "short_answer", prompt_text: m.prompt_text,
    options: m.options ?? [], trial_count: m.trial_count });
  const [draft, setDraft] = useState<MeasureDraft[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDraft(measures.filter((m) => m.is_active).map(toDraft)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = types.filter((t) => t.is_active);
  const set = (i: number, m: Partial<MeasureDraft>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...m } : x)));
  const add = () => { const t = active[0]; if (!t) return; setDraft((d) => [...d, { measure_type_id: t.id, kind: t.kind, prompt_text: "", options: t.default_options ?? [], trial_count: t.kind === "trials" ? 5 : null }]); };
  const save = async () => {
    const problem = validateMeasures(draft);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const { error } = await supabase.rpc("set_objective_measures", { _objective_id: objectiveId, _measures: measuresPayload(draft) as Json });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("Measures saved"); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[680px]" data-testid="measures-editor">
        <DialogHeader><DialogTitle>Measures · {objectiveLabel}</DialogTitle>
          <DialogDescription>Data questions caregivers answer on the progress note. Changing them never starts retraining.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {draft.length === 0 && <p className="text-sm text-muted-foreground">No measures yet.</p>}
          {draft.map((m, i) => {
            const s = MEASURE_SETTING[m.kind];
            return (
              <div key={i} className="space-y-2 rounded-md border p-3" data-measure-row={i}>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1"><Label htmlFor={`m-${i}-type`} className="text-xs">Measure type</Label>
                    <Select value={m.measure_type_id} onValueChange={(v) => { const t = byId.get(v); if (t) set(i, { measure_type_id: v, kind: t.kind, options: t.default_options ?? [], trial_count: t.kind === "trials" ? m.trial_count ?? 5 : null }); }}>
                      <SelectTrigger id={`m-${i}-type`}><SelectValue /></SelectTrigger>
                      <SelectContent>{active.map((t) => <SelectItem key={t.id} value={t.id}>{t.label} · {humanize(t.kind)}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <Button type="button" size="icon" variant="ghost" aria-label="Move up" onClick={() => setDraft((d) => move(d, i, -1))}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Move down" onClick={() => setDraft((d) => move(d, i, 1))}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove measure" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-1"><Label htmlFor={`m-${i}-prompt`} className="text-xs">{s.prompt}</Label>
                  {m.kind === "narrative" || m.kind === "staff_note"
                    ? <Textarea id={`m-${i}-prompt`} rows={2} value={m.prompt_text} onChange={(e) => set(i, { prompt_text: e.target.value })} />
                    : <Input id={`m-${i}-prompt`} value={m.prompt_text} onChange={(e) => set(i, { prompt_text: e.target.value })} />}</div>
                {s.options && <div className="space-y-1"><Label htmlFor={`m-${i}-opts`} className="text-xs">{s.options} (one per line)</Label>
                  <Textarea id={`m-${i}-opts`} rows={3} value={m.options.join("\n")} onChange={(e) => set(i, { options: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></div>}
                {s.trials && <div className="space-y-1"><Label htmlFor={`m-${i}-trials`} className="text-xs">Trials per visit (1-20)</Label>
                  <Input id={`m-${i}-trials`} type="number" min={1} max={20} className="w-28" value={m.trial_count ?? ""} onChange={(e) => set(i, { trial_count: e.target.value ? Number(e.target.value) : null })} /></div>}
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={add}><Plus className="h-3 w-3" />Add measure</Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={busy}>Save measures</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
