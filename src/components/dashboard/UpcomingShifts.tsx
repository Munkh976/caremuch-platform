import { VisitPlaceLine } from "@/components/schedule/VisitPlaceLine";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, User } from "lucide-react";
import { format } from "date-fns";

const UpcomingShifts = () => {
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchShifts = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date().toISOString().split("T")[0];
      
      const { data, error } = await supabase
        .from("shifts")
        .select(`
          *,
          clients:client_id (first_name, last_name, city),
          shift_assignments (status, caregivers (first_name, last_name))
        `)
        .eq("agency_id", user.id)
        .gte("shift_date", today)
        .order("shift_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(5);

      if (error) {
        console.error("Error fetching shifts:", error);
      } else {
        setShifts(data || []);
      }
      
      setLoading(false);
    };

    fetchShifts();

    // Set up realtime subscription
    const channel = supabase
      .channel("shifts-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shifts",
        },
        () => {
          fetchShifts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-warning/10 text-warning";
      case "assigned":
        return "bg-accent/10 text-accent";
      case "confirmed":
        return "bg-success/10 text-success";
      case "in_progress":
        return "bg-primary/10 text-primary";
      case "completed":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Shifts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Shifts</CardTitle>
        <CardDescription>Next 5 scheduled shifts</CardDescription>
      </CardHeader>
      <CardContent>
        {shifts.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No upcoming shifts</p>
        ) : (
          <div className="space-y-4">
            {shifts.map((shift) => (
              <div key={shift.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">
                      {shift.clients?.first_name} {shift.clients?.last_name}
                    </p>
                    <Badge variant="secondary" className={getStatusColor(shift.status)}>
                      {shift.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(shift.shift_date), "MMM dd")} • {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                    </span>
                    <VisitPlaceLine officeId={shift.virtual_office_id} client={shift.clients} />
                  </div>
                  {shift.shift_assignments?.find((a: any) => a?.status !== "cancelled")?.caregivers && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>
                        {shift.shift_assignments.find((a: any) => a?.status !== "cancelled").caregivers.first_name}{" "}
                        {shift.shift_assignments.find((a: any) => a?.status !== "cancelled").caregivers.last_name}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UpcomingShifts;