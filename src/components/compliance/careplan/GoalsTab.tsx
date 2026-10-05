import { useMemo, useState } from "react";
import { Pencil, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { humanize } from "@/lib/formTemplates";
import { groupGoals, RESPONSIBLE_LABEL, type GoalRow, type ObjectiveRow } from "@/lib/carePlan";
import { GoalsEditor } from "./GoalsEditor";
import { MeasuresEditor } from "./MeasuresEditor";
import { useGoals, useMeasureTypes, useOfficeServices, type PlanRowFull } from "./useCarePlanData";

type Selection = { kind: "goal"; id: string } | { kind: "objective"; id: string } | null;

/**
 * Goals tab (S5): goals grouped by the objectives' service, others' objectives as reference; order
 * by seq. Selecting a goal or objective highlights it in place (nothing collapses) and shows its
 * measures beside it. Goal edits go through the retraining check; measure edits never do.
 */
export function GoalsTab({ clientId, officeId, plan, onChanged }: { clientId: string; officeId: string | null; plan: PlanRowFull | null; onChanged: () => void }) {
  const { data: tree, isLoading } = useGoals(clientId, plan?.id ?? null);
  const { data: types = [] } = useMeasureTypes();
  const { data: services = [] } = useOfficeServices(officeId);
  const [sel, setSel] = useState<Selection>(null);
  const [editing, setEditing] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const goals = useMemo(() => (tree?.goals ?? []) as GoalRow[], [tree]);
  const groups = useMemo(() => groupGoals(goals, services), [goals, services]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const allObjectives = goals.flatMap((g) => g.objectives.map((o) => ({ goal: g, o })));
  const selObj = sel?.kind === "objective" ? allObjectives.find((x) => x.o.id === sel.id) ?? null : null;
  const selGoal = sel?.kind === "goal" ? goals.find((g) => g.id === sel.id) ?? null : selObj?.goal ?? null;
  const measuresOf = (o: ObjectiveRow) => (tree?.measures ?? []).filter((m) => m.objective_id === o.id && m.is_active).sort((a, b) => a.seq - b.seq);

  if (!plan) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Create the plan on the IPOS tab first.</CardContent></Card>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const objLabel = (g: GoalRow, o: ObjectiveRow) => `Goal ${g.seq}${o.letter ? ` · ${o.letter}` : ""}`;
  const measurePanel = (
    <Card className="lg:sticky lg:top-4" data-testid="measures-panel">
      <CardHeader className="pb-2"><CardTitle className="text-base">{selObj ? `Measures · ${objLabel(selObj.goal, selObj.o)}` : selGoal ? `Goal ${selGoal.seq}` : "Measures"}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!sel && <p className="text-muted-foreground">Select an objective to see its measures.</p>}
        {sel?.kind === "goal" && selGoal && (
          <div className="space-y-1"><p>{selGoal.objectives.length} objective(s).</p><p className="text-muted-foreground">Select one of its objectives to see the measures.</p></div>)}
        {selObj && (selObj.o.responsible_party !== "this_agency" ? (
          <p className="text-muted-foreground" data-testid="no-measure-control">Delivered by {RESPONSIBLE_LABEL[selObj.o.responsible_party]?.toLowerCase() ?? "others"}: reference only, no data questions for this agency.</p>
        ) : (
          <>
            {measuresOf(selObj.o).length === 0 ? <p className="text-muted-foreground">No measures yet.</p> : (
              <ol className="list-decimal space-y-2 pl-5" data-testid="measure-list">
                {measuresOf(selObj.o).map((m) => (
                  <li key={m.id}><div>{m.prompt_text}</div><div className="text-xs text-muted-foreground">{typeById.get(m.measure_type_id)?.label ?? "Measure"} · {humanize(typeById.get(m.measure_type_id)?.kind ?? "")}
                    {m.trial_count ? ` · ${m.trial_count} trials` : ""}{m.options?.length ? ` · ${m.options.join(" / ")}` : ""}</div></li>))}
              </ol>
            )}
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setMeasuring(true)} data-testid="edit-measures"><Settings2 className="h-4 w-4" />Edit measures</Button>
          </>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Training version {plan.training_version}. Goal, objective and Instructions-for-Staff changes may start retraining; measures never do.</p>
        <Button size="sm" className="gap-1" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit goals and objectives</Button>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4" data-testid="goal-groups">
          {groups.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No goals yet.</CardContent></Card>}
          {groups.map((grp) => (
            <Card key={grp.key} className={cn(grp.reference && "border-dashed")} data-group={grp.key}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{grp.title}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {grp.items.length === 0 && <p className="text-sm text-muted-foreground">No objectives for this service.</p>}
                {grp.items.map(({ goal, objectives }) => {
                  const goalSel = sel?.kind === "goal" && sel.id === goal.id;
                  return (
                    <div key={`${grp.key}-${goal.id}`} className={cn("rounded-md border p-3 transition-colors", goalSel && "border-primary ring-2 ring-primary/40")} data-goal={goal.seq} data-selected={goalSel || undefined}>
                      <button type="button" className="w-full text-left" onClick={() => setSel({ kind: "goal", id: goal.id as string })}>
                        <span className="text-xs font-semibold text-muted-foreground">Goal {goal.seq}</span>
                        <p className="font-medium">{goal.goal_text}</p>
                      </button>
                      <ul className="mt-2 space-y-2">
                        {objectives.map((o) => {
                          const on = sel?.kind === "objective" && sel.id === o.id;
                          const n = measuresOf(o).length;
                          return (
                            <li key={o.id}>
                              <button type="button" onClick={() => setSel({ kind: "objective", id: o.id as string })} data-objective={`${goal.seq}${o.letter ?? ""}`} data-selected={on || undefined}
                                className={cn("w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/50", on && "border-primary bg-primary/5 ring-2 ring-primary/40")}>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{o.letter ?? "•"}</span>
                                  <span className="min-w-0 flex-1">{o.objective_text}</span>
                                  {grp.reference ? <Badge variant="secondary">{RESPONSIBLE_LABEL[o.responsible_party] ?? o.responsible_party}</Badge>
                                    : <Badge variant="outline">{n} measure{n === 1 ? "" : "s"}</Badge>}
                                </div>
                                {o.staff_instructions && <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium">Instructions for Staff:</span> {o.staff_instructions}</p>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
        {measurePanel}
      </div>
      {editing && <GoalsEditor open={editing} onOpenChange={setEditing} planId={plan.id} trainingVersion={plan.training_version} goals={goals} services={services} onSaved={onChanged} />}
      {measuring && selObj && <MeasuresEditor open={measuring} onOpenChange={setMeasuring} objectiveId={selObj.o.id as string} objectiveLabel={objLabel(selObj.goal, selObj.o)}
        measures={tree?.measures.filter((m) => m.objective_id === selObj.o.id) ?? []} types={types} onSaved={onChanged} />}
    </div>
  );
}
