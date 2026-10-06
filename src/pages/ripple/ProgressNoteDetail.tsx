import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, FileCheck2, Printer } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { NoteActions } from "@/components/compliance/notes/NoteActions";
import { useRefreshStaffNotes, useStaffNote } from "@/components/compliance/notes/useStaffNotes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clientShort, fmtDay, fmtTime, SERVICE_LABEL } from "@/lib/caregiverNotes";
import { answerText, byGoal, historyLabel, type StaffNote } from "@/lib/staffNotes";

const Field = ({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) => (
  <div data-testid={testid}><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="text-base">{children}</dd></div>
);
const STATUS: Record<StaffNote["note"]["status"], string> = { draft: "Draft", submitted: "Submitted", returned: "Returned", reviewed: "Reviewed", billed: "Billed" };

/** Header + units: shared by the detail page (and mirrored on the print). */
export function NoteHeaderFields({ d }: { d: StaffNote }) {
  const n = d.note, tz = d.office.timezone;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="note-header">
      <Field label="Client">{clientShort(d.client.first_name, d.client.last_initial)}</Field>
      <Field label="Service">{SERVICE_LABEL[n.note_kind] ?? n.note_kind}{d.group_session ? " · group session" : ""}</Field>
      <Field label="Visit">{fmtDay(n.service_date)}, {fmtTime(n.scheduled_start, tz)} – {fmtTime(n.scheduled_end, tz)}</Field>
      <Field label="Caregiver">{d.caregiver_name}</Field>
      <Field label="Arrival" testid="arrival">{n.client_arrived_at ? fmtTime(n.client_arrived_at, tz) : "—"}{n.arrived_late && <Badge variant="outline" className="ml-2">Late arrival</Badge>}</Field>
      <Field label="End time">{n.actual_end ? fmtTime(n.actual_end, tz) : "—"}</Field>
      <Field label="Location">{n.location ?? "—"}</Field>
      <Field label="Staff : client ratio" testid="ratio">{n.staff_client_ratio ?? d.group_session?.staff_client_ratio ?? "—"}{d.group_session?.staff_client_ratio ? <span className="text-sm text-muted-foreground"> (group {d.group_session.staff_client_ratio})</span> : null}</Field>
      <Field label="Case number">{d.client.case_number ?? "—"}</Field>
    </dl>
  );
}

