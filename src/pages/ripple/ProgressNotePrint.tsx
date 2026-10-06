import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useStaffNote } from "@/components/compliance/notes/useStaffNotes";
import { Button } from "@/components/ui/button";
import { clientShort, fmtDay, fmtTime, SERVICE_LABEL } from "@/lib/caregiverNotes";
import { answerText, byGoal, type StaffNote } from "@/lib/staffNotes";

/** A blank line to write on (wet signature, review, dates). */
const Line = ({ w = "w-full", label }: { w?: string; label?: string }) => (
  <span className={`inline-flex flex-col ${w}`}><span className="block h-7 border-b border-black" />{label && <span className="text-[10px] uppercase tracking-wide">{label}</span>}</span>
);
const Cell = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="border border-black p-1.5"><div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div><div className="min-h-[1.25rem] text-sm">{children}</div></div>
);
// US Letter, no app chrome, no toasts; objectives avoid breaking across pages.
const PRINT_CSS = `@page { size: letter; margin: 0.5in; }
@media print { body { background: white; } [data-sonner-toaster], [role="region"][aria-label^="Notifications"] { display: none !important; }
  [data-objective] { break-inside: avoid; page-break-inside: avoid; } [data-section="signatures"], [data-section="billing"] { break-inside: avoid; page-break-inside: avoid; } }`;

function NoteSheet({ d }: { d: StaffNote }) {
  const n = d.note, tz = d.office.timezone;
  const kind = n.note_kind === "respite" ? "Respite" : "CLS";
  return (
    <article className="space-y-4 text-black" data-print="note" data-note-kind={n.note_kind}>
      <header className="text-center">
        <h1 className="text-lg font-bold uppercase">{kind} Progress Note</h1>
        <p className="text-xs">{d.office.name}{n.template_name ? ` · ${n.template_name} v${n.template_version ?? ""}` : ""}</p>
      </header>
      <section className="grid grid-cols-2 sm:grid-cols-3" data-section="header">
        <Cell label="Client">{clientShort(d.client.first_name, d.client.last_initial)}</Cell>
        <Cell label="Date of service">{fmtDay(n.service_date)}</Cell>
        <Cell label="Scheduled">{fmtTime(n.scheduled_start, tz)} – {fmtTime(n.scheduled_end, tz)}</Cell>
        <Cell label="Client arrival">{n.client_arrived_at ? fmtTime(n.client_arrived_at, tz) : ""}{n.arrived_late ? " (late)" : ""}</Cell>
        <Cell label="End time">{n.actual_end ? fmtTime(n.actual_end, tz) : ""}</Cell>
        <Cell label="Location">{n.location ?? ""}</Cell>
        <Cell label="Staff : client ratio">{n.staff_client_ratio ?? d.group_session?.staff_client_ratio ?? ""}{d.group_session ? " (group session)" : ""}</Cell>
        <Cell label="Staff">{d.caregiver_name}</Cell>
        <Cell label="Note completed on">{n.staff_signed_at ? fmtTime(n.staff_signed_at, tz, true) : ""}</Cell>
      </section>

      {n.note_kind === "respite" ? (
        <section data-section="narrative" className="border border-black p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide">Session narrative</div>
          <p className="whitespace-pre-wrap text-sm">{n.narrative_text ?? ""}</p>
        </section>
      ) : (
        <section data-section="objectives" className="space-y-3">
          {byGoal(d.entries).map((g, gi) => (
            <div key={g.seq} className="space-y-2">
              <p className="text-sm font-bold">Goal {gi + 1}: {g.goal}</p>
              {g.items.map((e) => (
                <div key={e.entry_id} className="border border-black p-2" data-objective>
                  <p className="text-sm font-semibold">{e.objective_letter ? `${e.objective_letter}. ` : ""}{e.objective_text} <span className="text-[10px] font-normal uppercase">[{(e.service_type ?? "cls").toUpperCase()}]</span></p>
                  {e.staff_instructions && <p className="mt-1 text-xs"><span className="font-semibold uppercase">Instructions for Staff: </span><span className="whitespace-pre-wrap">{e.staff_instructions}</span></p>}
                  <p className="mt-1 text-sm"><span className="text-[10px] font-semibold uppercase">Notes (include reinforcers): </span><span className="whitespace-pre-wrap">{e.notes_text ?? ""}</span></p>
                  {e.measures.length > 0 && (
                    <table className="mt-1 w-full border-collapse text-xs"><tbody>
                      {e.measures.map((m) => m.kind === "staff_note"
                        ? <tr key={m.measure_id}><td colSpan={2} className="border border-black p-1 italic">{m.prompt_text}</td></tr>
                        : <tr key={m.measure_id}><td className="w-1/2 border border-black p-1">{m.prompt_text}</td><td className="border border-black p-1">{answerText(m, e.answers?.[m.measure_id])}</td></tr>)}
                    </tbody></table>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-3" data-section="billing">
        <div className="col-span-2 border border-black bg-gray-100 p-1 text-[10px] font-bold uppercase tracking-wide sm:col-span-3 print:bg-transparent">For billing only</div>
        <Cell label="Case number">{d.client.case_number ?? ""}</Cell>
        <Cell label="Units scheduled">{n.units_scheduled ?? ""}</Cell>
        <Cell label="Units billed">{n.units_to_bill}</Cell>
        <Cell label="Late arrival">{n.arrived_late ? "Yes (first unit not billed)" : "No"}</Cell>
        <Cell label="Authorization #">{d.authorization && !d.authorization.preview ? d.authorization.auth_number : ""}</Cell>
        <Cell label="Biller">{n.biller_name ?? ""}</Cell>
      </section>

      <section className="space-y-4 pt-2" data-section="signatures">
        <p className="text-sm">Signed electronically by <span className="font-semibold">{n.staff_signature_name ?? "—"}</span>{n.staff_signed_at ? ` on ${fmtTime(n.staff_signed_at, tz, true)} (server time)` : ""}.</p>
        <div className="grid grid-cols-3 gap-6"><span className="col-span-2"><Line label="Staff signature" /></span><Line label="Date" /></div>
        <div className="grid grid-cols-3 gap-6"><span className="col-span-2"><Line label={`Program lead review${n.reviewed_by_name ? ` (reviewed in CareMuch by ${n.reviewed_by_name}${n.reviewed_at ? `, ${fmtTime(n.reviewed_at, tz, true)}` : ""})` : ""}`} /></span><Line label="Date" /></div>
      </section>
      <p className="text-[10px]">{SERVICE_LABEL[n.note_kind] ?? n.note_kind} note · printed from CareMuch</p>
    </article>
  );
}

/** /progress-notes/:noteId/print (S8): Ripple's paper layout; no app chrome; manager / agency_admin. */
export default function ProgressNotePrint() {
  const { noteId = "" } = useParams();
  const q = useStaffNote(noteId);
  useEffect(() => { document.title = "Progress note (print) · CareMuch"; }, []);
  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-4 text-black print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden" data-testid="print-toolbar">
        <Link to={`/progress-notes/${noteId}`} className="text-sm text-muted-foreground hover:text-foreground">Back to the note</Link>
        <Button onClick={() => window.print()} disabled={!q.data}>Print</Button>
      </div>
      {q.isPending ? <p className="text-sm">Loading…</p> : q.isError || !q.data
        ? <p className="text-sm" data-testid="print-denied">You can't open this note here, or it wasn't found.</p>
        : <NoteSheet d={q.data} />}
    </div>
  );
}
