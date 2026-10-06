import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileCheck2 } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { FilterChip } from "@/components/compliance/FilterChip";
import { NotesQueueList } from "@/components/compliance/notes/NotesQueueList";
import { useNotesQueue } from "@/components/compliance/notes/useStaffNotes";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { clientShort, fmtDay } from "@/lib/caregiverNotes";
import { inWeek, matchesStatus, sortQueue, STATUS_FILTERS, weekOf, type StatusFilter } from "@/lib/staffNotes";

const ALL = "all";

/**
 * /progress-notes (S8): the office's notes to review. Default Submitted; Returned, Reviewed, Overdue
 * (not submitted by the end of the day after the visit, DB clock, office zone). Filters by client,
 * caregiver and week (the office's billing week). Oldest first. Only filter names in the URL.
 */
export default function ProgressNotes() {
  useEffect(() => { document.title = "Notes to review · CareMuch"; }, []);
  const { moduleOffices } = useComplianceOffices();
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<string | null>(null);
  const officeId = picked ?? moduleOffices[0]?.id ?? null;
  const status = (STATUS_FILTERS.some(([v]) => v === params.get("status")) ? params.get("status") : "submitted") as StatusFilter;
  const [client, setClient] = useState(ALL), [caregiver, setCaregiver] = useState(ALL), [week, setWeek] = useState(ALL);
  const q = useNotesQueue(officeId);
  const data = q.data;
  const opts = useMemo(() => {
    const rows = data?.rows ?? [];
    const clients = new Map(rows.map((r) => [r.client_id, clientShort(r.client_first_name, r.client_last_initial)]));
    const cgs = new Map(rows.map((r) => [r.caregiver_id, r.caregiver_name ?? "Caregiver"]));
    const weeks = new Map(rows.map((r) => { const w = weekOf(r.service_date, data!.billing_week_start); return [w.start, w]; }));
    return { clients: [...clients].sort((a, b) => a[1].localeCompare(b[1])), cgs: [...cgs].sort((a, b) => a[1].localeCompare(b[1])), weeks: [...weeks.values()].sort((a, b) => b.start.localeCompare(a.start)) };
  }, [data]);
  const weekSel = week === ALL ? null : opts.weeks.find((w) => w.start === week) ?? null;
  const rows = sortQueue((data?.rows ?? []).filter((r) => matchesStatus(r, status) && (client === ALL || r.client_id === client)
    && (caregiver === ALL || r.caregiver_id === caregiver) && inWeek(r.service_date, weekSel)));
  const count = (f: StatusFilter) => (data?.rows ?? []).filter((r) => matchesStatus(r, f)).length;

  return (
    <ModuleShell title="Notes to Review" description="Caregiver progress notes for this office: review each note, or return it with a reason." icon={FileCheck2} slice="S8">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <OfficePicker offices={moduleOffices} value={officeId} onChange={setPicked} />
        <ToggleGroup type="single" value={status} onValueChange={(v) => v && setParams({ status: v }, { replace: true })} className="flex-wrap justify-start" aria-label="Note status">
          {STATUS_FILTERS.map(([v, l]) => <FilterChip key={v} value={v} data-filter={v}>{l}{v !== "all" && data ? ` (${count(v)})` : ""}</FilterChip>)}
        </ToggleGroup>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select value={client} onValueChange={setClient}><SelectTrigger aria-label="Client"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All clients</SelectItem>{opts.clients.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}</SelectContent></Select>
          <Select value={caregiver} onValueChange={setCaregiver}><SelectTrigger aria-label="Caregiver"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All caregivers</SelectItem>{opts.cgs.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}</SelectContent></Select>
          <Select value={week} onValueChange={setWeek}><SelectTrigger aria-label="Week"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All weeks</SelectItem>{opts.weeks.map((w) => <SelectItem key={w.start} value={w.start}>{fmtDay(w.start)} – {fmtDay(w.end)}</SelectItem>)}</SelectContent></Select>
        </div>
        {q.isPending && officeId ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError ? (
          <p className="rounded-md border py-8 text-center text-sm text-muted-foreground" data-testid="queue-denied">You can't open this office's notes, or none were found.</p>
        ) : data ? <NotesQueueList rows={rows} tz={data.timezone} /> : null}
      </div>
    </ModuleShell>
  );
}
