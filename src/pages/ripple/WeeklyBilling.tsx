import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Hammer, Lock, Receipt } from "lucide-react";
import { toast } from "sonner";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { clientShort, fmtDay, fmtTime, SERVICE_LABEL } from "@/lib/caregiverNotes";
import {
  addDays, approveBlockers, batchName, billingCsv, byClient, capText, csvFileName, fixLink, newestBatch, REASON_LABEL, weekLabel,
  type BillBatch, type BillingWeek,
} from "@/lib/billing";

const STATUS: Record<string, string> = { open: "Built — not approved", approved: "Approved — not billed", billed: "Billed" };
const outline = "hover:bg-muted hover:text-foreground";

function useBillingWeek(officeId: string | null, week: string | null) {
  return useQuery({
    queryKey: ["billing-week", officeId, week],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<BillingWeek> => {
      const { data, error } = await supabase.rpc("get_billing_week", { _office_id: officeId as string, _week_start: week ?? undefined } as never);
      if (error) throw error;
      return data as unknown as BillingWeek;
    },
  });
}

/** One bill of the week (main or supplement): status, banners, the table with totals, and its own actions. */
function BatchSection({ w, b, newest, busy, onApprove, onBill }: { w: BillingWeek; b: BillBatch; newest: boolean; busy: boolean; onApprove: () => void; onBill: () => void }) {
  const tz = w.office.timezone;
  const blockers = newest ? approveBlockers(w, b) : [];
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([billingCsv(w, b)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = csvFileName(w, b); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tag = `batch-${b.supplement}`;
  return (
    <Card data-testid={tag} data-batch-status={b.status}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">{batchName(b)}</CardTitle>
        <Badge variant={b.status === "billed" ? "secondary" : b.status === "approved" ? "default" : "outline"} data-testid={`${tag}-status`}>{STATUS[b.status]}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {b.status === "billed" && (
          <Alert data-testid={`${tag}-billed-banner`}><Lock className="h-4 w-4" /><AlertTitle>Billed on {fmtTime(b.billed_at as string, tz, true)} by {b.billed_by_name ?? "—"}</AlertTitle>
            <AlertDescription>This bill is locked: its notes can't be returned, reviewed or edited. Notes reviewed later go into a supplement.</AlertDescription></Alert>
        )}
        {b.status === "approved" && (
          <Alert data-testid={`${tag}-approved-banner`}><CheckCircle2 className="h-4 w-4" /><AlertTitle>Approved on {fmtTime(b.approved_at as string, tz, true)} by {b.approved_by_name ?? "—"}</AlertTitle>
            <AlertDescription>Mark it billed once the claim is sent. If a note is reviewed for this week before then, "Build week again" reopens this bill.</AlertDescription></Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {b.status === "open" && newest && <Button className="gap-1" disabled={busy || blockers.length > 0} data-testid={`${tag}-approve`} onClick={onApprove}><CheckCircle2 className="h-4 w-4" />{b.supplement === 0 ? "Approve week" : "Approve supplement"}</Button>}
          {b.status === "approved" && <Button className="gap-1" disabled={busy} data-testid={`${tag}-mark-billed`} onClick={onBill}><Lock className="h-4 w-4" />Mark billed</Button>}
          {(b.status === "approved" || b.status === "billed") && <Button variant="outline" className={`gap-1 ${outline}`} data-testid={`${tag}-export`} onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button>}
        </div>
        {b.status === "open" && newest && blockers.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground" data-testid={`${tag}-blockers`}>{blockers.map((x) => <li key={x}>{x}</li>)}</ul>}
        {b.lines.length === 0 ? <p className="text-sm text-muted-foreground">No reviewed notes in this bill yet.</p> : (
          <>
            <div className="hidden overflow-x-auto md:block" data-testid={`${tag}-table`}>
              <Table>
                <TableHeader><TableRow><TableHead>Client / authorization</TableHead><TableHead>Service · dates</TableHead><TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Lost to late arrival</TableHead><TableHead>Cap · left now</TableHead><TableHead className="text-right">Units left now</TableHead></TableRow></TableHeader>
                <TableBody>
                  {byClient(b.lines).map((c) => [
                    <TableRow key={c.client_id} className="bg-muted/40" data-client-row={c.client_id}><TableCell colSpan={7} className="font-semibold">{c.name}{c.case_number ? <span className="font-normal text-muted-foreground"> · Case {c.case_number}</span> : null}</TableCell></TableRow>,
                    ...c.lines.map((l) => (
                      <TableRow key={`${c.client_id}-${l.authorization.id}`} data-bill-line={l.authorization.auth_number}>
                        <TableCell><p className="font-medium">#{l.authorization.auth_number}</p>
                          <p className="text-xs text-muted-foreground">{l.notes.map((n, i) => <span key={n.note_id}>{i ? " · " : ""}<Link to={`/progress-notes/${n.note_id}`} className="hover:underline">{fmtDay(n.service_date)}{n.arrived_late ? " (late)" : ""}</Link></span>)}</p></TableCell>
                        <TableCell className="text-sm">{SERVICE_LABEL[l.authorization.service_type] ?? l.authorization.service_type}{l.authorization.service_code ? ` · ${l.authorization.service_code}` : ""}<br /><span className="text-xs text-muted-foreground">{fmtDay(l.authorization.effective_date)} – {fmtDay(l.authorization.expiration_date)}</span></TableCell>
                        <TableCell className="text-right tabular-nums">{l.units_scheduled}</TableCell><TableCell className="text-right tabular-nums font-medium">{l.units_billed}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.units_lost_late}</TableCell><TableCell className="text-sm">{capText(l.authorization)}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.authorization.units_left}</TableCell>
                      </TableRow>)),
                    <TableRow key={`${c.client_id}-t`} data-client-total={c.client_id}><TableCell colSpan={2} className="text-right text-sm text-muted-foreground">{c.name} total</TableCell>
                      <TableCell className="text-right tabular-nums">{c.totals.s}</TableCell><TableCell className="text-right tabular-nums font-semibold">{c.totals.b}</TableCell><TableCell className="text-right tabular-nums">{c.totals.l}</TableCell><TableCell colSpan={2} /></TableRow>,
                  ])}
                  <TableRow className="border-t-2" data-testid={`${tag}-total`}><TableCell colSpan={2} className="text-right font-semibold">{batchName(b)} total ({b.totals.notes} note{Number(b.totals.notes) === 1 ? "" : "s"})</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{b.totals.units_scheduled}</TableCell><TableCell className="text-right tabular-nums font-bold">{b.totals.units_billed}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{b.totals.units_lost_late}</TableCell><TableCell colSpan={2} /></TableRow>
                </TableBody>
              </Table>
            </div>
            <ul className="space-y-3 md:hidden" data-testid={`${tag}-cards`}>
              {byClient(b.lines).map((c) => (
                <li key={c.client_id} className="rounded-md border p-3">
                  <p className="font-semibold">{c.name}{c.case_number ? <span className="font-normal text-muted-foreground"> · Case {c.case_number}</span> : null}</p>
                  {c.lines.map((l) => (
                    <div key={l.authorization.id} className="mt-2 border-t pt-2 text-sm">
                      <p className="font-medium">#{l.authorization.auth_number} · {SERVICE_LABEL[l.authorization.service_type] ?? l.authorization.service_type}</p>
                      <p>Scheduled {l.units_scheduled} · Billed <b>{l.units_billed}</b> · Lost to late arrival {l.units_lost_late}</p>
                      <p className="text-muted-foreground">Cap {capText(l.authorization)} · {l.authorization.units_left} unit{Number(l.authorization.units_left) === 1 ? "" : "s"} left now</p>
                      <p className="text-xs">{l.notes.map((n, i) => <span key={n.note_id}>{i ? " · " : ""}<Link to={`/progress-notes/${n.note_id}`} className="text-primary hover:underline">{fmtDay(n.service_date)}{n.arrived_late ? " (late)" : ""}</Link></span>)}</p>
                    </div>))}
                  <p className="mt-2 border-t pt-2 text-sm font-semibold">Total: {c.totals.s} scheduled · {c.totals.b} billed · {c.totals.l} lost</p>
                </li>))}
              <li className="rounded-md border-2 p-3 text-sm font-semibold" data-testid={`${tag}-total-card`}>{batchName(b)} total ({b.totals.notes} note{Number(b.totals.notes) === 1 ? "" : "s"}): {b.totals.units_scheduled} scheduled · {b.totals.units_billed} billed · {b.totals.units_lost_late} lost to late arrival</li>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const BUILD_LABEL: Record<string, string> = { build: "Build week", rebuild: "Build week again", reopen: "Build week again (reopens the approved bill)" };

/**
 * /billing/weekly (S9 + S9b): one office week. Build week (build_billing_batch: the week's reviewed notes). If a note is
 * reviewed after approval, "Build week again" reopens the bill; after billing, "Build supplement N" puts it in a
 * supplementary bill for the same week (claims go by date of service). Each bill: Approve (approve_batch_notes with its
 * notes, confirmed; per-note review already happened in S8, owner Q12 — no bulk approve of rows), Mark billed
 * (mark_batch_billed: locks it and its notes), Export CSV (units only, on demand, nothing stored). Only the week start
 * date is in the URL.
 */
export default function WeeklyBilling() {
  useEffect(() => { document.title = "Weekly billing · CareMuch"; }, []);
  const { moduleOffices } = useComplianceOffices();
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<string | null>(null);
  const officeId = picked ?? moduleOffices[0]?.id ?? null;
  const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(params.get("week") ?? "") ? params.get("week") : null;
  const q = useBillingWeek(officeId, weekParam);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "approve" | "bill"; batch: BillBatch } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const w = q.data;
  const goWeek = (d: string) => { setError(null); setParams({ week: d }, { replace: true }); };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["billing-week"] }), qc.invalidateQueries({ queryKey: ["staff-notes"] }), qc.invalidateQueries({ queryKey: ["billing-week-status"] })]);
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc(fn as never, args as never);
    setBusy(false); setConfirm(null);
    if (e) { setError(e.code === "22023" ? e.message : "That didn't work. Please try again."); return; }
    toast.success(ok); await refresh();
  };
  const newest = w ? newestBatch(w) : null;
  const allBilled = !!w && w.batches.length > 0 && w.batches.every((b) => b.status === "billed") && w.next_action !== "supplement";
  const buildLabel = w ? (w.next_action === "supplement" ? `Build supplement ${(newest?.supplement ?? 0) + 1}` : BUILD_LABEL[w.next_action]) : null;
  const tz = w?.office.timezone ?? "America/New_York";
  const c = confirm?.batch;

  return (
    <ModuleShell title="Weekly Billing" description="Build the week's bill from the reviewed notes, approve it, mark it billed and export it. Units only." icon={Receipt} slice="S9">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <OfficePicker offices={moduleOffices} value={officeId} onChange={(id) => { setPicked(id); setParams({}, { replace: true }); }} />
        {q.isPending && officeId ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError || !w ? (
          <Card data-testid="billing-denied"><CardContent className="py-10 text-center text-sm text-muted-foreground">{q.error && (q.error as { code?: string }).code === "22023" ? (q.error as Error).message : "You can't open this office's billing, or it wasn't found."}</CardContent></Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" data-testid="week-picker">
              <Button variant="outline" size="icon" className={`h-10 w-10 ${outline}`} aria-label="Previous week" onClick={() => goWeek(addDays(w.week_start, -7))}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[13rem] text-center"><p className="font-semibold" data-testid="week-label">{weekLabel(w)}</p>
                <p className="text-xs text-muted-foreground">{w.week_start === w.last_complete_week_start ? "Last complete week" : w.week_start === w.current_week_start ? "This week (not complete)" : `Week of ${fmtDay(w.week_start)}`}</p></div>
              <Button variant="outline" size="icon" className={`h-10 w-10 ${outline}`} aria-label="Next week" disabled={w.week_start >= w.current_week_start} onClick={() => goWeek(addDays(w.week_start, 7))}><ChevronRight className="h-4 w-4" /></Button>
              {w.week_start !== w.last_complete_week_start && <Button variant="ghost" size="sm" onClick={() => goWeek(w.last_complete_week_start)}>Last complete week</Button>}
              <Badge variant={allBilled ? "secondary" : "outline"} className="ml-auto" data-testid="batch-status">
                {w.batches.length === 0 ? "Not built" : allBilled ? `Billed${w.batches.length > 1 ? ` (main + ${w.batches.length - 1} supplement${w.batches.length > 2 ? "s" : ""})` : ""}` : newest ? STATUS[newest.status] : ""}</Badge>
            </div>
            {!w.complete && !allBilled && <p className="text-sm text-muted-foreground">This week isn't over yet; visits later this week aren't in it.</p>}
            {w.next_action !== "none" && buildLabel && (
              <div className="flex flex-wrap items-center gap-2" data-testid="billing-actions">
                <Button variant={w.batches.length === 0 || w.next_action === "supplement" ? "default" : "outline"} className={`gap-1 ${w.batches.length === 0 || w.next_action === "supplement" ? "" : outline}`} disabled={busy}
                  data-testid={w.next_action === "supplement" ? "build-supplement" : "build-week"}
                  onClick={() => act("build_billing_batch", { _office_id: w.office.id, _week_start: w.week_start },
                    w.next_action === "supplement" ? "Supplement built" : w.next_action === "reopen" ? "Bill reopened and rebuilt" : w.batches.length ? "Bill refreshed" : "Week built")}>
                  <Hammer className="h-4 w-4" />{buildLabel}</Button>
                {w.next_action === "supplement" && <span className="text-sm text-muted-foreground">{w.waiting_for_supplement} reviewed note{w.waiting_for_supplement === 1 ? "" : "s"} of this week {w.waiting_for_supplement === 1 ? "is" : "are"} outside the billed bill.</span>}
              </div>
            )}
            {error && <Alert variant="destructive" data-testid="billing-error"><AlertDescription>{error}</AlertDescription></Alert>}

            {w.batches.length === 0 ? (
              <Card><CardContent className="py-6 text-sm text-muted-foreground" data-testid="bill-empty">Not built yet. "Build week" gathers the week's reviewed notes.</CardContent></Card>
            ) : w.batches.map((b) => (
              <BatchSection key={b.id} w={w} b={b} newest={b.id === newest?.id} busy={busy} onApprove={() => setConfirm({ kind: "approve", batch: b })} onBill={() => setConfirm({ kind: "bill", batch: b })} />
            ))}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Not in this week's bills ({w.excluded.length})</CardTitle></CardHeader>
              <CardContent>
                {w.excluded.length === 0 ? <p className="text-sm text-muted-foreground">Every visit of this week is in a bill.</p> : (
                  <ul className="divide-y" data-testid="exclusions">
                    {w.excluded.map((x) => (
                      <li key={x.note_id ?? x.shift_id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-excluded={x.note_id ?? `shift:${x.shift_id}`} data-reason={x.reason}>
                        <div className="min-w-0"><p className="font-medium">{clientShort(x.client_first_name, x.client_last_initial)} <span className="font-normal text-muted-foreground">· {SERVICE_LABEL[x.service_type] ?? x.service_type} · {fmtDay(x.service_date)}, {fmtTime(x.scheduled_start, tz)} · {x.caregiver_name}</span></p>
                          <p className="text-sm text-muted-foreground">{REASON_LABEL[x.reason] ?? x.reason}</p></div>
                        <Link to={fixLink(x)} className="text-sm font-medium text-primary hover:underline">{x.note_id ? "Open note" : "Open overdue notes"}</Link>
                      </li>))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
              {c && <DialogContent data-testid={confirm?.kind === "bill" ? "bill-confirm" : "approve-confirm"}>
                <DialogHeader>
                  <DialogTitle>{confirm?.kind === "bill" ? `Mark ${batchName(c).toLowerCase()} billed?` : `Approve ${c.supplement === 0 ? "this week" : batchName(c).toLowerCase()}?`}</DialogTitle>
                  <DialogDescription>{confirm?.kind === "bill" ? "Billing locks this bill and its notes for good." : "Every note in this bill was reviewed one at a time. A note reviewed later reopens it, or goes into a supplement once it is billed."}</DialogDescription>
                </DialogHeader>
                <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="confirm-totals">
                  <dt className="text-muted-foreground">Week</dt><dd>{weekLabel(w)}</dd>
                  <dt className="text-muted-foreground">Bill</dt><dd>{batchName(c)}</dd>
                  <dt className="text-muted-foreground">Clients</dt><dd>{byClient(c.lines).length}</dd>
                  <dt className="text-muted-foreground">Notes</dt><dd>{c.totals.notes}</dd>
                  <dt className="text-muted-foreground">Units scheduled</dt><dd>{c.totals.units_scheduled}</dd>
                  <dt className="text-muted-foreground">Units billed</dt><dd className="font-semibold">{c.totals.units_billed}</dd>
                  <dt className="text-muted-foreground">Units lost to late arrival</dt><dd>{c.totals.units_lost_late}</dd>
                </dl>
                <DialogFooter>
                  <Button variant="outline" className={outline} onClick={() => setConfirm(null)}>Cancel</Button>
                  {confirm?.kind === "bill"
                    ? <Button disabled={busy} data-testid="confirm-bill" onClick={() => act("mark_batch_billed", { _batch_id: c.id }, `${batchName(c)} marked billed`)}>Mark billed</Button>
                    : <Button disabled={busy} data-testid="confirm-approve" onClick={() => act("approve_batch_notes", { _batch_id: c.id, _note_ids: c.lines.flatMap((l) => l.notes.map((n) => n.note_id)) }, `${batchName(c)} approved`)}>Approve</Button>}
                </DialogFooter>
              </DialogContent>}
            </Dialog>
          </>
        )}
      </div>
    </ModuleShell>
  );
}
