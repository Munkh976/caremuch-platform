import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { useCaregiverClock, useNotesDue } from "@/components/caregivers/useCaregiverApp";
import { clientShort, fmtTime, SERVICE_LABEL, sortNotes, STATUS_LABEL, type NoteDueItem } from "@/lib/caregiverNotes";

function Row({ n, tz }: { n: NoteDueItem; tz: string }) {
  const tone = n.note_status === "returned" || n.overdue ? "destructive" : n.note_status === "draft" ? "secondary" : "outline";
  return (
    <li>
      <Link to={`/caregiver/notes/${n.shift_id}`} data-note-row={n.shift_id} data-status={n.note_status}
        className="flex min-h-[64px] items-center gap-3 rounded-lg border bg-card p-3 hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{clientShort(n.client_first_name, n.client_last_initial)} <span className="font-normal text-muted-foreground">· {SERVICE_LABEL[n.service_type] ?? n.service_type}</span></p>
          <p className="text-sm text-muted-foreground">{fmtTime(n.scheduled_start, tz, true)} – {fmtTime(n.scheduled_end, tz)}</p>
          {n.note_status === "returned" && n.returned_reason && <p className="mt-1 line-clamp-2 text-sm text-destructive">Returned: {n.returned_reason}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={tone}>{STATUS_LABEL[n.note_status]}</Badge>
          {n.overdue && <span className="text-xs font-semibold text-destructive">Overdue</span>}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** /caregiver/notes (S7): the caregiver's progress notes — due / drafts / returned first, then history. */
export default function CaregiverNotes() {
  useEffect(() => { document.title = "Progress notes · CareMuch"; }, []);
  const notes = useNotesDue();
  const clock = useCaregiverClock();
  const tz = clock.data?.timezone ?? "America/New_York";
  const { todo, history } = sortNotes(notes.data ?? []);

  return (
    <CaregiverAppShell>
      <div className="space-y-5" data-testid="caregiver-notes">
        <div><h1 className="text-2xl font-bold">Progress notes</h1><p className="text-sm text-muted-foreground">One note per visit. Due by the end of the next day.</p></div>
        {notes.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : notes.isError ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Your notes couldn't be loaded. Please reload.</CardContent></Card>
        ) : (
          <>
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">To do</h2>
              {todo.length === 0 ? <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">You're all caught up.</CardContent></Card>
                : <ul className="space-y-2" data-testid="notes-todo">{todo.map((n) => <Row key={n.shift_id} n={n} tz={tz} />)}</ul>}
            </section>
            {history.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">History</h2>
                <ul className="space-y-2" data-testid="notes-history">{history.map((n) => <Row key={n.shift_id} n={n} tz={tz} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </CaregiverAppShell>
  );
}
