import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Clock, MapPin, Phone } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { VisitPlaceLine } from "@/components/schedule/VisitPlaceLine";

interface Props {
  agencyId: string | null;
  onAssign: (shift: any) => void;
}

const statusClass = (status: string) => {
  const colors: Record<string, string> = {
    scheduled: "bg-accent/10 text-accent border-accent/20",
    confirmed: "bg-primary/10 text-primary border-primary/20",
    in_progress: "bg-success/10 text-success border-success/20",
    completed: "bg-muted text-muted-foreground",
    no_show: "bg-destructive/10 text-destructive border-destructive/20",
    cancelled: "bg-muted text-muted-foreground",
  };
  return colors[status] || "bg-muted";
};

export const LiveOpsView = ({ agencyId, onAssign }: Props) => {
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active: 0, upcoming: 0, completed: 0, gaps: 0 });

  const fetchLive = useCallback(async () => {
    if (!agencyId) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("shifts")
        .select(
          `*, clients ( first_name, last_name, address, city, state, phone ), care_types ( name, code, category ), shift_assignments ( id, status, clock_in_time, clock_out_time, caregivers ( first_name, last_name, phone ) )`
        )
        .eq("agency_id", agencyId)
        .eq("shift_date", today)
        .order("start_time", { ascending: true });
      if (error) throw error;

      const rows = data || [];
      setShifts(rows);

      let active = 0;
      let upcoming = 0;
      let completed = 0;
      let gaps = 0;
      rows.forEach((shift: any) => {
        const a = shift.shift_assignments?.[0];
        if (!a) {
          gaps++;
        } else if (a.status === "in_progress") {
          active++;
        } else if (a.status === "completed") {
          completed++;
        } else if (a.status === "scheduled" || a.status === "confirmed") {
          upcoming++;
        }
      });
      setStats({ active, upcoming, completed, gaps });
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to load live operations");
    } finally {
      setLoading(false);
    }
  }, [agencyId]);

  useEffect(() => {
    fetchLive();
    const channel = supabase
      .channel("live-operations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_assignments" },
        () => fetchLive()
      )
      .subscribe();
    const interval = setInterval(fetchLive, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchLive]);

  if (loading) {
    return <div className="py-16 text-center text-muted-foreground">Loading today's operations...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {format(new Date(), "EEEE, MMMM d, yyyy")} • Real-time monitoring (auto-refreshes)
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In progress</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-bold text-success">{stats.active}</div>
            <CheckCircle className="h-7 w-7 text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming today</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-bold text-accent">{stats.upcoming}</div>
            <Clock className="h-7 w-7 text-accent" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-bold">{stats.completed}</div>
            <CheckCircle className="h-7 w-7 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className={stats.gaps > 0 ? "border-destructive" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Urgent gaps</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className={`text-3xl font-bold ${stats.gaps > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {stats.gaps}
            </div>
            {stats.gaps > 0 && <AlertCircle className="h-7 w-7 text-destructive" />}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {shifts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Clock className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No shifts scheduled for today</p>
            </CardContent>
          </Card>
        ) : (
          shifts.map((shift) => {
            const assignment = shift.shift_assignments?.[0];
            return (
              <Card key={shift.id} className={!assignment ? "border-destructive" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {shift.clients?.first_name} {shift.clients?.last_name}
                      </CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-4">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
                        </span>
                        <VisitPlaceLine officeId={shift.virtual_office_id} client={shift.clients} variant="full" iconClassName="h-3.5 w-3.5" />
                        <span>{shift.care_types?.name || shift.order_title}</span>
                      </CardDescription>
                    </div>
                    {assignment ? (
                      <Badge variant="outline" className={statusClass(assignment.status)}>
                        {assignment.status.replace(/_/g, " ")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                        UNASSIGNED
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {assignment ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {assignment.caregivers?.first_name} {assignment.caregivers?.last_name}
                        </p>
                        {assignment.caregivers?.phone && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {assignment.caregivers.phone}
                          </p>
                        )}
                      </div>
                      <div className="text-right text-sm">
                        {assignment.clock_in_time && (
                          <p className="text-success">
                            Clocked in: {format(new Date(assignment.clock_in_time), "h:mm a")}
                          </p>
                        )}
                        {assignment.clock_out_time && (
                          <p className="text-muted-foreground">
                            Clocked out: {format(new Date(assignment.clock_out_time), "h:mm a")}
                          </p>
                        )}
                        {!assignment.clock_in_time && (
                          <p className="text-muted-foreground">Not clocked in yet</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-destructive text-sm">This shift needs coverage immediately</p>
                      <Button size="sm" onClick={() => onAssign(shift)}>
                        Find cover
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
