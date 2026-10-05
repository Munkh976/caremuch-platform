import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  Radio,
  Users,
  UserCheck,
} from "lucide-react";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
} from "date-fns";
import { toast } from "sonner";
import { ShiftDetailsDialog } from "@/components/schedule/ShiftDetailsDialog";
import { AssignShiftDialog } from "@/components/schedule/AssignShiftDialog";
import { ShiftsListView } from "@/components/schedule/ShiftsListView";
import { UnassignedShiftsView } from "@/components/schedule/UnassignedShiftsView";
import { CaregiverGridView } from "@/components/schedule/CaregiverGridView";
import { ClientGridView } from "@/components/schedule/ClientGridView";
import { PickShiftDialog } from "@/components/schedule/PickShiftDialog";
import { LiveOpsView } from "@/components/schedule/LiveOpsView";
import { SmartAssignSheet } from "@/components/schedule/SmartAssignSheet";
import { AutoFillDialog } from "@/components/schedule/AutoFillDialog";
import { useCareServices } from "@/hooks/useCareServices";

const CATEGORY_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 76%, 36%)",
  "hsl(0, 84%, 60%)",
  "hsl(262, 83%, 58%)",
  "hsl(38, 92%, 50%)",
  "hsl(330, 81%, 60%)",
];

type RangeMode = "day" | "week" | "month";
type TabKey = "today" | "shifts" | "unassigned" | "caregivers" | "clients";

const TAB_KEYS: TabKey[] = ["today", "shifts", "unassigned", "caregivers", "clients"];

const getRange = (date: Date, mode: RangeMode) => {
  if (mode === "day") return { start: startOfDay(date), end: endOfDay(date) };
  if (mode === "month") return { start: startOfMonth(date), end: endOfMonth(date) };
  return { start: startOfWeek(date), end: endOfWeek(date) };
};

