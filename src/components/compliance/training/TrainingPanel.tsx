import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CheckCircle2, Circle, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseDateOnly } from "@/lib/dateOnly";
import { docTypeLabel, retrainingFor, type TrainingContext } from "@/lib/training";
import { InserviceDialog, TrainingFormDialog } from "./TrainingDialogs";
import { useRetraining } from "./useTrainingData";

const fmt = (s: string | null | undefined) => (s ? format(parseDateOnly(s.slice(0, 10)), "MMM d, yyyy") : "—");

/**
 * The two-step training workflow for one client (arch §9.2 rule 5): in-service (CM -> program lead),
 * then the ISK training form (-> caregivers), the retraining list, and printable copies. Shared by
 * the client page (managers) and /training/:clientId (hr_staff; no clinical content on either).
 */
export function TrainingPanel({ ctx, onChanged }: { ctx: TrainingContext; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"inservice" | "training" | null>(null);
  const { data: retrainRows = [], isError: retrainErr } = useRetraining(ctx.office_id);
  const names = new Map(ctx.caregivers.map((c) => [c.caregiver_id, c.name]));
  const retrain = retrainingFor(retrainRows, ctx.client_id, names);
  const tv = ctx.plan?.training_version ?? null;
  const printBase = `/training/${ctx.client_id}/print`;
  if (!ctx.plan) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No active plan: training is recorded against the active plan.</CardContent></Card>;
  const trainedNow = ctx.caregivers.filter((c) => c.trained_current).length;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" data-testid="training-panel">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Training · plan v{ctx.plan.version}, training version {tv}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3">
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" id="inservice-step" data-step="inservice" data-done={ctx.inservice_current}>
              <div className="flex items-start gap-2">
                {ctx.inservice_current ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                <div><div className="font-medium">1. In-service form (case manager → program lead)</div>
                  <div className="text-xs text-muted-foreground">{ctx.inservice_current ? `Signed for training version ${tv}` : `Not yet recorded for training version ${tv}`}</div></div>
              </div>
              <Button size="sm" variant={ctx.inservice_current ? "outline" : "default"} onClick={() => setDialog("inservice")}>Record in-service</Button>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" data-step="training">
              <div className="flex items-start gap-2">
                {trainedNow > 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                <div><div className="font-medium">2. Training form (program lead → caregivers)</div>
                  <div className="text-xs text-muted-foreground">{trainedNow} caregiver{trainedNow === 1 ? "" : "s"} trained at version {tv}{ctx.inservice_current ? "" : " · needs the in-service first"}</div></div>
              </div>
              <Button size="sm" variant={ctx.inservice_current ? "default" : "outline"} onClick={() => setDialog("training")}>Record training form</Button>
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card data-testid="retraining-list">
        <CardHeader className="pb-2"><CardTitle className="text-base">Needs retraining before their shifts</CardTitle></CardHeader>
        <CardContent>
          {retrainErr ? <p className="text-sm text-muted-foreground">Not available.</p> : retrain.length === 0 ? <p className="text-sm text-muted-foreground">Every caregiver on an upcoming shift is trained at version {tv}.</p> : (
            <ul className="divide-y text-sm">{retrain.map((r) => (
              <li key={r.caregiver_id} className="flex flex-wrap justify-between gap-2 py-2" data-retrain={r.name}><span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">next shift {fmt(r.next)} · {r.shifts} shift{r.shifts === 1 ? "" : "s"} · needs version {r.training_version}</span></li>))}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recorded forms</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Form</TableHead><TableHead>Version</TableHead><TableHead>Details</TableHead><TableHead>Date</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {ctx.inservice_forms.length + ctx.training_forms.length === 0 && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">None yet.</TableCell></TableRow>}
                {ctx.inservice_forms.map((f) => (
                  <TableRow key={f.id} data-form="inservice">
                    <TableCell className="whitespace-nowrap font-medium">In-service</TableCell>
                    <TableCell>v{f.training_version}{f.training_version === tv ? <Badge variant="outline" className="ml-2">current</Badge> : null}</TableCell>
                    <TableCell className="text-sm">CM {f.case_manager_name} → {f.program_lead_name ?? "program lead"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmt(f.trained_on)}</TableCell>
                    <TableCell className="text-right"><Button asChild size="sm" variant="ghost" className="gap-1"><Link to={`${printBase}/inservice/${f.id}`}><Printer className="h-4 w-4" />Print</Link></Button></TableCell>
                  </TableRow>
                ))}
                {ctx.training_forms.map((f) => (
                  <TableRow key={f.id} data-form="training">
                    <TableCell className="whitespace-nowrap font-medium">Training (33.01_01F)</TableCell>
                    <TableCell>v{f.training_version}{f.training_version === tv ? <Badge variant="outline" className="ml-2">current</Badge> : null}</TableCell>
                    <TableCell className="text-sm">{docTypeLabel(f.plan_document_type)} · {f.records.map((r) => r.caregiver_name).join(", ")}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmt(f.records[0]?.training_date ?? f.created_at)}</TableCell>
                    <TableCell className="text-right"><Button asChild size="sm" variant="ghost" className="gap-1"><Link to={`${printBase}/training/${f.id}`}><Printer className="h-4 w-4" />Print</Link></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {dialog === "inservice" && <InserviceDialog open onOpenChange={(o) => !o && setDialog(null)} ctx={ctx} today={ctx.as_of} onSaved={onChanged} />}
      {dialog === "training" && <TrainingFormDialog open onOpenChange={(o) => !o && setDialog(null)} ctx={ctx} today={ctx.as_of} onSaved={onChanged}
        onGoToInservice={() => { setDialog("inservice"); document.getElementById("inservice-step")?.scrollIntoView({ block: "center" }); }} />}
    </div>
  );
}
