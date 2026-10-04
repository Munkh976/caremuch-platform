import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { ShiftDetailsDialog } from "@/components/schedule/ShiftDetailsDialog";
import { Clock, MapPin, ChevronRight, CalendarOff } from "lucide-react";
import { toast } from "sonner";
import { isSameDay, isWithinInterval, startOfWeek, endOfWeek } from "date-fns";
import { parseShiftDate } from "@/lib/shiftDate";
import { fetchOneCaregiverPerformance, type CaregiverPerformance } from "@/lib/caregiverPerformance";
import { fetchCaregiverVisibleClients, type CaregiverVisibleClient } from "@/lib/caregiverVisibleClients";
import { fetchCaregiverOpenShifts, fetchCaregiverTradeShifts } from "@/lib/caregiverBoard";

interface TodayShift {
  assignmentId: string;
  status: string;
  shiftId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  careTypeCode: string;
  client: CaregiverVisibleClient | null;
}

interface CaregiverProfile {
  id: string;
  first_name: string;
  custom_min_hours: number | null;
}

const getCareTypeLabel = (code: string) =>
  (code || "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const timeOfDayGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

// Same "in progress / upcoming / completed" state a future check-in feature would drive --
// see docs/caregiver-app-design.md §3.8. Computed from real shift start/end, parsed as
// LOCAL time (parseShiftDate), never `new Date(shift.shift_date)` -- see
// docs/known-issues.md's date-parsing entry.
const computeLiveStatus = (shiftDate: string, startTime: string, endTime: string) => {
  const day = parseShiftDate(shiftDate);
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);
  const start = new Date(day);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(day);
  end.setHours(endH, endM, 0, 0);
  const now = new Date();
  if (now >= start && now <= end) return "live" as const;
  if (now > end) return "done" as const;
  return "upcoming" as const;
};

