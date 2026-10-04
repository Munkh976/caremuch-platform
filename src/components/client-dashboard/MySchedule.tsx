import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCareTeam, type CareTeamMember } from "@/lib/clientCareTeam";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Calendar, Clock, User, ChevronLeft, ChevronRight,
  Bath, Home, Heart, Brain, Shield, Moon, CheckCircle,
  Phone, MessageCircle, Star
} from "lucide-react";
import { format, startOfWeek, addDays, subWeeks, addWeeks } from "date-fns";

const SERVICE_CATEGORIES: Record<string, { name: string; color: string; icon: any }> = {
  ADL: { name: 'Activities of Daily Living', color: 'hsl(217, 91%, 60%)', icon: Bath },
  IADL: { name: 'Instrumental ADL', color: 'hsl(142, 76%, 36%)', icon: Home },
  Health: { name: 'Health Monitoring', color: 'hsl(0, 84%, 60%)', icon: Heart },
  Cognitive: { name: 'Cognitive Support', color: 'hsl(262, 83%, 58%)', icon: Brain },
  Safety: { name: 'Safety & Transport', color: 'hsl(36, 100%, 50%)', icon: Shield },
  Specialized: { name: 'Specialized Care', color: 'hsl(326, 78%, 52%)', icon: Moon },
};

interface MyScheduleProps {
  clientProfile: any;
}

export const MySchedule = ({ clientProfile }: MyScheduleProps) => {
  const [viewMode, setViewMode] = useState<'week' | 'list'>('week');
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (clientProfile?.id) {
      fetchShifts();
    }
  }, [clientProfile]);

  const fetchShifts = async () => {
    const { data } = await supabase
      .from("shifts")
      .select("*")
      .eq("client_id", clientProfile.id)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true });

    // M-SEC-5: clients no longer read caregivers directly; attach the display-safe name
    // (first name + last initial) from get_my_care_team(), keeping the existing render shape.
    const team: CareTeamMember[] = await fetchMyCareTeam().catch(() => [] as CareTeamMember[]);
    const names = new Map<string, { first_name: string; last_name: string }>();
    team.forEach((m) => names.set(m.caregiver_id, { first_name: m.first_name, last_name: m.last_initial ? `${m.last_initial}.` : "" }));
    setShifts((data || []).map((s: any) => ({ ...s, caregivers: s.caregiver_id ? names.get(s.caregiver_id) ?? null : null })));
    setLoading(false);
  };

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedWeek, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedWeek]);

  const todayShifts = shifts.filter(s =>
    format(new Date(s.shift_date), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
  );

  // Week View
  const WeekView = () => (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-7 gap-3">
          {weekDays.map(day => {
            const dayShifts = shifts.filter(s => {
              const shiftDate = new Date(s.shift_date);
              return format(shiftDate, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd');
            });

            const isToday = format(new Date(), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd');

            return (
              <div
                key={day.toISOString()}
                className={`border rounded-xl p-3 ${isToday ? 'ring-2 ring-primary bg-primary/5' : 'bg-card'}`}
              >
                <div className="text-center mb-3">
                  <div className="text-sm font-medium text-muted-foreground">
                    {format(day, 'EEE')}
                  </div>
                  <div className="text-xl font-bold">
                    {format(day, 'd')}
                  </div>
                </div>

                {dayShifts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <div className="text-xs">No scheduled care</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dayShifts.map(shift => {
                      const color = SERVICE_CATEGORIES[shift.care_type_code]?.color || 'hsl(var(--muted))';
                      const Icon = SERVICE_CATEGORIES[shift.care_type_code]?.icon || Clock;

                      return (
                        <div
                          key={shift.id}
                          className="rounded-lg p-2 border-l-4 bg-muted/30 hover:shadow-md transition-all cursor-pointer"
                          style={{ borderLeftColor: color }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Icon className="w-4 h-4" style={{ color }} />
                            <span className="text-xs font-semibold">{shift.start_time}</span>
                          </div>
                          <div className="text-xs font-medium">
                            {shift.order_title}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {shift.caregivers?.first_name} {shift.caregivers?.last_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {shift.duration_hours} hour{shift.duration_hours !== 1 ? 's' : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  // List View
  const ListView = () => {
    const upcomingShifts = shifts
      .filter(s => new Date(s.shift_date) >= new Date())
      .slice(0, 10);

    return (
      <div className="space-y-4">
        {upcomingShifts.map(shift => {
          const color = SERVICE_CATEGORIES[shift.care_type_code]?.color || 'hsl(var(--muted))';
          const Icon = SERVICE_CATEGORIES[shift.care_type_code]?.icon || Clock;
          const shiftDate = new Date(shift.shift_date);
          const isToday = format(shiftDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

          return (
            <Card
              key={shift.id}
              className={`border-l-4 hover:shadow-md transition-all ${
                isToday ? 'ring-2 ring-primary' : ''
              }`}
              style={{ borderLeftColor: color }}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${color}20` }}
                      >
                        <Icon className="w-6 h-6" style={{ color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{shift.order_title}</h3>
                        <div className="text-sm text-muted-foreground">
                          {format(shiftDate, 'EEEE, MMMM d, yyyy')}
                        </div>
                      </div>
                      {isToday && (
                        <Badge variant="default">Today</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Time</div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{shift.start_time} ({shift.duration_hours}hr)</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Caregiver</div>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">
                            {shift.caregivers?.first_name} {shift.caregivers?.last_name}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Status</div>
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="font-medium text-green-600">Confirmed</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <Button variant="outline" size="icon">
                      <MessageCircle className="w-5 h-5" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <Phone className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Today's Summary */}
      {todayShifts.length > 0 && (
        <Card className="bg-gradient-to-r from-primary to-accent text-primary-foreground">
          <CardContent className="p-6">
            <h2 className="font-semibold mb-3 text-lg">Today's Care</h2>
            <div className="grid grid-cols-4 gap-4">
              {todayShifts.map(shift => (
                <div key={shift.id} className="bg-white/10 backdrop-blur rounded-lg p-3">
                  <div className="text-sm font-medium mb-1">{shift.start_time}</div>
                  <div className="text-xs opacity-90">{shift.order_title}</div>
                  <div className="text-xs opacity-80 mt-1">
                    with {shift.caregivers?.first_name}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedWeek(subWeeks(selectedWeek, 1))}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>

          <h2 className="text-lg font-semibold mx-4">
            {viewMode === 'week'
              ? `Week of ${format(selectedWeek, 'MMM d')}`
              : 'Upcoming Care Sessions'}
          </h2>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedWeek(addWeeks(selectedWeek, 1))}
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant={viewMode === 'week' ? 'default' : 'outline'}
            onClick={() => setViewMode('week')}
          >
            Week View
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            onClick={() => setViewMode('list')}
          >
            List View
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'week' ? <WeekView /> : <ListView />}
    </div>
  );
};
