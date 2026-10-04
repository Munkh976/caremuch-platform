import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { ShiftList } from "@/components/caregivers/ShiftList";
import { ShiftDetailsDialog } from "@/components/schedule/ShiftDetailsDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertCircle, Calendar, Clock } from "lucide-react";
import { toast } from "sonner";
import { parseShiftDate } from "@/lib/shiftDate";
import { fetchCaregiverVisibleClients } from "@/lib/caregiverVisibleClients";

interface Assignment {
  id: string;
  status: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  shifts: {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    care_type_code: string;
    duration_hours: number;
    clients: { first_name: string; last_name: string; address: string; city: string };
  };
}

/**
 * Placeholder destination for the Shell's "Schedule" tab -- carries forward the existing
 * Upcoming/This Week/History browser (previously buried inside CaregiverDashboard's
 * Overview tab) so the tab has somewhere real to go. This is a relocation, not the Phase B
 * agenda redesign (see docs/caregiver-app-design.md §3.3) -- that still replaces this with
 * one grouped-by-day list.
 */
const CaregiverSchedule = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"upcoming" | "week" | "history">("upcoming");
  const [upcoming, setUpcoming] = useState<Assignment[]>([]);
  const [week, setWeek] = useState<Assignment[]>([]);
  const [history, setHistory] = useState<Assignment[]>([]);
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

      const { data: caregiverData } = await supabase
        .from("caregivers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!caregiverData) {
        toast.error("Caregiver profile not found");
        setLoading(false);
        return;
      }

      const [{ data: assignmentsData, error }, visibleClients] = await Promise.all([
        // Exclude cancelled assignments (e.g. released back to the pool by approved time
        // off) -- a cancelled assignment is no longer "my" shift. See docs/known-issues.md.
        supabase
          .from("shift_assignments")
          .select(`*, shifts (*)`)
          .eq("caregiver_id", caregiverData.id)
          .neq("status", "cancelled"),
        fetchCaregiverVisibleClients(),
      ]);
      if (error) throw error;

      for (const a of assignmentsData || []) {
        if (a.shifts) (a.shifts as any).clients = visibleClients.get((a.shifts as any).client_id) || null;
      }

      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const all = ((assignmentsData || []) as unknown as Assignment[]).sort((a, b) =>
        parseShiftDate(a.shifts?.shift_date || now.toISOString().slice(0, 10)).getTime() -
        parseShiftDate(b.shifts?.shift_date || now.toISOString().slice(0, 10)).getTime()
      );

      setUpcoming(all.filter((a: any) => parseShiftDate(a.shifts?.shift_date) >= now));
      setWeek(
        all.filter((a: any) => {
          const d = parseShiftDate(a.shifts?.shift_date);
          return d >= startOfWeek && d <= endOfWeek;
        })
      );
      setHistory(all.filter((a: any) => parseShiftDate(a.shifts?.shift_date) < now).reverse());
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to load your schedule");
    } finally {
      setLoading(false);
    }
  };

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
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold mb-4">My Schedule</h1>
        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="week">This Week ({week.length})</TabsTrigger>
            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming">
            <ShiftList
              shifts={upcoming}
              onShiftClick={setSelectedShift}
              emptyMessage="No upcoming shifts scheduled"
              emptyIcon={<AlertCircle className="w-12 h-12 text-cyan-500 mb-2" />}
              borderColor="border-primary"
            />
          </TabsContent>
          <TabsContent value="week">
            <ShiftList
              shifts={week}
              onShiftClick={setSelectedShift}
              emptyMessage="No shifts this week"
              emptyIcon={<Calendar className="w-12 h-12 text-blue-500 mb-2" />}
              borderColor="border-blue-500"
            />
          </TabsContent>
          <TabsContent value="history">
            <ShiftList
              shifts={history}
              onShiftClick={setSelectedShift}
              emptyMessage="No shift history"
              emptyIcon={<Clock className="w-12 h-12 text-gray-500 mb-2" />}
              borderColor="border-gray-400"
            />
          </TabsContent>
        </Tabs>
      </div>

      <ShiftDetailsDialog
        shift={selectedShift}
        open={!!selectedShift}
        onOpenChange={(open) => !open && setSelectedShift(null)}
      />
    </CaregiverAppShell>
  );
};

export default CaregiverSchedule;