/** /progress-notes/:noteId (S8): one note, read only for staff (Q10), with the review actions. */
export default function ProgressNoteDetail() {
  const { noteId = "" } = useParams();
  const q = useStaffNote(noteId);
  const refresh = useRefreshStaffNotes();
  useEffect(() => { document.title = "Progress note · CareMuch"; }, []);
  const d = q.data;

  return (
    <ModuleShell title="Progress note" description="Read only: reviewers mark a note reviewed or return it with a reason." icon={FileCheck2} slice="S8">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <Link to="/progress-notes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Notes to review</Link>
        {q.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError || !d ? (
          <Card data-testid="note-denied"><CardContent className="py-10 text-center text-sm text-muted-foreground">You can't open this note here, or it wasn't found.</CardContent></Card>
        ) : (
          <>
            <Card data-testid="staff-note" data-status={d.note.status} data-note-kind={d.note.note_kind}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div><CardTitle className="text-lg">{d.note.note_kind === "respite" ? "Respite progress note" : "CLS progress note"}</CardTitle>
                  <p className="text-sm text-muted-foreground">{d.office.name}</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={d.note.status === "returned" ? "destructive" : d.note.status === "submitted" ? "default" : "secondary"} data-testid="detail-status">{STATUS[d.note.status]}</Badge>
                  {d.note.overdue && <Badge variant="destructive">Overdue</Badge>}
                  {d.note.late_submitted && <Badge variant="outline">Submitted late</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <NoteHeaderFields d={d} />
                <div className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-3" data-testid="note-units">
                  <Field label="Units scheduled">{d.note.units_scheduled ?? "—"}</Field>
                  <Field label="Units to bill">{d.note.units_to_bill}{d.note.arrived_late ? <span className="text-sm text-muted-foreground"> (first unit lost: late arrival)</span> : null}</Field>
                  <Field label={d.authorization?.preview ? "Authorization (FIFO, at review)" : "Authorization"} testid="note-auth">
                    {d.authorization ? d.authorization.auth_number : d.note.billable === false ? `Not billable: ${d.note.non_billable_reason ?? ""}` : d.note.status === "submitted" ? "No authorization fits yet" : "—"}</Field>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <NoteActions noteId={d.note.id} status={d.note.status} onDone={refresh} />
                  <Button asChild variant="outline" className="gap-1 hover:bg-muted hover:text-foreground"><Link to={`/progress-notes/${d.note.id}/print`} data-testid="print-link"><Printer className="h-4 w-4" />Print</Link></Button>
                </div>
              </CardContent>
            </Card>

            {d.note.status === "returned" && (
              <Alert variant="destructive" data-testid="detail-returned"><AlertTriangle className="h-4 w-4" /><AlertTitle>Returned to the caregiver</AlertTitle><AlertDescription>{d.note.returned_reason}</AlertDescription></Alert>
            )}

            {d.note.note_kind === "respite" ? (
              <Card><CardHeader className="pb-2"><CardTitle className="text-base">Session narrative</CardTitle></CardHeader>
                <CardContent><p className="whitespace-pre-wrap text-base" data-testid="narrative">{d.note.narrative_text || "—"}</p></CardContent></Card>
            ) : byGoal(d.entries).map((g, gi) => (
              <section key={g.seq} className="space-y-3" data-goal={gi + 1}>
                <h2 className="text-base font-bold">Goal {gi + 1}: {g.goal}</h2>
                {g.items.map((e) => (
                  <Card key={e.entry_id} data-entry={e.entry_id}><CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2"><p className="font-semibold">{e.objective_letter ? `${e.objective_letter}. ` : ""}{e.objective_text}</p><Badge variant="outline">{(e.service_type ?? "cls").toUpperCase()}</Badge></div>
                    {e.staff_instructions && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instructions for Staff</p><p className="whitespace-pre-wrap text-sm">{e.staff_instructions}</p></div>}
                    <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p><p className="whitespace-pre-wrap text-base">{e.notes_text || "—"}</p></div>
                    {e.measures.length > 0 && (
                      <div className="border-t pt-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data{e.questions_as_asked ? "" : " (current questions: not submitted yet)"}</p>
                        <dl className="divide-y">{e.measures.map((m) => m.kind === "staff_note"
                          ? <p key={m.measure_id} className="py-1.5 text-sm italic text-muted-foreground">{m.prompt_text}</p>
                          : <div key={m.measure_id} className="grid grid-cols-1 gap-1 py-1.5 sm:grid-cols-2" data-measure-kind={m.kind}><dt className="text-sm">{m.prompt_text}</dt><dd className="text-sm font-medium">{answerText(m, e.answers?.[m.measure_id])}</dd></div>)}</dl>
                      </div>
                    )}
                  </CardContent></Card>
                ))}
              </section>
            ))}

            <Card><CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              <Field label="Caregiver signature" testid="signature">{d.note.staff_signature_name ? `${d.note.staff_signature_name} · ${fmtTime(d.note.staff_signed_at as string, d.office.timezone, true)}` : "Not signed yet"}</Field>
              <Field label="Reviewed">{d.note.reviewed_at ? `${d.note.reviewed_by_name ?? ""} · ${fmtTime(d.note.reviewed_at, d.office.timezone, true)}` : "—"}</Field>
            </CardContent></Card>

            <Card><CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
              <CardContent><ol className="space-y-1.5" data-testid="note-history">
                {d.history.map((h, i) => (
                  <li key={i} className="text-sm" data-event={h.event}>
                    <span className="font-medium">{historyLabel(h)}</span> · {fmtTime(h.at, d.office.timezone, true)}{h.by ? ` · ${h.by}` : ""}
                    {h.reason && <span className="block text-muted-foreground">Reason: {h.reason}</span>}
                  </li>))}
              </ol></CardContent></Card>
          </>
        )}
      </div>
    </ModuleShell>
  );
}