const Schedule = () => {
  const { categoryNames } = useCareServices();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<any[]>([]);
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const initialTab = (searchParams.get("tab") as TabKey) || "shifts";
  const [tab, setTab] = useState<TabKey>(
    TAB_KEYS.includes(initialTab) ? initialTab : "shifts"
  );
  const [rangeMode, setRangeMode] = useState<RangeMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Optional ?client=<id> (deep link from the care-plan screens): narrows the list to one client. Absent = unchanged page.
  const clientFilter = searchParams.get("client");

  const [selectedShift, setSelectedShift] = useState<any>(null);
  const [shiftToAssign, setShiftToAssign] = useState<any>(null);
  const [assignDefaultCaregiver, setAssignDefaultCaregiver] = useState<string | null>(null);
  const [pickForCaregiver, setPickForCaregiver] = useState<any>(null);
  const [smartAssignShift, setSmartAssignShift] = useState<any>(null);
  const [autoFillOpen, setAutoFillOpen] = useState(false);

  const fetchScheduleData = useCallback(
    async (agency: string) => {
      try {
        setLoading(true);
        const { start, end } = getRange(currentDate, rangeMode);

        const { data: shiftsData, error } = await supabase
          .from("shifts")
          .select(
            `*, clients ( first_name, last_name, phone, address, city, state, zip_code, care_requirements ), care_types ( name, code, category )`
          )
          .eq("agency_id", agency)
          .gte("shift_date", format(start, "yyyy-MM-dd"))
          .lte("shift_date", format(end, "yyyy-MM-dd"))
          .order("shift_date", { ascending: true })
          .order("start_time", { ascending: true });
        if (error) throw error;
        setShifts(shiftsData || []);

        const shiftIds = (shiftsData || []).map((s) => s.id);
        if (shiftIds.length) {
          const { data: assignmentsData } = await supabase
            .from("shift_assignments")
            .select("*")
            .in("shift_id", shiftIds);
          setShiftAssignments(assignmentsData || []);
        } else {
          setShiftAssignments([]);
        }

        const [{ data: caregiversData }, { data: clientsData }] = await Promise.all([
          supabase
            .from("caregivers")
            .select("*")
            .eq("agency_id", agency)
            .eq("is_active", true)
            .order("first_name"),
          supabase.from("clients").select("*").eq("agency_id", agency).order("first_name"),
        ]);
        setCaregivers(caregiversData || []);
        setClients(clientsData || []);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load schedule");
      } finally {
        setLoading(false);
      }
    },
    [currentDate, rangeMode]
  );

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      const { data: profileData } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", session.user.id)
        .maybeSingle();
      if (profileData?.agency_id) {
        setAgencyId(profileData.agency_id);
        await fetchScheduleData(profileData.agency_id);
      } else {
        setLoading(false);
      }
    };
    init();
  }, [fetchScheduleData, navigate]);

  const changeTab = (value: string) => {
    const next = (TAB_KEYS.includes(value as TabKey) ? value : "shifts") as TabKey;
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const refresh = () => {
    if (agencyId) fetchScheduleData(agencyId);
  };

  const goToPrevious = () => {
    if (rangeMode === "day") setCurrentDate(subDays(currentDate, 1));
    else if (rangeMode === "month") setCurrentDate(subMonths(currentDate, 1));
    else setCurrentDate(subWeeks(currentDate, 1));
  };

  const goToNext = () => {
    if (rangeMode === "day") setCurrentDate(addDays(currentDate, 1));
    else if (rangeMode === "month") setCurrentDate(addMonths(currentDate, 1));
    else setCurrentDate(addWeeks(currentDate, 1));
  };

  const rangeDays = useMemo(() => {
    const { start, end } = getRange(currentDate, rangeMode);
    return eachDayOfInterval({ start, end });
  }, [currentDate, rangeMode]);

  const rangeLabel = useMemo(() => {
    if (rangeMode === "day") return format(currentDate, "EEEE, MMM d, yyyy");
    if (rangeMode === "month") return format(currentDate, "MMMM yyyy");
    return `${format(startOfWeek(currentDate), "MMM d")} - ${format(
      endOfWeek(currentDate),
      "MMM d, yyyy"
    )}`;
  }, [currentDate, rangeMode]);

  const categoryStyles = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {};
    categoryNames.forEach((name, i) => {
      map[name] = { name, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] };
    });
    return map;
  }, [categoryNames]);

  const getCategoryForShift = useCallback(
    (shift: any) => {
      const category = shift?.care_types?.category;
      return (
        categoryStyles[category] || {
          name: category || "Uncategorized",
          color: "hsl(var(--muted-foreground))",
        }
      );
    },
    [categoryStyles]
  );

  const getAssignedCaregiver = useCallback(
    (shift: any) => {
      const assignment = shiftAssignments.find(
        (a) => a.shift_id === shift.id && a.status !== "cancelled"
      );
      if (!assignment?.caregiver_id) return null;
      return caregivers.find((c) => c.id === assignment.caregiver_id) || null;
    },
    [shiftAssignments, caregivers]
  );


  const filteredShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (categoryFilter !== "all" && s.care_types?.category !== categoryFilter) return false;
      if (statusFilter !== "all" && (s.status || "open") !== statusFilter) return false;
      if (clientFilter && s.client_id !== clientFilter) return false;
      return true;
    });
  }, [shifts, categoryFilter, statusFilter, clientFilter]);

  const unassignedShifts = useMemo(
    () => filteredShifts.filter((s) => !getAssignedCaregiver(s)),
    [filteredShifts, getAssignedCaregiver]
  );

  const allUnassignedInRange = useMemo(
    () => shifts.filter((s) => !getAssignedCaregiver(s)),
    [shifts, getAssignedCaregiver]
  );

  const openAssign = (shift: any, caregiverId?: string | null) => {
    setAssignDefaultCaregiver(caregiverId || null);
    setShiftToAssign(shift);
  };

  const stats = useMemo(
    () => ({
      total: filteredShifts.length,
      assigned: filteredShifts.length - unassignedShifts.length,
      unassigned: unassignedShifts.length,
      hours: filteredShifts.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0),
    }),
    [filteredShifts, unassignedShifts]
  );

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Schedule Management</h1>
            <p className="text-muted-foreground">
              Plan shifts, fill gaps and balance caregiver workload.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border p-1">
              {(["day", "week", "month"] as RangeMode[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={rangeMode === m ? "default" : "ghost"}
                  onClick={() => setRangeMode(m)}
                  className="capitalize"
                >
                  {m}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={goToPrevious} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={goToNext} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-medium">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {rangeLabel}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{stats.total} shifts</Badge>
              <Badge variant="outline" className="gap-1">
                <UserCheck className="h-3 w-3" />
                {stats.assigned} assigned
              </Badge>
              <Badge variant="outline" className="gap-1 border-warning text-warning">
                <AlertTriangle className="h-3 w-3" />
                {stats.unassigned} unassigned
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                {stats.hours}h
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="All care services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All care services</SelectItem>
                  {categoryNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              {clientFilter && (
                <Badge variant="secondary" className="gap-1" data-testid="client-filter">
                  {(() => { const c = clients.find((x) => x.id === clientFilter); return c ? `Client: ${[c.first_name, c.last_name].filter(Boolean).join(" ")}` : "One client"; })()}
                  <button type="button" className="ml-1 underline" onClick={() => { const p = new URLSearchParams(searchParams); p.delete("client"); setSearchParams(p, { replace: true }); }}>Clear</button>
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="py-20 text-center text-muted-foreground">Loading schedule...</div>
        ) : (
          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList>
              <TabsTrigger value="today" className="gap-2">
                <Radio className="h-4 w-4" />
                Today (Live)
              </TabsTrigger>
              <TabsTrigger value="shifts" className="gap-2">
                <List className="h-4 w-4" />
                Shifts
              </TabsTrigger>
              <TabsTrigger value="unassigned" className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                Unassigned
                {stats.unassigned > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {stats.unassigned}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="caregivers" className="gap-2">
                <Users className="h-4 w-4" />
                By Caregiver
              </TabsTrigger>
              <TabsTrigger value="clients" className="gap-2">
                <UserCheck className="h-4 w-4" />
                By Client
              </TabsTrigger>
            </TabsList>

            <TabsContent value="today" className="mt-6">
              <LiveOpsView agencyId={agencyId} onAssign={(shift) => setSmartAssignShift(shift)} />
            </TabsContent>

            <TabsContent value="shifts" className="mt-6">
              <ShiftsListView
                shifts={filteredShifts}
                days={rangeDays}
                getAssignedCaregiver={getAssignedCaregiver}
                getCategoryForShift={getCategoryForShift}
                onSelectShift={setSelectedShift}
                onQuickAssign={(shiftId: string) => {
                  const shift = shifts.find((s) => s.id === shiftId);
                  if (shift) openAssign(shift);
                }}
              />
            </TabsContent>

            <TabsContent value="unassigned" className="mt-6">
              <UnassignedShiftsView
                shifts={unassignedShifts}
                getCategoryForShift={getCategoryForShift}
                onSelectShift={setSelectedShift}
                onAssign={(shift) => openAssign(shift)}
                onSmartAssign={(shift) => setSmartAssignShift(shift)}
                onAutoFill={() => setAutoFillOpen(true)}
              />
            </TabsContent>

            <TabsContent value="caregivers" className="mt-6">
              <CaregiverGridView
                caregivers={caregivers}
                shifts={filteredShifts}
                getAssignedCaregiver={getAssignedCaregiver}
                onSelectShift={setSelectedShift}
                onAssignShiftFor={(cg) => setPickForCaregiver(cg)}
              />
            </TabsContent>

            <TabsContent value="clients" className="mt-6">
              <ClientGridView
                clients={clients}
                shifts={filteredShifts}
                getAssignedCaregiver={getAssignedCaregiver}
                onSelectShift={setSelectedShift}
                onAssign={(shift) => openAssign(shift)}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <ShiftDetailsDialog
        shift={selectedShift}
        open={!!selectedShift}
        onOpenChange={(open) => !open && setSelectedShift(null)}
        onAssign={(shift) => {
          setSelectedShift(null);
          openAssign(shift);
        }}
      />

      <PickShiftDialog
        open={!!pickForCaregiver}
        onOpenChange={(open) => !open && setPickForCaregiver(null)}
        caregiver={pickForCaregiver}
        shifts={allUnassignedInRange}
        onPick={(shift) => {
          const caregiverId = pickForCaregiver?.id || null;
          setPickForCaregiver(null);
          openAssign(shift, caregiverId);
        }}
      />

      <SmartAssignSheet
        open={!!smartAssignShift}
        onOpenChange={(open) => !open && setSmartAssignShift(null)}
        shift={smartAssignShift}
        onAssigned={() => {
          setSmartAssignShift(null);
          refresh();
        }}
      />

      <AutoFillDialog
        open={autoFillOpen}
        onOpenChange={setAutoFillOpen}
        shifts={unassignedShifts}
        rangeLabel={rangeLabel}
        onCommitted={refresh}
      />

      <AssignShiftDialog
        open={!!shiftToAssign}
        onOpenChange={(open) => {
          if (!open) {
            setShiftToAssign(null);
            setAssignDefaultCaregiver(null);
          }
        }}
        shift={shiftToAssign}
        defaultCaregiverId={assignDefaultCaregiver}
        onAssigned={() => {
          setShiftToAssign(null);
          setAssignDefaultCaregiver(null);
          refresh();
        }}
      />
    </AppLayout>
  );
};

export default Schedule;
