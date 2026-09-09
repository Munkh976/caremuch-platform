import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/StatCard";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart3, TrendingUp, Users, Clock, Download, Calendar as CalendarIcon, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line } from "recharts";
import { HoursDeliveredTab } from "@/components/reports/HoursDeliveredTab";


interface ReportStats {
  totalShifts: number;
  completedShifts: number;
  activeCaregivers: number;
  activeClients: number;
  totalHours: number;
  growthRate: number;
  unassignedShifts: number;
  coverageRate: number;
}

interface CaregiverMetric {
  caregiver: string;
  shifts: number;
  hours: number;
  completionRate: number;
  onTimeRate: number;
  avgRating: number | null;
  overtimeHours: number;
}

const Reports = () => {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [shiftData, setShiftData] = useState<any[]>([]);
  const [workforce, setWorkforce] = useState<CaregiverMetric[]>([]);
  const [serviceMix, setServiceMix] = useState<{ service: string; shifts: number; hours: number }[]>([]);

  useEffect(() => {
    fetchReportData();
  }, [dateRange]);

  const fetchReportData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please sign in to view reports");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", user.id)
        .maybeSingle();
      const agencyId = profile?.agency_id;
      if (!agencyId) {
        toast.error("No agency is linked to your account");
        return;
      }

      const from = format(dateRange.from, "yyyy-MM-dd");
      const to = format(dateRange.to, "yyyy-MM-dd");

      const [{ data: shifts, error: shiftsError }, { data: caregivers, error: caregiversError }, { data: clients, error: clientsError }, { data: careTypes }] =
        await Promise.all([
          supabase
            .from("shifts")
            .select("*, shift_assignments(*)")
            .gte("shift_date", from)
            .lte("shift_date", to)
            .eq("agency_id", agencyId),
          supabase.from("caregivers").select("*").eq("agency_id", agencyId).eq("is_active", true),
          supabase.from("clients").select("*").eq("agency_id", agencyId).eq("is_active", true),
          supabase.from("care_types").select("code, name"),
        ]);

      if (shiftsError) throw shiftsError;
      if (caregiversError) throw caregiversError;
      if (clientsError) throw clientsError;

      const shiftIds = (shifts || []).map((s) => s.id);
      const { data: ratings } = shiftIds.length
        ? await supabase.from("shift_ratings").select("caregiver_id, rating").in("shift_id", shiftIds)
        : { data: [] as any[] };

      // Calculate stats
      const completedShifts = shifts?.filter(s => s.status === "completed").length || 0;
      const totalHours = shifts?.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0) || 0;
      const activeAssignment = (s: any) =>
        (s.shift_assignments || []).find((a: any) => a?.status !== "cancelled") || null;
      const unassignedShifts = shifts?.filter((s: any) => !activeAssignment(s)).length || 0;

      const coverageRate = shifts?.length ? ((shifts.length - unassignedShifts) / shifts.length) * 100 : 0;

      // Calculate growth rate (compare with previous period)
      const periodDays = Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24));
      const prevFrom = subDays(dateRange.from, periodDays);
      const { data: prevShifts } = await supabase
        .from("shifts")
        .select("id")
        .gte("shift_date", format(prevFrom, "yyyy-MM-dd"))
        .lt("shift_date", format(dateRange.from, "yyyy-MM-dd"))
        .eq("agency_id", agencyId);

      const growthRate = prevShifts && prevShifts.length > 0
        ? ((shifts?.length || 0) - prevShifts.length) / prevShifts.length * 100
        : 0;

      setStats({
        totalShifts: shifts?.length || 0,
        completedShifts,
        activeCaregivers: caregivers?.length || 0,
        activeClients: clients?.length || 0,
        totalHours,
        growthRate,
        unassignedShifts,
        coverageRate,
      });

      // Process shift data for charts
      const shiftsByDate = shifts?.reduce((acc: any, shift) => {
        const date = shift.shift_date;
        if (!acc[date]) {
          acc[date] = { date, count: 0, hours: 0 };
        }
        acc[date].count++;
        acc[date].hours += Number(shift.duration_hours) || 0;
        return acc;
      }, {});

      setShiftData(Object.values(shiftsByDate || {}).sort((a: any, b: any) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      ));

      // --- Workforce metrics (DoorDash-style) ---
      const nameById = new Map((caregivers || []).map((c: any) => [c.id, `${c.first_name} ${c.last_name}`]));
      const ratingsBy = new Map<string, number[]>();
      (ratings || []).forEach((r: any) => {
        if (!r.caregiver_id) return;
        ratingsBy.set(r.caregiver_id, [...(ratingsBy.get(r.caregiver_id) || []), Number(r.rating)]);
      });

      const byCaregiver = new Map<string, CaregiverMetric & { onTimeCount: number; clocked: number; completed: number }>();
      (shifts || []).forEach((s: any) => {
        const cid = activeAssignment(s)?.caregiver_id;
        if (!cid) return;
        const entry =
          byCaregiver.get(cid) ||
          {
            caregiver: nameById.get(cid) || "Unknown",
            shifts: 0,
            hours: 0,
            completionRate: 0,
            onTimeRate: 0,
            avgRating: null,
            overtimeHours: 0,
            onTimeCount: 0,
            clocked: 0,
            completed: 0,
          };
        entry.shifts += 1;
        entry.hours += Number(s.duration_hours) || 0;
        if (s.status === "completed") entry.completed += 1;
        const assignment = (s.shift_assignments || [])[0];
        if (assignment?.clock_in_time) {
          entry.clocked += 1;
          const scheduled = new Date(`${s.shift_date}T${String(s.start_time).slice(0, 8)}`);
          const actual = new Date(assignment.clock_in_time);
          if (actual.getTime() - scheduled.getTime() <= 5 * 60 * 1000) entry.onTimeCount += 1;
        }
        byCaregiver.set(cid, entry);
      });

      const weeksInRange = Math.max(1, periodDays / 7);
      setWorkforce(
        Array.from(byCaregiver.entries())
          .map(([cid, e]) => {
            const rs = ratingsBy.get(cid) || [];
            return {
              caregiver: e.caregiver,
              shifts: e.shifts,
              hours: Number(e.hours.toFixed(1)),
              completionRate: e.shifts ? (e.completed / e.shifts) * 100 : 0,
              onTimeRate: e.clocked ? (e.onTimeCount / e.clocked) * 100 : 0,
              avgRating: rs.length ? Number((rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2)) : null,
              overtimeHours: Number(Math.max(0, e.hours - 40 * weeksInRange).toFixed(1)),
            };
          })
          .sort((a, b) => b.hours - a.hours)
      );

      // --- Client service mix ---
      const nameByCode = new Map((careTypes || []).map((c: any) => [c.code, c.name]));
      const mix = new Map<string, { service: string; shifts: number; hours: number }>();
      (shifts || []).forEach((s: any) => {
        const key = s.care_type_code || "—";
        const entry = mix.get(key) || { service: nameByCode.get(key) || key, shifts: 0, hours: 0 };
        entry.shifts += 1;
        entry.hours += Number(s.duration_hours) || 0;
        mix.set(key, entry);
      });
      setServiceMix(
        Array.from(mix.values())
          .map((m) => ({ ...m, hours: Number(m.hours.toFixed(1)) }))
          .sort((a, b) => b.shifts - a.shifts)
      );

    } catch (error: any) {
      toast.error(error.message || "Failed to load report data");
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = Object.keys(data[0]).join(",");
    const rows = data.map(row => Object.values(row).join(","));
    const csv = [headers, ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success("Report exported successfully");
  };

  const chartConfig = {
    count: {
      label: "Shifts",
      color: "hsl(var(--primary))",
    },
    hours: {
      label: "Hours",
      color: "hsl(var(--primary))",
    },
  };

  return (
    <AppLayout>
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Reports & Analytics</h1>
            <p className="text-muted-foreground">View comprehensive reports and analytics</p>
          </div>
          
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[280px] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange.from && dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                    </>
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <div className="p-3 space-y-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => setDateRange({ from: subDays(new Date(), 30), to: new Date() })}
                  >
                    Last 30 days
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => setDateRange({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) })}
                  >
                    This month
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            
            <Button
              variant="outline"
              onClick={() => exportToCSV(shiftData, "shift_report")}
              disabled={loading || shiftData.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {loading ? (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
              {[...Array(4)].map((_, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : stats ? (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
              <StatCard
                title="Total Shifts"
                value={stats.totalShifts}
                description={`${stats.completedShifts} completed`}
                icon={BarChart3}
                iconColor="text-primary"
              />
              <StatCard
                title="Active Caregivers"
                value={stats.activeCaregivers}
                icon={Users}
                iconColor="text-secondary"
              />
              <StatCard
                title="Hours This Period"
                value={stats.totalHours.toFixed(1)}
                description={`${stats.activeClients} active clients`}
                icon={Clock}
                iconColor="text-accent"
              />
              <StatCard
                title="Growth Rate"
                value={`${stats.growthRate > 0 ? '+' : ''}${stats.growthRate.toFixed(1)}%`}
                description="vs previous period"
                icon={TrendingUp}
                iconColor={stats.growthRate >= 0 ? "text-green-600" : "text-red-600"}
              />
            </div>

            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="shifts">Shifts</TabsTrigger>
                <TabsTrigger value="hours">Hours</TabsTrigger>
                <TabsTrigger value="workforce">Workforce</TabsTrigger>
                <TabsTrigger value="clients">Clients</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
              </TabsList>

              <TabsContent value="hours" className="space-y-6">
                <HoursDeliveredTab />
              </TabsContent>


              <TabsContent value="overview" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Shift Activity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {shiftData.length > 0 ? (
                      <ChartContainer config={chartConfig} className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={shiftData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                              dataKey="date" 
                              tickFormatter={(value) => format(new Date(value), "MMM dd")}
                              className="text-xs"
                            />
                            <YAxis className="text-xs" />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No shift data available for the selected period
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="shifts" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Hours Worked</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {shiftData.length > 0 ? (
                      <ChartContainer config={chartConfig} className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={shiftData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                              dataKey="date" 
                              tickFormatter={(value) => format(new Date(value), "MMM dd")}
                              className="text-xs"
                            />
                            <YAxis className="text-xs" />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Line 
                              type="monotone" 
                              dataKey="hours" 
                              stroke="var(--color-hours)" 
                              strokeWidth={2}
                              dot={{ fill: "var(--color-hours)" }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No hours data available for the selected period
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="workforce" className="space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Caregiver scorecard</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => exportToCSV(workforce, "workforce_report")}>
                      <Download className="mr-2 h-4 w-4" />
                      Export
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {workforce.length === 0 ? (
                      <p className="text-muted-foreground py-8 text-center">No assigned shifts in this period</p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Caregiver</TableHead>
                              <TableHead className="text-right">Shifts</TableHead>
                              <TableHead className="text-right">Hours</TableHead>
                              <TableHead className="text-right">Overtime</TableHead>
                              <TableHead className="text-right">Completion</TableHead>
                              <TableHead className="text-right">On-time</TableHead>
                              <TableHead className="text-right">Rating</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {workforce.map((w) => (
                              <TableRow key={w.caregiver}>
                                <TableCell className="font-medium">{w.caregiver}</TableCell>
                                <TableCell className="text-right">{w.shifts}</TableCell>
                                <TableCell className="text-right">{w.hours}</TableCell>
                                <TableCell className="text-right">
                                  {w.overtimeHours > 0 ? (
                                    <span className="text-destructive font-medium">{w.overtimeHours}</span>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                                <TableCell className="text-right">{w.completionRate.toFixed(0)}%</TableCell>
                                <TableCell className="text-right">
                                  {w.onTimeRate ? `${w.onTimeRate.toFixed(0)}%` : "—"}
                                </TableCell>
                                <TableCell className="text-right">{w.avgRating ?? "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="clients" className="space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Service mix</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => exportToCSV(serviceMix, "service_mix")}>
                      <Download className="mr-2 h-4 w-4" />
                      Export
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {serviceMix.length === 0 ? (
                      <p className="text-muted-foreground py-8 text-center">No services delivered in this period</p>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Care service</TableHead>
                              <TableHead className="text-right">Shifts</TableHead>
                              <TableHead className="text-right">Hours</TableHead>
                              <TableHead className="text-right">Share</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {serviceMix.map((m) => (
                              <TableRow key={m.service}>
                                <TableCell className="font-medium">{m.service}</TableCell>
                                <TableCell className="text-right">{m.shifts}</TableCell>
                                <TableCell className="text-right">{m.hours}</TableCell>
                                <TableCell className="text-right">
                                  {stats.totalShifts ? ((m.shifts / stats.totalShifts) * 100).toFixed(0) : 0}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="performance" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Performance Metrics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Completion Rate</span>
                        <span className="text-lg font-bold">
                          {stats.totalShifts > 0 
                            ? `${((stats.completedShifts / stats.totalShifts) * 100).toFixed(1)}%`
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Coverage Rate</span>
                        <span className="text-lg font-bold">{stats.coverageRate.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Unfilled Shifts</span>
                        <span className="text-lg font-bold">{stats.unassignedShifts}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Avg Hours per Shift</span>
                        <span className="text-lg font-bold">
                          {stats.totalShifts > 0 
                            ? `${(stats.totalHours / stats.totalShifts).toFixed(1)} hrs`
                            : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Active Utilization</span>
                        <span className="text-lg font-bold">
                          {stats.activeCaregivers > 0 && stats.totalShifts > 0
                            ? `${((stats.completedShifts / stats.activeCaregivers)).toFixed(1)} shifts/caregiver`
                            : "N/A"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
};

export default Reports;
