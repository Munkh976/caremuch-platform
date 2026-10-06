import { Link } from "react-router-dom";
import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clientShort, fmtDay, fmtTime, SERVICE_LABEL } from "@/lib/caregiverNotes";
import { QUEUE_STATUS_LABEL, type QueueRow } from "@/lib/staffNotes";

const StatusBadge = ({ r }: { r: QueueRow }) => (
  <span className="flex flex-wrap items-center gap-1">
    <Badge variant={r.status === "returned" ? "destructive" : r.status === "submitted" ? "default" : "secondary"}>{QUEUE_STATUS_LABEL[r.status]}</Badge>
    {r.overdue && <Badge variant="destructive">Overdue</Badge>}
  </span>
);
const Units = ({ r }: { r: QueueRow }) => r.units_scheduled === null ? <span className="text-muted-foreground">—</span>
  : <span className="tabular-nums">{r.units_scheduled} → {r.units_to_bill}</span>;

/**
 * Review queue rows (S8): table at md and up, cards below. Ids only in links. A visit with no note yet
 * (overdue, not started) has nothing to open.
 */
export function NotesQueueList({ rows, tz, showClient = true, actions }: { rows: QueueRow[]; tz: string; showClient?: boolean; actions?: (r: QueueRow) => React.ReactNode }) {
  if (!rows.length) return <p className="rounded-md border py-8 text-center text-sm text-muted-foreground" data-testid="queue-empty">No notes match.</p>;
  const who = (r: QueueRow) => clientShort(r.client_first_name, r.client_last_initial);
  const open = (r: QueueRow, label: React.ReactNode) => r.note_id ? <Link to={`/progress-notes/${r.note_id}`} className="font-medium hover:underline">{label}</Link> : <span className="font-medium">{label}</span>;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border md:block" data-testid="notes-queue">
        <Table>
          <TableHeader><TableRow>
            {showClient && <TableHead>Client</TableHead>}<TableHead>Service</TableHead><TableHead>Visit</TableHead><TableHead>Caregiver</TableHead>
            <TableHead>Late</TableHead><TableHead>Units (sched. → to bill)</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Open</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.shift_id} data-queue-row={r.note_id ?? `shift:${r.shift_id}`} data-status={r.status}>
                {showClient && <TableCell>{open(r, who(r))}</TableCell>}
                <TableCell>{SERVICE_LABEL[r.service_type] ?? r.service_type}{r.group_session ? <span className="text-muted-foreground"> · group</span> : null}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDay(r.service_date)}, {fmtTime(r.scheduled_start, tz)} – {fmtTime(r.scheduled_end, tz)}</TableCell>
                <TableCell>{r.caregiver_name}</TableCell>
                <TableCell>{r.arrived_late ? <Badge variant="outline">Late</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><Units r={r} /></TableCell>
                <TableCell><StatusBadge r={r} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {actions?.(r)}
                    {r.note_id ? <><Link to={`/progress-notes/${r.note_id}`} className="text-sm font-medium text-primary hover:underline">Open</Link>
                      <Link to={`/progress-notes/${r.note_id}/print`} aria-label="Print note" className="text-muted-foreground hover:text-foreground"><Printer className="h-4 w-4" /></Link></>
                      : <span className="text-xs text-muted-foreground">No note yet</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden" data-testid="notes-queue-cards">
        {rows.map((r) => (
          <li key={r.shift_id} className="rounded-md border bg-card p-3" data-queue-row={r.note_id ?? `shift:${r.shift_id}`} data-status={r.status}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p>{showClient ? open(r, who(r)) : null}{showClient ? <span className="text-muted-foreground"> · </span> : null}{SERVICE_LABEL[r.service_type] ?? r.service_type}{r.group_session ? " · group" : ""}</p>
                <p className="text-sm text-muted-foreground">{fmtDay(r.service_date)}, {fmtTime(r.scheduled_start, tz)} – {fmtTime(r.scheduled_end, tz)}</p>
                <p className="text-sm">{r.caregiver_name}{r.arrived_late ? " · late arrival" : ""}</p>
                <p className="text-sm text-muted-foreground">Units <Units r={r} /></p>
              </div>
              <StatusBadge r={r} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {actions?.(r)}
              {r.note_id ? <><Link to={`/progress-notes/${r.note_id}`} className="text-sm font-medium text-primary hover:underline">Open</Link>
                <Link to={`/progress-notes/${r.note_id}/print`} className="text-sm text-muted-foreground hover:text-foreground">Print</Link></> : <span className="text-xs text-muted-foreground">No note yet</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
