import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { ChevronDown, ChevronRight, Printer, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { FilterChip } from "@/components/compliance/FilterChip";
import { parseDateOnly } from "@/lib/dateOnly";
import { buildRoster, docTypeLabel, filterRoster, METHOD_LABEL, PLAN_TYPE_LABEL, retrainingFor, sessionSummary, trainedCount,
  type RosterFilter, type TrainingContext } from "@/lib/training";
import { AttachmentsButton, useAttachmentCounts } from "@/components/compliance/attachments/Attachments";
import { AddToSessionDialog, InserviceDialog, TrainingFormDialog } from "./TrainingDialogs";
import { useRetraining } from "./useTrainingData";

const fmt = (s: string | null | undefined) => (s ? format(parseDateOnly(s.slice(0, 10)), "MMM d, yyyy") : "—");

/**
 * Client "Training" tab (S15), modelled on ISK 33.01_01F (IPOS Proof of Training), per plan version:
 *   a. header: plan version and type, effective date, in-service signed, N of M caregivers trained;
 *   b. in-service (case manager -> program lead) + Record;
 *   c. training sessions (one training form = one session: date, trainer, attendees) + Record training session;
 *   d. one caregiver roster (Trained <date> by <trainer> / Needs retraining / Never trained) with "Add to a session"
 *      (an existing session of this version, or a new one);
 *   e. history: every version's forms with Print;
 *   f. files (S4b): the signed in-service and sign-in sheets, per form; earlier versions' files read-only.
 * Training-tier read only (get_client_training_context: no goals, needs or notes), so /training/:clientId (hr_staff) uses it too.
 */
export function TrainingTab({ ctx, onChanged }: { ctx: TrainingContext; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"inservice" | "training" | "add" | null>(null);
  const [preset, setPreset] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<RosterFilter>("all");
  const { data: retrainRows = [] } = useRetraining(ctx.office_id);
  const names = useMemo(() => new Map(ctx.caregivers.map((c) => [c.caregiver_id, c.name])), [ctx.caregivers]);
  const retrain = retrainingFor(retrainRows, ctx.client_id, names);
  // the next shift of each caregiver with this client (staff read; hr_staff may not read shifts: then "—")
  const shifts = useQuery({
    queryKey: ["tr", ctx.client_id, "next-shifts", ctx.as_of],
    retry: false,
    queryFn: async () => {
      const to = format(addDays(parseDateOnly(ctx.as_of), 60), "yyyy-MM-dd");
      const { data, error } = await supabase.from("shifts").select("caregiver_id, shift_date").eq("client_id", ctx.client_id)
        .gte("shift_date", ctx.as_of).lte("shift_date", to).not("caregiver_id", "is", null).neq("status", "cancelled").order("shift_date");
      if (error) throw error;
      const m = new Map<string, string>(); for (const s of data ?? []) if (s.caregiver_id && !m.has(s.caregiver_id)) m.set(s.caregiver_id, s.shift_date);
      return m;
    },
  });
  const roster = buildRoster(ctx, retrain, shifts.data ?? new Map());
  const { data: insFiles } = useAttachmentCounts("inservice_form", ctx.inservice_forms.map((f) => f.id));
  const { data: trFiles } = useAttachmentCounts("training_form", ctx.training_forms.map((f) => f.id));
  const shown = filterRoster(roster, filter);
  const count = trainedCount(roster);
  if (!ctx.plan) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No active plan: training is recorded against the active plan.</CardContent></Card>;
  const plan = ctx.plan, tv = plan.training_version;
  const printBase = `/training/${ctx.client_id}/print`;
  const inservice = ctx.inservice_forms.filter((f) => f.training_version === tv);
  const signed = inservice.find((f) => f.signed_at)?.signed_at ?? null;
  const sessions = ctx.training_forms.filter((f) => f.training_version === tv);
  const addTo = (ids: string[]) => { setPreset(ids); setDialog("training"); };
  const chip = (n: number) => (n ? ` (${n})` : "");

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" data-testid="training-tab">
      {plan.status === "pending" && (
        <Alert className="border-warning/50 bg-warning/10" data-testid="pending-training">
          <AlertDescription><span className="font-medium">IPOS v{plan.version} is pending.</span> It becomes effective when its in-service and one training session are recorded{ctx.in_effect ? `; until then IPOS v${ctx.in_effect.version} stays in effect and caregivers trained on it can keep working` : ""}. Sessions recorded here are for v{plan.version}.</AlertDescription>
        </Alert>
      )}
      <Card data-testid="training-summary">
        <CardContent className="space-y-1 py-4">
          <h3 className="text-lg font-semibold">IPOS v{plan.version} ({PLAN_TYPE_LABEL[plan.plan_type] ?? plan.plan_type}) training</h3>
          <p className="text-sm text-muted-foreground">
            effective {fmt(plan.effective_date)} · {signed ? `In-service signed ${fmt(signed)}` : <span className="font-medium text-destructive">In-service not signed yet</span>} · <span data-testid="trained-count">{count.trained} of {count.of} caregivers trained</span>
            <span className="ml-1">(training version {tv})</span>
          </p>
        </CardContent>
      </Card>

      <Card data-testid="inservice-section" id="inservice-step">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">In-service (case manager → program lead)</CardTitle>
          <Button size="sm" variant={signed ? "outline" : "default"} className={signed ? "hover:bg-muted hover:text-foreground" : ""} onClick={() => setDialog("inservice")} data-testid="record-inservice">Record in-service</Button>
        </CardHeader>
        <CardContent>
          {inservice.length === 0 ? <p className="text-sm text-muted-foreground">Not recorded for training version {tv}. Caregivers are trained after the program lead.</p> : (
            <div className="overflow-x-auto rounded-md border"><Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Case manager → program lead</TableHead><TableHead>Signed</TableHead><TableHead>Attachments</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{inservice.map((f) => (
                <TableRow key={f.id} data-inservice={f.id}>
                  <TableCell className="whitespace-nowrap">{fmt(f.trained_on)}</TableCell>
                  <TableCell>{f.case_manager_name} → {f.program_lead_name ?? "program lead"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmt(f.signed_at)}</TableCell>
                  <TableCell><AttachmentsButton kind="inservice_form" parentId={f.id} title={`In-service ${fmt(f.trained_on)}`} count={insFiles?.get(f.id)?.count} /></TableCell>
                  <TableCell className="text-right"><Button asChild size="sm" variant="ghost" className="gap-1"><Link to={`${printBase}/inservice/${f.id}`}><Printer className="h-4 w-4" />Print</Link></Button></TableCell>
                </TableRow>))}</TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="sessions-section">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Training sessions (ISK 33.01_01F)</CardTitle>
          <Button size="sm" variant={signed ? "default" : "outline"} onClick={() => addTo([])} data-testid="record-session">Record training session</Button>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? <p className="text-sm text-muted-foreground">No session at training version {tv} yet.</p> : (
            <div className="overflow-x-auto rounded-md border"><Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type of plan</TableHead><TableHead>Trainer</TableHead><TableHead>Attendees</TableHead><TableHead>Attachments</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{sessions.map((f) => {
                const s = sessionSummary(f), isOpen = open === f.id;
                return (
                  <Fragment key={f.id}>
                    <TableRow data-session={f.id}>
                      <TableCell className="whitespace-nowrap">{fmt(s.date)}</TableCell>
                      <TableCell>{docTypeLabel(s.docType)}</TableCell>
                      <TableCell>{s.trainer ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" className="gap-1 px-2" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.id)} data-testid="session-toggle">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{s.attendees} attendee{s.attendees === 1 ? "" : "s"}</Button>
                      </TableCell>
                      <TableCell><AttachmentsButton kind="training_form" parentId={f.id} title={`Training session ${fmt(s.date)}`} count={trFiles?.get(f.id)?.count} /></TableCell>
                      <TableCell className="text-right"><Button asChild size="sm" variant="ghost" className="gap-1"><Link to={`${printBase}/training/${f.id}`}><Printer className="h-4 w-4" />Print</Link></Button></TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow data-session-attendees={f.id}><TableCell colSpan={6} className="bg-muted/30">
                        <ul className="divide-y text-sm">{f.records.map((r) => (
                          <li key={r.caregiver_id} className="flex flex-wrap justify-between gap-2 py-1.5">
                            <span className="font-medium">{r.caregiver_name}</span>
                            <span className="text-muted-foreground">signed {fmt(r.signed_date)}{r.training_method ? ` · ${METHOD_LABEL[r.training_method]}` : ""}{r.primary_clinician_name ? ` · clinician ${r.primary_clinician_name}` : ""}
                              {r.plan_revision != null && plan.status !== "pending" && f.training_version === tv ? ` · trained on v${plan.version} rev ${r.plan_revision}${plan.revision != null && plan.revision !== r.plan_revision ? ` (now rev ${plan.revision})` : ""}` : ""}</span>
                          </li>))}</ul>
                      </TableCell></TableRow>
                    )}
                  </Fragment>
                );
              })}</TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="roster">
        <CardHeader className="space-y-3 pb-2">
          <CardTitle className="text-base">Caregivers</CardTitle>
          <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as RosterFilter)} className="flex-wrap justify-start" aria-label="Caregiver filter">
            <FilterChip value="all" data-filter="all">All{chip(roster.length)}</FilterChip>
            <FilterChip value="trained" data-filter="trained">Trained{chip(roster.filter((r) => r.status === "trained").length)}</FilterChip>
            <FilterChip value="retrain" data-filter="retrain">Needs retraining{chip(roster.filter((r) => r.status === "retrain").length)}</FilterChip>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border"><Table>
            <TableHeader><TableRow><TableHead>Caregiver</TableHead><TableHead>Training (v{tv})</TableHead><TableHead>Credentials</TableHead><TableHead>Next shift</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">None.</TableCell></TableRow>}
              {shown.map((r) => (
                <TableRow key={r.caregiver_id} data-roster={r.name} data-status={r.status}>
                  <TableCell className="whitespace-nowrap font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm">
                    {r.status === "trained" ? <>Trained {fmt(r.trained_on)}{r.trainer ? ` by ${r.trainer}` : ""}</>
                      : r.status === "retrain" ? <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Needs retraining{r.trained_version ? ` (trained v${r.trained_version})` : ""}</Badge>
                      : <span className="text-muted-foreground">Never trained</span>}
                  </TableCell>
                  <TableCell className="text-sm">{r.credentials_current ? "Current" : <span className="text-destructive">Not current</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{fmt(r.next_shift)}</TableCell>
                  <TableCell className="text-right">
                    {r.status !== "trained" && <Button size="sm" variant="outline" className="gap-1 hover:bg-muted hover:text-foreground" onClick={() => { setPreset([r.caregiver_id]); setDialog(sessions.length ? "add" : "training"); }} data-testid="add-to-session"><UserPlus className="h-4 w-4" />Add to a session</Button>}
                  </TableCell>
                </TableRow>))}
            </TableBody>
          </Table></div>
        </CardContent>
      </Card>

      <Card data-testid="training-history">
        <CardHeader className="pb-2"><CardTitle className="text-base">History (all versions)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border"><Table>
            <TableHeader><TableRow><TableHead>Form</TableHead><TableHead>Version</TableHead><TableHead>Details</TableHead><TableHead>Date</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {ctx.inservice_forms.length + ctx.training_forms.length === 0 && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">None yet.</TableCell></TableRow>}
              {ctx.inservice_forms.map((f) => (
                <TableRow key={f.id} data-form="inservice">
                  <TableCell className="whitespace-nowrap font-medium">In-service</TableCell>
                  <TableCell>v{f.training_version}{f.training_version === tv ? <Badge variant="outline" className="ml-2">current</Badge> : null}</TableCell>
                  <TableCell className="text-sm">CM {f.case_manager_name} → {f.program_lead_name ?? "program lead"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{fmt(f.trained_on)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{f.training_version !== tv && <AttachmentsButton kind="inservice_form" parentId={f.id} title={`In-service ${fmt(f.trained_on)} (v${f.training_version})`} count={insFiles?.get(f.id)?.count} readOnly />}
                    <Button asChild size="sm" variant="ghost" className="gap-1"><Link to={`${printBase}/inservice/${f.id}`}><Printer className="h-4 w-4" />Print</Link></Button></TableCell>
                </TableRow>))}
              {ctx.training_forms.map((f) => { const s = sessionSummary(f); return (
                <TableRow key={f.id} data-form="training">
                  <TableCell className="whitespace-nowrap font-medium">Training session</TableCell>
                  <TableCell>v{f.training_version}{f.training_version === tv ? <Badge variant="outline" className="ml-2">current</Badge> : null}</TableCell>
                  <TableCell className="text-sm">{docTypeLabel(f.plan_document_type)} · {f.records.map((r) => r.caregiver_name).join(", ")}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{fmt(s.date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{f.training_version !== tv && <AttachmentsButton kind="training_form" parentId={f.id} title={`Training session ${fmt(s.date)} (v${f.training_version})`} count={trFiles?.get(f.id)?.count} readOnly />}
                    <Button asChild size="sm" variant="ghost" className="gap-1"><Link to={`${printBase}/training/${f.id}`}><Printer className="h-4 w-4" />Print</Link></Button></TableCell>
                </TableRow>); })}
            </TableBody>
          </Table></div>
        </CardContent>
      </Card>

      {dialog === "inservice" && <InserviceDialog open onOpenChange={(o) => !o && setDialog(null)} ctx={ctx} today={ctx.as_of} onSaved={onChanged} />}
      {dialog === "add" && preset[0] && <AddToSessionDialog open onOpenChange={(o) => !o && setDialog(null)} ctx={ctx} caregiverId={preset[0]} today={ctx.as_of} onSaved={onChanged}
        onNewSession={() => setDialog("training")} />}
      {dialog === "training" && <TrainingFormDialog open onOpenChange={(o) => !o && setDialog(null)} ctx={ctx} today={ctx.as_of} onSaved={onChanged} initialCaregivers={preset}
        onGoToInservice={() => { setDialog("inservice"); document.getElementById("inservice-step")?.scrollIntoView({ block: "center" }); }} />}
    </div>
  );
}
