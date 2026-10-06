import { useState } from "react";
import { FilterChip } from "@/components/compliance/FilterChip";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { matchesStatus, sortQueue, STATUS_FILTERS, type StatusFilter } from "@/lib/staffNotes";
import { NoteActions } from "./NoteActions";
import { NotesQueueList } from "./NotesQueueList";
import { useNotesQueue, useRefreshStaffNotes } from "./useStaffNotes";

/** Client care plan → Progress Notes tab (S8): this client's notes with status, open / print, and the same actions. */
export function ClientNotesTab({ clientId, officeId }: { clientId: string; officeId: string | null }) {
  const q = useNotesQueue(officeId);
  const refresh = useRefreshStaffNotes();
  const [status, setStatus] = useState<StatusFilter>("all");
  const mine = (q.data?.rows ?? []).filter((r) => r.client_id === clientId);
  const rows = sortQueue(mine.filter((r) => matchesStatus(r, status)));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="client-notes-tab">
      <ToggleGroup type="single" value={status} onValueChange={(v) => v && setStatus(v as StatusFilter)} className="flex-wrap justify-start" aria-label="Note status">
        {STATUS_FILTERS.map(([v, l]) => <FilterChip key={v} value={v} data-filter={v}>{l}{v !== "all" ? ` (${mine.filter((r) => matchesStatus(r, v)).length})` : ""}</FilterChip>)}
      </ToggleGroup>
      {q.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError ? <p className="text-sm text-muted-foreground">Notes couldn't be loaded.</p>
        : <NotesQueueList rows={rows} tz={q.data.timezone} showClient={false}
            actions={(r) => r.note_id && (r.status === "submitted" || r.status === "billed") ? <NoteActions noteId={r.note_id} status={r.status} compact onDone={refresh} /> : null} />}
    </div>
  );
}
