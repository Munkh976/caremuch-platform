import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { TrainingPanel } from "@/components/compliance/training/TrainingPanel";
import { useRefreshTraining, useTrainingContext, useTrainingStatus } from "@/components/compliance/training/useTrainingData";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { parseDateOnly } from "@/lib/dateOnly";

/**
 * /training (S6): clients of a module office with their training state, for hr_staff (and managers).
 * Non-clinical: client full name (owner, Oct 5), plan / training versions, counts. No goals, needs, notes.
 */
export function TrainingList() {
  const { moduleOffices } = useComplianceOffices();
  const [picked, setPicked] = useState<string | null>(null);
  const officeId = picked ?? moduleOffices[0]?.id ?? null;
  const { data = [], isLoading, isError } = useTrainingStatus(officeId);
  return (
    <ModuleShell title="Client training" description="In-service and training forms per client plan version." icon={GraduationCap} slice="S6">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <OfficePicker offices={moduleOffices} value={officeId} onChange={setPicked} />
        <div className="overflow-x-auto rounded-md border" data-testid="training-list">
          <Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Plan</TableHead><TableHead>In-service</TableHead><TableHead className="text-right">Trained</TableHead><TableHead className="text-right">Need retraining</TableHead><TableHead>Last training</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
              {isError && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Not available.</TableCell></TableRow>}
              {!isLoading && !isError && data.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No client with an active plan.</TableCell></TableRow>}
              {data.map((r) => (
                <TableRow key={r.client_id} data-training-client={r.client_id}>
                  <TableCell className="font-medium"><Link to={`/training/${r.client_id}`} className="hover:underline">{r.client_name}</Link></TableCell>
                  <TableCell className="whitespace-nowrap text-sm">v{r.plan_version} · training v{r.training_version}</TableCell>
                  <TableCell>{r.inservice_current ? <Badge variant="outline" className="border-success/40 bg-success/10">Signed</Badge> : <Badge variant="outline" className="border-warning/40 bg-warning/15">Needed</Badge>}</TableCell>
                  <TableCell className="text-right">{r.caregivers_trained}</TableCell>
                  <TableCell className="text-right">{r.needing_retraining}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.last_training_date ? format(parseDateOnly(r.last_training_date), "MMM d, yyyy") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </ModuleShell>
  );
}

/**
 * /training/:clientId (S6): the training workflow for one client, without clinical content. The header
 * shows the full name (owner, Oct 5: HR matches the paper forms; a name isn't clinical content).
 */
export function TrainingClient() {
  const { clientId = "" } = useParams();
  const ctx = useTrainingContext(clientId);
  const refresh = useRefreshTraining(clientId);
  return (
    <ModuleShell title="Client training" description="In-service and training forms for one client's plan." icon={GraduationCap} slice="S6">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <Link to="/training" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />All clients</Link>
        {ctx.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : ctx.isError || !ctx.data ? (
          <Card data-testid="training-denied"><CardContent className="py-10 text-center text-sm text-muted-foreground">You can't open this client here, or the record wasn't found.</CardContent></Card>
        ) : (
          <>
            <Card data-testid="training-header"><CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
              <div><h2 className="text-xl font-semibold">{ctx.data.client_name}</h2><p className="text-sm text-muted-foreground">{ctx.data.office_name}</p></div>
              {ctx.data.plan && <Badge variant="outline">Plan v{ctx.data.plan.version} · training v{ctx.data.plan.training_version}</Badge>}
            </CardContent></Card>
            <TrainingPanel ctx={ctx.data} onChanged={refresh} />
          </>
        )}
      </div>
    </ModuleShell>
  );
}
