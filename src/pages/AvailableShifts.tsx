import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, MapPin, DollarSign, Filter, Search, ArrowLeftRight, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ShiftDetailsDialog } from "@/components/schedule/ShiftDetailsDialog";
import { AppLayout } from "@/components/AppLayout";
import { pickUpShift } from "@/lib/shiftAssignment";
import { fetchCaregiverVisibleClients, type CaregiverVisibleClient } from "@/lib/caregiverVisibleClients";
import {
  fetchCaregiverTradeShifts,
  fetchCaregiverShiftsEligibility,
  fetchMyTradeRequests,
  pickUpTradeShift,
  type CaregiverTradeShift,
  type MyTradeRequest,
} from "@/lib/caregiverBoard";
import type { EligibilityResult } from "@/lib/shiftEligibility";

interface OpenShift {
  id: string;
  client_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  care_type_code: string;
  pay_rate: number | null;
  special_instructions: string | null;
  clients: CaregiverVisibleClient | null;
}

const getCareTypeLabel = (code: string) =>
  (code || "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const TRADE_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for someone to pick it up",
  accepted: "Picked up",
  declined: "Declined by a manager",
  cancelled: "Cancelled",
  expired: "Expired",
};

const AvailableShifts = () => {
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [tradeShifts, setTradeShifts] = useState<(CaregiverTradeShift & { clients: CaregiverVisibleClient | null })[]>([]);
  const [myTradeRequests, setMyTradeRequests] = useState<MyTradeRequest[]>([]);
  const [eligibility, setEligibility] = useState<Map<string, EligibilityResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [selectedShift, setSelectedShift] = useState<any>(null);
  const [pickingUp, setPickingUp] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please log in to view shifts");
        return;
      }

      const { data: caregiverData } = await supabase
        .from("caregivers")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!caregiverData) return;

      // Open Shifts: genuinely unassigned shifts, RLS-scoped to this caregiver's own
      // office (Phase 1B policy). clients is NOT embedded -- caregivers have no RLS
      // SELECT on public.clients at all; fetch the narrow, caregiver-safe view
      // separately and merge by client_id (see src/lib/caregiverVisibleClients.ts).
      const { data: openData, error: openError } = await supabase
        .from("shifts")
        .select("*")
        .eq("status", "open")
        .gte("shift_date", format(new Date(), "yyyy-MM-dd"))
        .order("shift_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (openError) throw openError;

      // Trade Shifts: a genuinely different mechanism (shift stays assigned to the
      // caregiver giving it up; a separate shift_trades row advertises it) -- its own
      // function, its own list, never merged with the query above.
      const tradeData = await fetchCaregiverTradeShifts();

      const [visibleClients, myRequests] = await Promise.all([
        fetchCaregiverVisibleClients(),
        fetchMyTradeRequests(caregiverData.id),
      ]);

      const mergedOpen = (openData || []).map((s: any) => ({
        ...s,
        clients: visibleClients.get(s.client_id) || null,
      }));
      const mergedTrade = tradeData.map((t) => ({
        ...t,
        clients: visibleClients.get(t.client_id) || null,
      }));

      setOpenShifts(mergedOpen);
      setTradeShifts(mergedTrade);
      setMyTradeRequests(myRequests);

      const allShiftIds = [...mergedOpen.map((s) => s.id), ...mergedTrade.map((t) => t.shift_id)];
      setEligibility(await fetchCaregiverShiftsEligibility(allShiftIds));
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to load shifts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickUpOpen = async (shiftId: string) => {
    setPickingUp(`open:${shiftId}`);
    try {
      await pickUpShift(shiftId);
      toast.success("Shift picked up");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Could not pick up this shift");
    } finally {
      setPickingUp(null);
    }
  };

  const handlePickUpTrade = async (trade: CaregiverTradeShift) => {
    setPickingUp(`trade:${trade.trade_id}`);
    try {
      const result = await pickUpTradeShift(trade.trade_id);
      toast.success(result.status === "sent_for_approval" ? "Sent to your manager for approval" : "Shift picked up");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "Could not pick up this trade shift");
    } finally {
      setPickingUp(null);
    }
  };

  const matchesFilters = (clients: CaregiverVisibleClient | null, careTypeCode: string, shiftDate: string) => {
    const q = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !q ||
      clients?.first_name?.toLowerCase().includes(q) ||
      clients?.last_name?.toLowerCase().includes(q) ||
      clients?.city?.toLowerCase().includes(q) ||
      getCareTypeLabel(careTypeCode).toLowerCase().includes(q);
    const matchesDate = !filterDate || shiftDate === filterDate;
    return matchesSearch && matchesDate;
  };

  // Eligible-now first within each section; Trade also separates out needs-approval
  // before not-eligible. Open has no middle tier -- soft issues no longer block pickup.
  const filteredOpen = useMemo(() => {
    return openShifts
      .filter((s) => matchesFilters(s.clients, s.care_type_code, s.shift_date))
      .sort((a, b) => {
        const ea = eligibility.get(a.id)?.eligible !== false;
        const eb = eligibility.get(b.id)?.eligible !== false;
        return ea === eb ? 0 : ea ? -1 : 1;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openShifts, eligibility, searchTerm, filterDate]);

  const filteredTrade = useMemo(() => {
    const rank = (shiftId: string) => {
      const e = eligibility.get(shiftId);
      if (!e || e.eligible === false) return 2;
      return e.autoApprovable ? 0 : 1;
    };
    return tradeShifts
      .filter((t) => matchesFilters(t.clients, t.care_type_code, t.shift_date))
      .sort((a, b) => rank(a.shift_id) - rank(b.shift_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeShifts, eligibility, searchTerm, filterDate]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div>
        <h1 className="text-3xl font-bold mb-2">Available Shifts</h1>
        <p className="text-muted-foreground mb-6">Pick up extra shifts to increase your earnings</p>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by client, location, or care service..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="pl-9" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ===== Trade Shifts (top -- more time-sensitive: someone is actively trying to give this up) ===== */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">Trade Shifts</h2>
            <span className="text-sm text-muted-foreground">
              {filteredTrade.length} shift{filteredTrade.length !== 1 ? "s" : ""} from colleagues
            </span>
          </div>
          {filteredTrade.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No trade shifts right now.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredTrade.map((t) => {
                const elig = eligibility.get(t.shift_id);
                const blocked = !elig || elig.eligible === false;
                const needsApproval = !blocked && elig && !elig.autoApprovable;
                return (
                  <Card
                    key={t.trade_id}
                    className="hover:shadow-lg transition-shadow cursor-pointer"
                    onClick={() =>
                      setSelectedShift({
                        id: t.shift_id,
                        client_id: t.client_id,
                        clients: t.clients,
                        care_type_code: t.care_type_code,
                        shift_date: t.shift_date,
                        start_time: t.start_time,
                        end_time: t.end_time,
                        duration_hours: t.duration_hours,
                        order_title: t.order_title,
                        // Not yet this caregiver's shift -- treat like an open preview so
                        // ShiftDetailsDialog hides the client's phone until actually picked up.
                        status: "open",
                      })
                    }
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-3 gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <h3 className="text-xl font-semibold">
                              {t.clients?.first_name || "Unknown"} {t.clients?.last_name || ""}
                            </h3>
                            <Badge variant="secondary">Trade</Badge>
                            {blocked && <Badge variant="destructive">Not eligible</Badge>}
                            {needsApproval && <Badge variant="outline" className="border-warning/40 text-warning">Needs approval</Badge>}
                          </div>
                          <Badge variant="outline" className="mb-2">
                            {getCareTypeLabel(t.care_type_code)}
                          </Badge>
                          <p className="text-xs text-muted-foreground">
                            Given up by {t.original_caregiver_first_name} {t.original_caregiver_last_name}
                            {t.reason ? ` — ${t.reason}` : ""}
                          </p>
                        </div>
                        <Button
                          disabled={pickingUp === `trade:${t.trade_id}` || blocked}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePickUpTrade(t);
                          }}
                        >
                          {pickingUp === `trade:${t.trade_id}`
                            ? "Picking up…"
                            : needsApproval
                            ? "Request pickup"
                            : "Pick up trade"}
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          <span>{format(new Date(`${t.shift_date}T00:00:00`), "MMM d, yyyy")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span>{t.start_time.slice(0, 5)} - {t.end_time.slice(0, 5)}</span>
                        </div>
                        {t.clients?.city && (
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span>{t.clients.city}</span>
                          </div>
                        )}
                      </div>

                      {blocked && elig && (
                        <div className="mt-2 text-xs text-destructive space-y-0.5">
                          {elig.blockers.filter((b) => !b.overridable).map((b) => (
                            <p key={b.code}>• {b.detail}</p>
                          ))}
                        </div>
                      )}
                      {needsApproval && elig && (
                        <div className="mt-2 text-xs text-warning space-y-0.5">
                          {elig.overridable.map((b) => (
                            <p key={b.code}>• {b.detail}</p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ===== Open Shifts ===== */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">Open Shifts</h2>
            <span className="text-sm text-muted-foreground">
              {filteredOpen.length} shift{filteredOpen.length !== 1 ? "s" : ""} available
            </span>
          </div>
          {filteredOpen.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Calendar className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No shifts available</h3>
                <p className="text-muted-foreground">
                  {searchTerm || filterDate ? "Try adjusting your filters" : "Check back later for new opportunities"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredOpen.map((shift) => {
                const elig = eligibility.get(shift.id);
                const blocked = !!elig && elig.eligible === false;
                const softIssues = elig?.overridable || [];
                return (
                  <Card
                    key={shift.id}
                    className="hover:shadow-lg transition-shadow cursor-pointer"
                    onClick={() => setSelectedShift(shift)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-semibold">
                              {shift.clients?.first_name || "Unknown"} {shift.clients?.last_name || ""}
                            </h3>
                            {blocked && <Badge variant="destructive">Not eligible</Badge>}
                          </div>
                          <Badge variant="outline" className="mb-3">
                            {getCareTypeLabel(shift.care_type_code)}
                          </Badge>
                        </div>
                        <Button
                          disabled={pickingUp === `open:${shift.id}` || blocked}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePickUpOpen(shift.id);
                          }}
                        >
                          {pickingUp === `open:${shift.id}` ? "Picking up…" : "Pick Up Shift"}
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          <span>{format(new Date(`${shift.shift_date}T00:00:00`), "MMM d, yyyy")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span>{shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}</span>
                        </div>
                        {shift.clients?.city && (
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span>{shift.clients.city}</span>
                          </div>
                        )}
                        {shift.pay_rate && (
                          <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                            <DollarSign className="w-4 h-4" />
                            <span>
                              ${shift.pay_rate}/hr · ${(shift.pay_rate * shift.duration_hours).toFixed(2)} total
                            </span>
                          </div>
                        )}
                      </div>

                      {shift.special_instructions && (
                        <div className="mt-3 p-3 bg-muted rounded-lg">
                          <p className="text-sm text-muted-foreground">
                            <strong>Special Instructions:</strong> {shift.special_instructions}
                          </p>
                        </div>
                      )}

                      {blocked && elig && (
                        <div className="mt-3 text-xs text-destructive space-y-0.5">
                          {elig.blockers.filter((b) => !b.overridable).map((b) => (
                            <p key={b.code}>• {b.detail}</p>
                          ))}
                        </div>
                      )}
                      {!blocked && softIssues.length > 0 && (
                        <div className="mt-3 text-xs text-warning space-y-0.5">
                          <p className="font-medium">Heads up:</p>
                          {softIssues.map((b) => (
                            <p key={b.code}>• {b.detail}</p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ===== My Trade Requests -- always shown, even empty, so the feature is discoverable ===== */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">My Trade Requests</h2>
          </div>
          <Card>
            <CardContent className="p-4">
              {myTradeRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active trade requests.</p>
              ) : (
                <div className="space-y-2">
                  {myTradeRequests.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                      <div>
                        <span className="font-medium">
                          {r.shifts ? format(new Date(`${r.shifts.shift_date}T00:00:00`), "MMM d, yyyy") : "Shift"}
                        </span>
                        {r.shifts && (
                          <span className="text-muted-foreground">
                            {" "}
                            {r.shifts.start_time.slice(0, 5)}–{r.shifts.end_time.slice(0, 5)}
                          </span>
                        )}
                      </div>
                      <Badge variant={r.status === "accepted" ? "secondary" : r.status === "pending" ? "outline" : "outline"}>
                        {TRADE_STATUS_LABEL[r.status] || r.status}
                        {r.status === "accepted" && r.new_caregiver ? ` — ${r.new_caregiver.first_name} ${r.new_caregiver.last_name}` : ""}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <ShiftDetailsDialog shift={selectedShift} open={!!selectedShift} onOpenChange={(open) => !open && setSelectedShift(null)} />
      </div>
    </AppLayout>
  );
};

export default AvailableShifts;