const CaregiverToday = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CaregiverProfile | null>(null);
  const [performance, setPerformance] = useState<CaregiverPerformance | null>(null);
  const [todayShifts, setTodayShifts] = useState<TodayShift[]>([]);
  const [hoursThisWeek, setHoursThisWeek] = useState(0);
  const [availableCount, setAvailableCount] = useState(0);
  const [selectedShift, setSelectedShift] = useState<any>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: caregiverData, error: caregiverError } = await supabase
        .from("caregivers")
        .select("id, first_name, custom_min_hours")
        .eq("user_id", user.id)
        .maybeSingle();
      if (caregiverError) throw caregiverError;
      if (!caregiverData) {
        toast.error("Caregiver profile not found");
        setLoading(false);
        return;
      }
      setProfile(caregiverData);

      const [perf, visibleClients, openShifts, tradeShifts, assignmentsRes] = await Promise.all([
        fetchOneCaregiverPerformance(caregiverData.id),
        fetchCaregiverVisibleClients(),
        fetchCaregiverOpenShifts(),
        fetchCaregiverTradeShifts(),
        // Exclude cancelled assignments (e.g. released back to the pool by approved time
        // off, per release_shift_assignments()) -- a cancelled assignment is no longer
        // "my" shift, so it must not show on Today. See docs/known-issues.md.
        supabase
          .from("shift_assignments")
          .select("id, status, shifts (id, shift_date, start_time, end_time, duration_hours, care_type_code, client_id)")
          .eq("caregiver_id", caregiverData.id)
          .neq("status", "cancelled"),
      ]);

      setPerformance(perf);
      // Same functions the Shifts tab calls -- this count can never drift from what that
      // tab actually shows (see docs/caregiver-app-design.md).
      setAvailableCount(openShifts.length + tradeShifts.length);

      if (assignmentsRes.error) throw assignmentsRes.error;
      const assignments = (assignmentsRes.data || []).filter((a: any) => a.shifts);

      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(now, { weekStartsOn: 0 });

      const today: TodayShift[] = [];
      let weekHours = 0;

      for (const a of assignments as any[]) {
        const s = a.shifts;
        const shiftDay = parseShiftDate(s.shift_date);

        if (isWithinInterval(shiftDay, { start: weekStart, end: weekEnd })) {
          weekHours += s.duration_hours || 0;
        }

        if (isSameDay(shiftDay, now)) {
          today.push({
            assignmentId: a.id,
            status: computeLiveStatus(s.shift_date, s.start_time, s.end_time),
            shiftId: s.id,
            shiftDate: s.shift_date,
            startTime: s.start_time,
            endTime: s.end_time,
            durationHours: s.duration_hours,
            careTypeCode: s.care_type_code,
            client: visibleClients.get(s.client_id) || null,
          });
        }
      }

      today.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setTodayShifts(today);
      setHoursThisWeek(weekHours);
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to load your dashboard");
    } finally {
      setLoading(false);
    }
  };

  const hoursToday = todayShifts.reduce((sum, s) => sum + (s.durationHours || 0), 0);
  // custom_min_hours is a REAL per-caregiver override (public.caregivers.custom_min_hours).
  // A caregiver can't read the agency-wide full/part-time defaults (public.profiles is
  // RLS-locked to "auth.uid() = id"), so when no override is set we show hours alone
  // rather than a fabricated target -- see docs/caregiver-app-design.md's build note.
  const weeklyTarget = profile?.custom_min_hours ?? null;

  if (loading) {
    return (
      <CaregiverAppShell>
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </CaregiverAppShell>
    );
  }

  return (
    <CaregiverAppShell>
      <div className="px-4 pt-6 pb-4 space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-2xl font-bold">
            {timeOfDayGreeting()}, {profile?.first_name}
          </h1>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-primary/5 border-primary/10">
            <CardContent className="p-4">
              <p className="text-2xl font-bold tabular-nums">{hoursToday}h</p>
              <p className="text-xs font-semibold uppercase text-muted-foreground mt-1">Today</p>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/10">
            <CardContent className="p-4">
              <p className="text-2xl font-bold tabular-nums">
                {hoursThisWeek}
                {weeklyTarget != null && <span className="text-muted-foreground">/{weeklyTarget}h</span>}
                {weeklyTarget == null && "h"}
              </p>
              <p className="text-xs font-semibold uppercase text-muted-foreground mt-1">This week</p>
            </CardContent>
          </Card>
        </div>

        {performance?.avg_rating != null && (
          <p className="text-sm text-muted-foreground">
            ⭐ {performance.avg_rating.toFixed(1)} average · {performance.rating_count} rating
            {performance.rating_count === 1 ? "" : "s"}
          </p>
        )}

        <div>
          <h2 className="text-sm font-bold uppercase text-muted-foreground mb-2">Today's shifts</h2>
          {todayShifts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CalendarOff className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
                <p className="font-medium">No shifts today</p>
                <p className="text-sm text-muted-foreground">Enjoy your day off!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {todayShifts.map((s) => (
                <Card
                  key={s.assignmentId}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() =>
                    setSelectedShift({
                      id: s.shiftId,
                      status: "assigned",
                      shift_date: s.shiftDate,
                      start_time: s.startTime,
                      end_time: s.endTime,
                      duration_hours: s.durationHours,
                      care_type_code: s.careTypeCode,
                      clients: s.client,
                    })
                  }
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Badge
                        variant="secondary"
                        className={
                          s.status === "live"
                            ? "bg-green-500/10 text-green-600 border-green-500/20"
                            : s.status === "done"
                            ? "bg-muted text-muted-foreground"
                            : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                        }
                      >
                        {s.status === "live" ? "🟢 In progress" : s.status === "done" ? "✓ Completed" : "⏱ Upcoming"}
                      </Badge>
                      <span className="text-xs font-medium text-muted-foreground">
                        {getCareTypeLabel(s.careTypeCode)}
                      </span>
                    </div>
                    <p className="text-lg font-bold tabular-nums">
                      {s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)}{" "}
                      <span className="text-sm font-normal text-muted-foreground">({s.durationHours}h)</span>
                    </p>
                    <p className="font-medium mt-1">
                      {s.client ? `${s.client.first_name} ${s.client.last_name}` : "Unknown client"}
                    </p>
                    {s.client?.address && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>
                          {s.client.address}
                          {s.client.city ? `, ${s.client.city}` : ""}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <button
          className="w-full flex items-center justify-between gap-2 rounded-xl bg-accent px-4 py-3.5 text-accent-foreground font-semibold"
          onClick={() => navigate("/available-shifts")}
        >
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {availableCount > 0
              ? `${availableCount} shift${availableCount === 1 ? "" : "s"} available to pick up`
              : "Browse available shifts"}
          </span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <ShiftDetailsDialog
        shift={selectedShift}
        open={!!selectedShift}
        onOpenChange={(open) => !open && setSelectedShift(null)}
      />
    </CaregiverAppShell>
  );
};

export default CaregiverToday;
