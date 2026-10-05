import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff, ChevronRight, ClipboardList, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { useCaregiverClock, useCaregiverRecord, useNotesDue, useSessionUserId } from "@/components/caregivers/useCaregiverApp";
import { fetchCaregiverOpenShiftIds, fetchCaregiverShiftsEligibility, fetchCaregiverTradeShifts } from "@/lib/caregiverBoard";
import { fetchCaregiverVisibleClients } from "@/lib/caregiverVisibleClients";
import { clientShort, isOpen, STATUS_LABEL, zonedToIso, type CaregiverClock } from "@/lib/caregiverNotes";

interface WeekShift { assignment_id: string; shift_id: string; shift_date: string; start_time: string; end_time: string; duration_hours: number; care_type_code: string; client_id: string }

const greeting = (iso: string, tz: string) => {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(iso)));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); const p = h >= 12 ? "PM" : "AM"; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${p}`; };

/** This week's assigned shifts (narrow columns; existing caregiver RLS on shift_assignments / shifts). */
function useWeekShifts(caregiverId: string | undefined, clock: CaregiverClock | undefined) {
  return useQuery({
    queryKey: ["caregiver-week", caregiverId, clock?.week_start],
    enabled: !!caregiverId && !!clock,
    queryFn: async (): Promise<WeekShift[]> => {
      const { data, error } = await supabase.from("shift_assignments")
        .select("id, status, shifts!inner(id, shift_date, start_time, end_time, duration_hours, care_type_code, client_id)")
        .eq("caregiver_id", caregiverId as string).neq("status", "cancelled")
        .gte("shifts.shift_date", clock!.week_start).lte("shifts.shift_date", clock!.week_end);
      if (error) throw error;
      return (data ?? []).map((a) => { const s = a.shifts as unknown as Omit<WeekShift, "assignment_id" | "shift_id"> & { id: string };
        return { assignment_id: a.id, shift_id: s.id, shift_date: s.shift_date, start_time: s.start_time, end_time: s.end_time, duration_hours: Number(s.duration_hours) || 0, care_type_code: s.care_type_code, client_id: s.client_id }; });
    },
  });
}

/**
 * Shifts the caregiver can pick up right now: open shifts in their office from the DB's today plus
 * colleagues' trade shifts, counted ONLY when the caregiver-safe eligibility says bookable (so a
 * not_bookable shift under compliance enforcement is never advertised; unknown counts as not bookable).
 * Same server calls as Available Shifts.
 */
function useBookableCount(today: string | undefined) {
  return useQuery({
    queryKey: ["caregiver-bookable", today],
    enabled: !!today,
    queryFn: async (): Promise<number> => {
      const [open, trades] = await Promise.all([fetchCaregiverOpenShiftIds(today as string), fetchCaregiverTradeShifts()]);
      const ids = [...new Set([...open, ...trades.map((t) => t.shift_id)])];
      const elig = await fetchCaregiverShiftsEligibility(ids);
      return ids.filter((id) => elig.get(id)?.eligible === true).length;
    },
  });
}

export default function CaregiverToday() {
  useEffect(() => { document.title = "Today · CareMuch"; }, []);
  const userId = useSessionUserId();
  const record = useCaregiverRecord(userId);
  const clock = useCaregiverClock();
  const week = useWeekShifts(record.data?.id, clock.data);
  const clients = useQuery({ queryKey: ["caregiver-visible-clients"], queryFn: fetchCaregiverVisibleClients });
  const notes = useNotesDue();
  const bookable = useBookableCount(clock.data?.today);
  const c = clock.data;

  if (clock.isPending || week.isPending) {
    return <CaregiverAppShell><div className="flex h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div></CaregiverAppShell>;
  }
  if (!c) return <CaregiverAppShell><p className="pt-10 text-center text-sm text-muted-foreground">Your day couldn't be loaded. Please reload.</p></CaregiverAppShell>;

  const today = (week.data ?? []).filter((s) => s.shift_date === c.today).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const hoursToday = today.reduce((n, s) => n + s.duration_hours, 0);
  const hoursWeek = (week.data ?? []).reduce((n, s) => n + s.duration_hours, 0);
  const noteFor = new Map((notes.data ?? []).map((n) => [n.shift_id, n]));
  const open = (notes.data ?? []).filter((n) => isOpen(n.note_status));
  const overdue = open.filter((n) => n.overdue).length, returned = open.filter((n) => n.note_status === "returned").length;
  const status = (s: WeekShift) => {
    const start = Date.parse(zonedToIso(s.shift_date, s.start_time.slice(0, 5), c.timezone));
    let end = Date.parse(zonedToIso(s.shift_date, s.end_time.slice(0, 5), c.timezone)); if (end <= start) end += 864e5;
    const now = Date.parse(c.now);
    return now < start ? "upcoming" : now <= end ? "live" : "done";
  };

  return (
    <CaregiverAppShell>
      <div className="space-y-5" data-testid="caregiver-today">
        <div>
          <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("en-US", { timeZone: c.timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date(c.now))}</p>
          <h1 className="text-2xl font-bold">{greeting(c.now, c.timezone)}{c.first_name ? `, ${c.first_name}` : ""}</h1>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card className="border-primary/10 bg-primary/5"><CardContent className="p-4"><p className="text-2xl font-bold tabular-nums">{hoursToday}h</p><p className="mt-1 text-xs font-semibold uppercase text-muted-foreground">Today</p></CardContent></Card>
          <Card className="border-primary/10 bg-primary/5"><CardContent className="p-4"><p className="text-2xl font-bold tabular-nums">{hoursWeek}h</p><p className="mt-1 text-xs font-semibold uppercase text-muted-foreground">This week</p></CardContent></Card>
        </div>

        {(notes.data?.length ?? 0) > 0 || notes.isError ? (
          <Link to="/caregiver/notes" className="block" data-testid="notes-due-card">
            <Card className={overdue || returned ? "border-destructive/40" : undefined}>
              <CardContent className="flex min-h-[64px] items-center gap-3 p-4">
                <ClipboardList className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Notes due</p>
                  <p className="text-sm text-muted-foreground" data-testid="notes-due-summary">
                    {notes.isError ? "Couldn't load your notes" : open.length === 0 ? "All caught up" : `${open.length} to write${returned ? ` · ${returned} returned` : ""}${overdue ? ` · ${overdue} overdue` : ""}`}
                  </p>
                </div>
                <span className="text-2xl font-bold tabular-nums" data-testid="notes-due-count">{open.length}</span>
                <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </CardContent>
            </Card>
          </Link>
        ) : null}

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Today's shifts</h2>
          {today.length === 0 ? (
            <Card><CardContent className="p-8 text-center"><CalendarOff className="mx-auto mb-2 h-10 w-10 text-muted-foreground" /><p className="font-medium">No shifts today</p></CardContent></Card>
          ) : (
            <ul className="space-y-3" data-testid="today-shifts">
              {today.map((s) => {
                const st = status(s); const n = noteFor.get(s.shift_id); const cl = clients.data?.get(s.client_id);
                return (
                  <li key={s.assignment_id}>
                    <Card data-shift={s.shift_id}><CardContent className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary">{st === "live" ? "In progress" : st === "done" ? "Completed" : "Upcoming"}</Badge>
                        <span className="text-xs font-medium text-muted-foreground">{s.care_type_code}</span>
                      </div>
                      <p className="text-lg font-bold tabular-nums">{hm(s.start_time)} – {hm(s.end_time)}</p>
                      <p className="font-medium">{cl ? clientShort(cl.first_name, cl.last_name?.slice(0, 1) ?? null) : "Client"}{cl?.city ? <span className="font-normal text-muted-foreground"> · {cl.city}</span> : null}</p>
                      {n && (
                        <Button asChild className={isOpen(n.note_status) ? "min-h-11 w-full gap-2" : "min-h-11 w-full gap-2 hover:bg-muted hover:text-foreground"} variant={isOpen(n.note_status) ? "default" : "outline"}>
                          <Link to={`/caregiver/notes/${s.shift_id}`}><FileText className="h-4 w-4" />{isOpen(n.note_status) ? (n.note_status === "not_started" ? "Write progress note" : `Progress note · ${STATUS_LABEL[n.note_status]}`) : "View progress note"}</Link>
                        </Button>
                      )}
                    </CardContent></Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Link to="/available-shifts" className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-xl bg-primary px-4 py-3.5 font-semibold text-primary-foreground" data-testid="available-count">
          <span className="flex items-center gap-2"><Clock className="h-4 w-4" />
            {bookable.data ? `${bookable.data} shift${bookable.data === 1 ? "" : "s"} you can pick up` : "Browse available shifts"}</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </CaregiverAppShell>
  );
}
