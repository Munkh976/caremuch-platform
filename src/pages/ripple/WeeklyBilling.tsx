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
import { addDays, approveBlockers, billingCsv, byClient, capText, csvFileName, fixLink, REASON_LABEL, weekLabel, type BillingWeek } from "@/lib/billing";

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

/**
 * /billing/weekly (S9): one office week. Build week (build_billing_batch: the week's reviewed notes) →
 * Approve week (approve_batch_notes with the bill's notes, after a confirm; per-note review already happened
 * in S8, owner Q12 — there is no bulk approve of rows) → Mark billed (mark_batch_billed: locks the batch and
 * its notes) → Export CSV (units only, on demand, nothing stored). Only the week start date is in the URL.
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
  const [confirm, setConfirm] = useState<"approve" | "bill" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const w = q.data;
  const goWeek = (d: string) => { setError(null); setParams({ week: d }, { replace: true }); };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["billing-week"] }), qc.invalidateQueries({ queryKey: ["staff-notes"] })]);
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc(fn as never, args as never);
    setBusy(false); setConfirm(null);
    if (e) { setError(e.code === "22023" ? e.message : "That didn't work. Please try again."); return; }
    toast.success(ok); await refresh();
  };
  const exportCsv = () => {
    if (!w) return;
    const url = URL.createObjectURL(new Blob([billingCsv(w)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = csvFileName(w); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const status = w?.batch?.status;
  const blockers = w ? approveBlockers(w) : [];
  const tz = w?.office.timezone ?? "America/New_York";
  const ids = w ? w.lines.flatMap((l) => l.notes.map((n) => n.note_id)) : [];

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
              <Badge variant={status === "billed" ? "secondary" : status === "approved" ? "default" : "outline"} className="ml-auto" data-testid="batch-status">{status ? STATUS[status] : "Not built"}</Badge>
            </div>

            {status === "billed" && (
              <Alert data-testid="billed-banner"><Lock className="h-4 w-4" /><AlertTitle>Billed on {fmtTime(w.batch!.billed_at as string, tz, true)} by {w.batch!.billed_by_name ?? "—"}</AlertTitle>
                <AlertDescription>This week is locked: its notes can't be returned, reviewed or edited. Notes reviewed later stay out of this bill.</AlertDescription></Alert>
            )}
            {status === "approved" && (
              <Alert data-testid="approved-banner"><CheckCircle2 className="h-4 w-4" /><AlertTitle>Approved on {fmtTime(w.batch!.approved_at as string, tz, true)} by {w.batch!.approved_by_name ?? "—"}</AlertTitle>
                <AlertDescription>Mark it billed once the claim is sent. An approved week can't be rebuilt.</AlertDescription></Alert>
            )}
            {!w.complete && status !== "billed" && <p className="text-sm text-muted-foreground">This week isn't over yet; visits later this week aren't in it.</p>}

            <div className="flex flex-wrap items-center gap-2" data-testid="billing-actions">
              {status !== "approved" && status !== "billed" && (
                <Button variant={w.batch ? "outline" : "default"} className={`gap-1 ${w.batch ? outline : ""}`} disabled={busy} data-testid="build-week"
                  onClick={() => act("build_billing_batch", { _office_id: w.office.id, _week_start: w.week_start }, w.batch ? "Bill refreshed" : "Week built")}>
                  <Hammer className="h-4 w-4" />{w.batch ? "Build week again" : "Build week"}</Button>
              )}
              {status === "open" && (
                <Button className="gap-1" disabled={busy || blockers.length > 0} data-testid="approve-week" onClick={() => setConfirm("approve")}><CheckCircle2 className="h-4 w-4" />Approve week</Button>
              )}
              {status === "approved" && <Button className="gap-1" disabled={busy} data-testid="mark-billed" onClick={() => setConfirm("bill")}><Lock className="h-4 w-4" />Mark billed</Button>}
              {(status === "approved" || status === "billed") && <Button variant="outline" className={`gap-1 ${outline}`} data-testid="export-csv" onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button>}
            </div>
            {status === "open" && blockers.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground" data-testid="approve-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            {error && <Alert variant="destructive" data-testid="billing-error"><AlertDescription>{error}</AlertDescription></Alert>}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">This week's bill</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {!w.batch ? <p className="text-sm text-muted-foreground" data-testid="bill-empty">Not built yet. "Build week" gathers the week's reviewed notes.</p>
                  : w.lines.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="bill-empty">No reviewed notes in this week yet.</p> : (
                  <>
                    <div className="hidden overflow-x-auto md:block" data-testid="bill-table">
                      <Table>
                        <TableHeader><TableRow><TableHead>Client / authorization</TableHead><TableHead>Service · dates</TableHead><TableHead className="text-right">Scheduled</TableHead>
                          <TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Lost to late arrival</TableHead><TableHead>Cap · left after this week</TableHead><TableHead className="text-right">Units left</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {byClient(w.lines).map((c) => [
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
                          <TableRow className="border-t-2" data-testid="week-total"><TableCell colSpan={2} className="text-right font-semibold">Week total ({w.totals.notes} notes)</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{w.totals.units_scheduled}</TableCell><TableCell className="text-right tabular-nums font-bold">{w.totals.units_billed}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{w.totals.units_lost_late}</TableCell><TableCell colSpan={2} /></TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    <ul className="space-y-3 md:hidden" data-testid="bill-cards">
                      {byClient(w.lines).map((c) => (
                        <li key={c.client_id} className="rounded-md border p-3">
                          <p className="font-semibold">{c.name}{c.case_number ? <span className="font-normal text-muted-foreground"> · Case {c.case_number}</span> : null}</p>
                          {c.lines.map((l) => (
                            <div key={l.authorization.id} className="mt-2 border-t pt-2 text-sm">
                              <p className="font-medium">#{l.authorization.auth_number} · {SERVICE_LABEL[l.authorization.service_type] ?? l.authorization.service_type}</p>
                              <p>Scheduled {l.units_scheduled} · Billed <b>{l.units_billed}</b> · Lost to late arrival {l.units_lost_late}</p>
                              <p className="text-muted-foreground">Cap {capText(l.authorization)} · {l.authorization.units_left} unit{Number(l.authorization.units_left) === 1 ? "" : "s"} left</p>
                              <p className="text-xs">{l.notes.map((n, i) => <span key={n.note_id}>{i ? " · " : ""}<Link to={`/progress-notes/${n.note_id}`} className="text-primary hover:underline">{fmtDay(n.service_date)}{n.arrived_late ? " (late)" : ""}</Link></span>)}</p>
                            </div>))}
                          <p className="mt-2 border-t pt-2 text-sm font-semibold">Total: {c.totals.s} scheduled · {c.totals.b} billed · {c.totals.l} lost</p>
                        </li>))}
                      <li className="rounded-md border-2 p-3 text-sm font-semibold" data-testid="week-total-card">Week total ({w.totals.notes} notes): {w.totals.units_scheduled} scheduled · {w.totals.units_billed} billed · {w.totals.units_lost_late} lost to late arrival</li>
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Not in this week's bill ({w.excluded.length})</CardTitle></CardHeader>
              <CardContent>
                {w.excluded.length === 0 ? <p className="text-sm text-muted-foreground">Every visit of this week is in the bill.</p> : (
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
              <DialogContent data-testid={confirm === "bill" ? "bill-confirm" : "approve-confirm"}>
                <DialogHeader>
                  <DialogTitle>{confirm === "bill" ? "Mark this week billed?" : "Approve this week?"}</DialogTitle>
                  <DialogDescription>{confirm === "bill" ? "Billing locks the week and its notes for good." : "Every note in the bill was reviewed one at a time. Approving freezes this week's bill: notes reviewed later stay out."}</DialogDescription>
                </DialogHeader>
                <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="confirm-totals">
                  <dt className="text-muted-foreground">Week</dt><dd>{weekLabel(w)}</dd>
                  <dt className="text-muted-foreground">Clients</dt><dd>{byClient(w.lines).length}</dd>
                  <dt className="text-muted-foreground">Notes</dt><dd>{w.totals.notes}</dd>
                  <dt className="text-muted-foreground">Units scheduled</dt><dd>{w.totals.units_scheduled}</dd>
                  <dt className="text-muted-foreground">Units billed</dt><dd className="font-semibold">{w.totals.units_billed}</dd>
                  <dt className="text-muted-foreground">Units lost to late arrival</dt><dd>{w.totals.units_lost_late}</dd>
                </dl>
                <DialogFooter>
                  <Button variant="outline" className={outline} onClick={() => setConfirm(null)}>Cancel</Button>
                  {confirm === "bill"
                    ? <Button disabled={busy} data-testid="confirm-bill" onClick={() => act("mark_batch_billed", { _batch_id: w.batch!.id }, "Week marked billed")}>Mark billed</Button>
                    : <Button disabled={busy} data-testid="confirm-approve" onClick={() => act("approve_batch_notes", { _batch_id: w.batch!.id, _note_ids: ids }, "Week approved")}>Approve week</Button>}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </ModuleShell>
  );
}
