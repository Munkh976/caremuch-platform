import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { Calendar, Clock, AlertCircle, Home, Settings, DollarSign, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShiftDetailsDialog } from "@/components/schedule/ShiftDetailsDialog";
import { ShiftList } from "@/components/caregivers/ShiftList";
import { PerformanceProfile } from "@/components/caregivers/PerformanceProfile";
import {
  fetchOneCaregiverPerformance,
  type CaregiverPerformance,
} from "@/lib/caregiverPerformance";
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
    clients: {
      first_name: string;
      last_name: string;
      address: string;
      city: string;
    };
  };
}

interface CaregiverProfile {
  id: string;
  first_name: string;
  last_name: string;
  reliability_score: number;
  hourly_rate: number;
}

const CaregiverDashboard = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CaregiverProfile | null>(null);
  const [upcomingShifts, setUpcomingShifts] = useState<Assignment[]>([]);
  const [weekShifts, setWeekShifts] = useState<Assignment[]>([]);
  const [historyShifts, setHistoryShifts] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule'>('overview');
  const [shiftView, setShiftView] = useState<'upcoming' | 'week' | 'history'>('upcoming');
  const [selectedShift, setSelectedShift] = useState<any>(null);
  const [todayShifts, setTodayShifts] = useState<Assignment[]>([]);
  const [performance, setPerformance] = useState<CaregiverPerformance | null>(null);

  useEffect(() => {
    checkAuthAndFetch();
  }, []);

  const checkAuthAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }
    await fetchCaregiverData(user.id);
  };

  const fetchCaregiverData = async (userId: string) => {
    try {
      setLoading(true);

      // Find caregiver by user_id
      const { data: caregiverData, error: caregiverError } = await supabase
        .from("caregivers")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (caregiverError) throw caregiverError;
      if (!caregiverData) {
        toast.error("Caregiver profile not found");
        setLoading(false);
        return;
      }
      
      setProfile(caregiverData);
      setPerformance(await fetchOneCaregiverPerformance(caregiverData.id));

      // Fetch all assignments with shifts. clients is NOT embedded here -- caregivers have
      // no RLS SELECT policy on public.clients at all, so a nested embed silently resolves
      // to null (this was the "Unknown client" bug). Fetch the caregiver-safe, narrow client
      // view separately via get_caregiver_visible_clients() and merge by client_id.
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from("shift_assignments")
        .select(`
          *,
          shifts (*)
        `)
        .eq("caregiver_id", caregiverData.id)
        // A cancelled assignment (e.g. released by approved time off) is no longer this caregiver's shift.
        .neq("status", "cancelled");

      if (assignmentsError) throw assignmentsError;

      const visibleClients = await fetchCaregiverVisibleClients();
      for (const a of assignmentsData || []) {
        if (a.shifts) {
          (a.shifts as any).clients = visibleClients.get((a.shifts as any).client_id) || null;
        }
      }

      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Sort all assignments by date
      const allAssignments = (assignmentsData || []).sort((a, b) => {
        const dateA = new Date(a.shifts?.shift_date || '');
        const dateB = new Date(b.shifts?.shift_date || '');
        return dateA.getTime() - dateB.getTime();
      });

      // Filter into categories
      const upcoming = allAssignments.filter(a => {
        const shiftDate = new Date(a.shifts?.shift_date || '');
        return shiftDate >= now;
      });

      const thisWeek = allAssignments.filter(a => {
        const shiftDate = new Date(a.shifts?.shift_date || '');
        return shiftDate >= startOfWeek && shiftDate <= endOfWeek;
      });

      const history = allAssignments.filter(a => {
        const shiftDate = new Date(a.shifts?.shift_date || '');
        return shiftDate < now;
      }).reverse(); // Most recent first

      setUpcomingShifts(upcoming);
      setWeekShifts(thisWeek);
      setHistoryShifts(history);

      // Filter today's shifts
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      const todaySchedule = allAssignments.filter(a => {
        const shiftDate = new Date(a.shifts?.shift_date || '');
        return shiftDate >= today && shiftDate <= todayEnd;
      });
      setTodayShifts(todaySchedule);

    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  // Calculate weekly hours and earnings from this week's shifts
  const weeklyHours = weekShifts.reduce((sum, a) => sum + (a.shifts?.duration_hours || 0), 0);
  const weeklyEarnings = profile ? weeklyHours * profile.hourly_rate : 0;
  const minHoursRequired = 35; // Default full-time minimum

  if (loading) {
    return (
      <CaregiverAppShell>
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </CaregiverAppShell>
    );
  }

  return (
    <CaregiverAppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Welcome back, {profile?.first_name}! 👋
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's your schedule and stats for this week
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-border/40">
          <Tabs value={activeTab} onValueChange={(v) => {
            if (v === 'overview') setActiveTab('overview');
            if (v === 'schedule') setActiveTab('schedule');
            if (v === 'available') navigate('/available-shifts');
            if (v === 'timeoff') navigate('/caregiver-time-off');
            if (v === 'settings') navigate('/caregiver-settings');
          }}>
            <TabsList className="grid w-full grid-cols-5 gap-2">
              <TabsTrigger value="overview" className="gap-2">
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="schedule" className="gap-2">
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">My Schedule</span>
              </TabsTrigger>
              <TabsTrigger value="available" className="gap-2">
                <Briefcase className="w-4 h-4" />
                <span className="hidden sm:inline">Available</span>
              </TabsTrigger>
              <TabsTrigger value="timeoff" className="gap-2">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Time Off</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Settings</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {activeTab === 'overview' && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">HOURS THIS WEEK</p>
                  <p className="text-4xl font-bold mt-2">{weeklyHours}/{minHoursRequired}</p>
                </div>
                <Clock className="w-8 h-8 text-blue-500" />
              </div>
              {weeklyHours < minHoursRequired && (
                <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Below Minimum
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">ESTIMATED EARNINGS</p>
                  <p className="text-4xl font-bold mt-2">${weeklyEarnings.toFixed(2)}</p>
                </div>
                <DollarSign className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-xs text-muted-foreground">Based on {weeklyHours} hours at ${profile?.hourly_rate}/hr</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">YOUR RATING</p>
                  <p className="text-4xl font-bold mt-2">
                    {performance?.avg_rating != null
                      ? performance.avg_rating.toFixed(1)
                      : "—"}
                  </p>
                </div>
                <Briefcase className="w-8 h-8 text-purple-500" />
              </div>
              <p className="text-xs text-muted-foreground">
                {performance?.avg_rating != null
                  ? `Average of ${performance.rating_count} client rating${performance.rating_count === 1 ? "" : "s"}`
                  : "No client ratings yet"}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mb-6">
          <PerformanceProfile perf={performance} />
        </div>

        {/* Shifts View with Tabs */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <Tabs value={shiftView} onValueChange={(v) => setShiftView(v as any)}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-xl font-bold">Your Shifts</h2>
                <TabsList className="h-auto flex-wrap">
                  <TabsTrigger value="upcoming">
                    Upcoming ({upcomingShifts.length})
                  </TabsTrigger>
                  <TabsTrigger value="week">
                    This Week ({weekShifts.length})
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    History ({historyShifts.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="upcoming">
                <ShiftList
                  shifts={upcomingShifts}
                  onShiftClick={setSelectedShift}
                  emptyMessage="No upcoming shifts scheduled"
                  emptyIcon={<AlertCircle className="w-12 h-12 text-cyan-500 mb-2" />}
                  borderColor="border-primary"
                />
              </TabsContent>

              <TabsContent value="week">
                <ShiftList
                  shifts={weekShifts}
                  onShiftClick={setSelectedShift}
                  emptyMessage="No shifts this week"
                  emptyIcon={<Calendar className="w-12 h-12 text-blue-500 mb-2" />}
                  borderColor="border-blue-500"
                />
              </TabsContent>

              <TabsContent value="history">
                <ShiftList
                  shifts={historyShifts}
                  onShiftClick={setSelectedShift}
                  emptyMessage="No shift history"
                  emptyIcon={<Clock className="w-12 h-12 text-gray-500 mb-2" />}
                  borderColor="border-gray-400"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">💼 Available Shifts</h3>
                  <p className="text-sm text-muted-foreground">Pick up extra hours</p>
                </div>
              </div>
              <Button className="w-full" onClick={() => navigate("/available-shifts")}>
                Browse Available Shifts
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">🏖️ Time Off</h3>
                  <p className="text-sm text-muted-foreground">Request vacation or sick leave</p>
                </div>
              </div>
              <Button className="w-full" onClick={() => navigate("/caregiver-time-off")}>
                Manage Time Off
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">⚙️ Settings</h3>
                  <p className="text-sm text-muted-foreground">Update location & availability</p>
                </div>
              </div>
              <Button className="w-full" onClick={() => navigate("/caregiver-settings")}>
                Manage Settings
              </Button>
            </CardContent>
          </Card>
        </div>
          </>
        )}

        {activeTab === 'schedule' && (
          <div className="space-y-6">
            {/* Today's Schedule Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">My Schedule - Today</h2>
                <p className="text-muted-foreground">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
              <Badge variant="secondary" className="text-lg px-4 py-2">
                {todayShifts.length} Shift{todayShifts.length !== 1 ? 's' : ''}
              </Badge>
            </div>

            {/* Today's Timeline */}
            {todayShifts.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <Calendar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No shifts scheduled today</h3>
                  <p className="text-muted-foreground">Enjoy your day off!</p>
                </CardContent>
              </Card>
            ) : (
              <div className="relative">
                {/* Timeline Container */}
                <div className="space-y-4">
                  {todayShifts
                    .sort((a, b) => {
                      const timeA = a.shifts?.start_time || '';
                      const timeB = b.shifts?.start_time || '';
                      return timeA.localeCompare(timeB);
                    })
                    .map((assignment, index) => {
                      const shift = assignment.shifts;
                      const client = shift?.clients;
                      const now = new Date();
                      const shiftDate = new Date(shift?.shift_date || '');
                      const [startHour, startMin] = (shift?.start_time || '00:00').split(':').map(Number);
                      const [endHour, endMin] = (shift?.end_time || '00:00').split(':').map(Number);
                      
                      const shiftStart = new Date(shiftDate);
                      shiftStart.setHours(startHour, startMin, 0, 0);
                      
                      const shiftEnd = new Date(shiftDate);
                      shiftEnd.setHours(endHour, endMin, 0, 0);

                      const isActive = now >= shiftStart && now <= shiftEnd;
                      const isPast = now > shiftEnd;
                      const isUpcoming = now < shiftStart;

                      return (
                        <Card 
                          key={assignment.id}
                          className={`relative border-l-4 ${
                            isActive ? 'border-l-green-500 bg-green-500/5' :
                            isPast ? 'border-l-gray-400 bg-muted/30' :
                            'border-l-blue-500 bg-blue-500/5'
                          } hover:shadow-lg transition-all cursor-pointer`}
                          onClick={() => setSelectedShift(shift)}
                        >
                          <CardContent className="p-6">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <Badge variant={
                                    isActive ? 'default' :
                                    isPast ? 'secondary' :
                                    'outline'
                                  }>
                                    {isActive ? '🟢 In Progress' : isPast ? '✓ Completed' : '⏱️ Upcoming'}
                                  </Badge>
                                  <span className="text-2xl font-bold">
                                    {shift?.start_time} - {shift?.end_time}
                                  </span>
                                  <span className="text-muted-foreground">
                                    ({shift?.duration_hours}h)
                                  </span>
                                </div>
                                
                                <h3 className="text-xl font-semibold mb-1">
                                  {client?.first_name} {client?.last_name}
                                </h3>
                                
                                <div className="flex items-center gap-2 text-muted-foreground mb-3">
                                  <Clock className="w-4 h-4" />
                                  <span>{client?.address}, {client?.city}</span>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">
                                    {shift?.care_type_code?.replace(/_/g, ' ').toUpperCase()}
                                  </Badge>
                                  <Badge variant="outline">
                                    {assignment.status}
                                  </Badge>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-2">
                                {assignment.clock_in_time && (
                                  <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                                    ✓ Clocked In
                                  </Badge>
                                )}
                                {assignment.clock_out_time && (
                                  <Badge variant="secondary" className="bg-gray-500/10 text-gray-600">
                                    ✓ Clocked Out
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Progress Bar for Active Shift */}
                            {isActive && (
                              <div className="mt-4">
                                <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                                  <span>Shift Progress</span>
                                  <span>
                                    {Math.round(
                                      ((now.getTime() - shiftStart.getTime()) / 
                                      (shiftEnd.getTime() - shiftStart.getTime())) * 100
                                    )}%
                                  </span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-green-500 transition-all"
                                    style={{
                                      width: `${Math.min(100, Math.max(0, 
                                        ((now.getTime() - shiftStart.getTime()) / 
                                        (shiftEnd.getTime() - shiftStart.getTime())) * 100
                                      ))}%`
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Week Overview */}
            <Card>
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4">This Week's Summary</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-3xl font-bold text-primary">{weekShifts.length}</div>
                    <div className="text-sm text-muted-foreground">Total Shifts</div>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-3xl font-bold text-green-600">{weeklyHours.toFixed(1)}</div>
                    <div className="text-sm text-muted-foreground">Hours Scheduled</div>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-3xl font-bold text-blue-600">
                      ${weeklyEarnings.toFixed(0)}
                    </div>
                    <div className="text-sm text-muted-foreground">Expected Earnings</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ShiftDetailsDialog
        shift={selectedShift}
        open={!!selectedShift}
        onOpenChange={(open) => !open && setSelectedShift(null)}
      />
    </CaregiverAppShell>
  );
};

export default CaregiverDashboard;
