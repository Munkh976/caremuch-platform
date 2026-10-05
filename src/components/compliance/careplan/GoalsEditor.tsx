import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
import { goalsPayload, renumber, RESPONSIBLE_LABEL, RETRAINING_TEXT, serviceName, validateGoals, type GoalRow, type ObjectiveRow } from "@/lib/carePlan";
import { rpcErrorText } from "@/lib/rpcError";

const move = <T,>(list: T[], i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };
const letterFor = (i: number) => String.fromCharCode(65 + (i % 26));

/**
 * Edit goals, objectives and Instructions for Staff (upsert_care_plan_goals). Before saving, the
 * server is asked whether the save would start retraining (would_bump_training_version); only then
 * the retraining confirmation is shown, and the save happens after it. The write re-applies the rule.
 */
export function GoalsEditor({ open, onOpenChange, planId, trainingVersion, goals, services, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; planId: string; trainingVersion: number; goals: GoalRow[]; services: string[]; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<GoalRow[]>(goals);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDraft(goals); setConfirm(false); } }, [open, goals]);
  const setGoal = (i: number, g: Partial<GoalRow>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const setObj = (i: number, k: number, o: Partial<ObjectiveRow>) => setGoal(i, { objectives: draft[i].objectives.map((x, j) => (j === k ? { ...x, ...o } : x)) });

  const write = async (payload: ReturnType<typeof goalsPayload>) => {
    const { data, error } = await supabase.rpc("upsert_care_plan_goals", { _care_plan_id: planId, _goals: payload as Json });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const tv = (data as { training_version?: number } | null)?.training_version;
    toast.success(tv && tv > trainingVersion ? `Saved. Retraining started (training version ${tv})` : "Goals saved");
    onSaved(); onOpenChange(false);
  };
  const save = async () => {
    const ordered = renumber(draft);
    const problem = validateGoals(ordered, services);
    if (problem) { toast.error(problem); return; }
    const payload = goalsPayload(ordered);
    setBusy(true);
    const { data, error } = await supabase.rpc("would_bump_training_version", { _care_plan_id: planId, _goals: payload as Json });
    if (error) { setBusy(false); toast.error(rpcErrorText(error)); return; }
    const p = data as { changed: boolean; would_bump: boolean };
    if (!p.changed) { setBusy(false); toast.info("Nothing changed"); onOpenChange(false); return; }
    if (p.would_bump && !confirm) { setBusy(false); setConfirm(true); return; }
    await write(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[820px]" data-testid="goals-editor">
        <DialogHeader><DialogTitle>Edit goals and objectives</DialogTitle>
          <DialogDescription>Order follows the list. Measures are edited per objective and never start retraining.</DialogDescription></DialogHeader>
        {confirm ? (
          <Alert variant="destructive" data-testid="retraining-confirm">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription><span className="font-medium">{RETRAINING_TEXT}.</span> Caregivers were trained on version {trainingVersion}; after saving, the plan moves to training version {trainingVersion + 1} and every caregiver needs the in-service and training again.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {draft.map((g, i) => (
              <div key={g.id ?? `g-${i}`} className="space-y-3 rounded-md border p-3" data-edit-goal={i + 1}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1"><Label htmlFor={`goal-${i}`}>Goal {i + 1}</Label><Textarea id={`goal-${i}`} rows={2} value={g.goal_text} onChange={(e) => setGoal(i, { goal_text: e.target.value })} /></div>
                  <div className="flex flex-col gap-1 pt-6">
                    <Button type="button" size="icon" variant="ghost" aria-label={`Move goal ${i + 1} up`} onClick={() => setDraft((d) => move(d, i, -1))}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Move goal ${i + 1} down`} onClick={() => setDraft((d) => move(d, i, 1))}><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove goal ${i + 1}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                {g.objectives.map((o, k) => (
                  <div key={o.id ?? `o-${k}`} className="ml-2 space-y-2 border-l-2 pl-3 sm:ml-4" data-edit-objective={`${i + 1}${o.letter ?? ""}`}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[80px_minmax(0,1fr)_auto]">
                      <div className="space-y-1"><Label htmlFor={`obj-${i}-${k}-letter`} className="text-xs">Letter</Label><Input id={`obj-${i}-${k}-letter`} value={o.letter ?? ""} onChange={(e) => setObj(i, k, { letter: e.target.value })} /></div>
                      <div className="space-y-1"><Label htmlFor={`obj-${i}-${k}-text`} className="text-xs">Objective</Label><Textarea id={`obj-${i}-${k}-text`} rows={2} value={o.objective_text} onChange={(e) => setObj(i, k, { objective_text: e.target.value })} /></div>
                      <div className="flex gap-1 sm:flex-col sm:pt-5">
                        <Button type="button" size="icon" variant="ghost" aria-label="Move objective up" onClick={() => setGoal(i, { objectives: move(g.objectives, k, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" aria-label="Move objective down" onClick={() => setGoal(i, { objectives: move(g.objectives, k, 1) })}><ArrowDown className="h-4 w-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" aria-label="Remove objective" onClick={() => setGoal(i, { objectives: g.objectives.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1"><Label htmlFor={`obj-${i}-${k}-rp`} className="text-xs">Delivered by</Label>
                        <Select value={o.responsible_party} onValueChange={(v) => setObj(i, k, { responsible_party: v, service_type: v === "this_agency" ? o.service_type ?? services[0] ?? null : o.service_type })}>
                          <SelectTrigger id={`obj-${i}-${k}-rp`}><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(RESPONSIBLE_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                        </Select></div>
                      {o.responsible_party === "this_agency" && (
                        <div className="space-y-1"><Label htmlFor={`obj-${i}-${k}-svc`} className="text-xs">Service</Label>
                          <Select value={o.service_type ?? undefined} onValueChange={(v) => setObj(i, k, { service_type: v })}>
                            <SelectTrigger id={`obj-${i}-${k}-svc`}><SelectValue placeholder="Choose" /></SelectTrigger>
                            <SelectContent>{services.map((s) => <SelectItem key={s} value={s}>{serviceName(s)}</SelectItem>)}</SelectContent>
                          </Select></div>)}
                    </div>
                    <div className="space-y-1"><Label htmlFor={`obj-${i}-${k}-instr`} className="text-xs">Instructions for Staff</Label>
                      <Textarea id={`obj-${i}-${k}-instr`} rows={2} value={o.staff_instructions ?? ""} onChange={(e) => setObj(i, k, { staff_instructions: e.target.value })} /></div>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setGoal(i, { objectives: [...g.objectives,
                  { seq: g.objectives.length + 1, letter: letterFor(g.objectives.length), objective_text: "", responsible_party: "this_agency", service_type: services[0] ?? null }] })}>
                  <Plus className="h-3 w-3" />Add objective</Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="gap-1" onClick={() => setDraft((d) => [...d, { seq: d.length + 1, goal_text: "", objectives: [] }])}><Plus className="h-4 w-4" />Add goal</Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (confirm ? setConfirm(false) : onOpenChange(false))}>{confirm ? "Back" : "Cancel"}</Button>
          <Button onClick={save} disabled={busy}>{confirm ? "Save and start retraining" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
