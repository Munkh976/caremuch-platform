import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Loader2, MapPin, RefreshCw, Search, User } from "lucide-react";
import { toast } from "sonner";
import { assignShift } from "@/lib/shiftAssignment";
import { evaluateEligibility, loadEligibilityRules, type EligibilityResult } from "@/lib/shiftEligibility";
import { EligibilityReport } from "@/components/schedule/EligibilityReport";
import { queueNotification } from "@/lib/notifications";

const STAFF_ROLES = ["manager", "agency_admin", "system_admin", "scheduler"];

type TabKey = "board" | "approval" | "history";

const hhmm = (t?: string | null) => (t || "").slice(0, 5);

const ShiftTrades = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("board");
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<any[]>([]);
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<any | null>(null);
  const [takerId, setTakerId] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const [managerNote, setManagerNote] = useState("");
  const [saving, setSaving] = useState(false);

  const isStaff = role !== null && STAFF_ROLES.includes(role);

  const fetchTrades = useCallback(async () => {
    const { data, error } = await supabase
      .from("shift_trades")
      .select(
        `*,
         shifts:shift_id (
           id, shift_date, start_time, end_time, duration_hours, care_type_code,
           required_skills, client_id, status, order_title, pay_rate, agency_id,
           clients ( first_name, last_name, city, zip_code )
         ),
         original_caregiver:original_caregiver_id ( id, first_name, last_name, email ),
         new_caregiver:new_caregiver_id ( id, first_name, last_name, email )`
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Could not load the trade board");
      setTrades([]);
    } else {
      setTrades(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      const [{ data: roleData }, { data: profile }] = await Promise.all([
        supabase.rpc("get_user_role", { _user_id: user.id }),
        supabase.from("profiles").select("agency_id").eq("id", user.id).maybeSingle(),
      ]);
      // Route guard: the full agency-wide trade board (approval queue, history, every
      // caregiver's drop reasons) is staff-only. This page previously had no role check
      // at all -- a caregiver could reach it directly by URL even after the sidebar link
      // is removed. Caregivers get their own scoped view on /available-shifts instead.
      if (!STAFF_ROLES.includes((roleData as string) ?? "")) {
        navigate("/available-shifts", { replace: true });
        return;
      }
      setRole((roleData as string) ?? null);
      setAgencyId(profile?.agency_id ?? null);
      if (profile?.agency_id) {
        const { data: cgs } = await supabase
          .from("caregivers")
          .select("id, first_name, last_name, email, hourly_rate")
          .eq("agency_id", profile.agency_id)
          .eq("is_active", true)
          .order("first_name");
        setCaregivers(cgs || []);
      }
      fetchTrades();
    })();
    const channel = supabase
      .channel("shift-trades")
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_trades" }, () => fetchTrades())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [navigate, fetchTrades]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trades.filter((t) => {
      const inTab =
        tab === "board"
          ? t.status === "pending" && !t.requires_manager_approval
          : tab === "approval"
          ? t.status === "pending" && t.requires_manager_approval
          : t.status !== "pending";
      if (!inTab) return false;
      if (!q) return true;
      const client = t.shifts?.clients;
      const hay = [
        t.shifts?.order_title,
        t.shifts?.care_type_code,
        client ? `${client.first_name} ${client.last_name}` : "",
        client?.city,
        t.original_caregiver ? `${t.original_caregiver.first_name} ${t.original_caregiver.last_name}` : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [trades, tab, search]);

  const counts = useMemo(
    () => ({
      board: trades.filter((t) => t.status === "pending" && !t.requires_manager_approval).length,
      approval: trades.filter((t) => t.status === "pending" && t.requires_manager_approval).length,
    }),
    [trades]
  );

  const openPickup = (trade: any) => {
    setActive(trade);
    setTakerId("");
    setResult(null);
    setManagerNote("");
  };

  useEffect(() => {
    if (!active?.shifts || !takerId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setChecking(true);
      const rules = await loadEligibilityRules(active.shifts.agency_id ?? agencyId);
      const r = await evaluateEligibility({ caregiverId: takerId, shift: active.shifts, rules });
      if (!cancelled) setResult(r);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, takerId, agencyId]);

  const completeTrade = async (opts: { managerOverride?: boolean }) => {
    if (!active?.shifts || !takerId || !result) return;
    if (!result.eligible && !opts.managerOverride) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const needsApproval = !result.autoApprovable;
      if (needsApproval && !isStaff) {
        const { error } = await supabase
          .from("shift_trades")
          .update({
            new_caregiver_id: takerId,
            requires_manager_approval: true,
            approval_reasons: [...result.blockers, ...result.flags].map((i) => i.label),
            eligibility_snapshot: result as never,
          } as never)
          .eq("id", active.id);
        if (error) throw error;
        toast.success("Sent to your manager for approval");
        setActive(null);
        fetchTrades();
        return;
      }
      await assignShift({
        shiftId: active.shifts.id,
        caregiverId: takerId,
        careTypeCode: active.shifts.care_type_code,
        startTime: hhmm(active.shifts.start_time),
        endTime: hhmm(active.shifts.end_time),
        method: "traded",
        notes: managerNote || null,
      } as never);
      const { error } = await supabase
        .from("shift_trades")
        .update({
          new_caregiver_id: takerId,
          status: "accepted",
          auto_approved: result.autoApprovable,
          requires_manager_approval: false,
          approval_reasons: [...result.blockers, ...result.flags].map((i) => i.label),
          eligibility_snapshot: result as never,
          decided_by: user?.id ?? null,
          decision_notes: managerNote || null,
          resolved_at: new Date().toISOString(),
        } as never)
        .eq("id", active.id);
      if (error) throw error;
      const taker = caregivers.find((c) => c.id === takerId);
      if (taker?.email) {
        await queueNotification({
          agencyId,
          recipientEmail: taker.email,
          recipientName: `${taker.first_name} ${taker.last_name}`,
          kind: "shift_trade_accepted",
          subject: "You picked up a shift",
          body: `You are now assigned to ${active.shifts.order_title} on ${active.shifts.shift_date} from ${hhmm(
            active.shifts.start_time
          )} to ${hhmm(active.shifts.end_time)}.`,
          payload: { shift_id: active.shifts.id, trade_id: active.id },
        });
      }
      toast.success(result.autoApprovable ? "Trade completed automatically" : "Trade approved and assigned");
      setActive(null);
      fetchTrades();
    } catch (e: any) {
      toast.error(e.message || "Could not complete the trade");
    } finally {
      setSaving(false);
    }
  };

  const declineTrade = async (trade: any) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("shift_trades")
      .update({
        status: "declined",
        decided_by: user?.id ?? null,
        resolved_at: new Date().toISOString(),
      } as never)
      .eq("id", trade.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Trade declined");
      fetchTrades();
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Trade Board</h1>
            <p className="text-muted-foreground mt-1">
              Caregivers who pass every rule pick up shifts instantly. Anything else lands in the approval queue.
            </p>
          </div>
          <Button variant="outline" onClick={fetchTrades}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              <TabsTrigger value="board">Open board{counts.board ? ` (${counts.board})` : ""}</TabsTrigger>
              <TabsTrigger value="approval">
                Needs approval{counts.approval ? ` (${counts.approval})` : ""}
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search client, caregiver, service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nothing here right now</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((trade) => {
              const s = trade.shifts;
              const client = s?.clients;
              return (
                <Card key={trade.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg">{s?.order_title || "Shift"}</CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-3 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {s?.shift_date}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {hhmm(s?.start_time)}–{hhmm(s?.end_time)} ({s?.duration_hours}h)
                          </span>
                          {client?.city && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {client.city}
                            </span>
                          )}
                        </CardDescription>
                      </div>
                      <Badge variant={trade.status === "pending" ? "outline" : "secondary"}>{trade.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {client ? `${client.first_name} ${client.last_name}` : "Client"}
                      <Badge variant="outline" className="text-xs">
                        {s?.care_type_code}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Given up by {trade.original_caregiver?.first_name} {trade.original_caregiver?.last_name}
                      {trade.reason ? ` — ${trade.reason}` : ""}
                    </p>
                    {trade.approval_reasons?.length > 0 && trade.status === "pending" && (
                      <div className="flex flex-wrap gap-1">
                        {trade.approval_reasons.map((r: string) => (
                          <Badge key={r} variant="outline" className="text-[10px] border-warning/40 text-warning">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {trade.new_caregiver && (
                      <p className="text-xs">
                        Requested by{" "}
                        <span className="font-medium">
                          {trade.new_caregiver.first_name} {trade.new_caregiver.last_name}
                        </span>
                      </p>
                    )}
                    {trade.status === "pending" && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={() => openPickup(trade)} disabled={!s}>
                          {tab === "approval" ? "Review" : "Pick up"}
                        </Button>
                        {isStaff && (
                          <Button size="sm" variant="outline" onClick={() => declineTrade(trade)}>
                            Decline
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Pick up shift</DialogTitle>
            <DialogDescription>
              {active?.shifts?.shift_date} · {hhmm(active?.shifts?.start_time)}–{hhmm(active?.shifts?.end_time)} ·{" "}
              {active?.shifts?.order_title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Caregiver taking this shift</Label>
              <Select value={takerId} onValueChange={setTakerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select caregiver" />
                </SelectTrigger>
                <SelectContent>
                  {caregivers
                    .filter((c) => c.id !== active?.original_caregiver_id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {checking && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Running eligibility checks…
              </div>
            )}
            {result && !checking && <EligibilityReport result={result} />}

            {result && !result.autoApprovable && isStaff && (
              <div className="space-y-2">
                <Label htmlFor="mnote">Manager override reason</Label>
                <Textarea
                  id="mnote"
                  rows={2}
                  value={managerNote}
                  onChange={(e) => setManagerNote(e.target.value)}
                  placeholder="Why are you approving this despite the warnings?"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => completeTrade({ managerOverride: isStaff })}
              disabled={
                saving ||
                !result ||
                checking ||
                (!result.eligible && !isStaff) ||
                (isStaff && !result.autoApprovable && managerNote.trim().length === 0)
              }
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {result?.autoApprovable ? "Confirm pickup" : isStaff ? "Approve & assign" : "Send for manager approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default ShiftTrades;