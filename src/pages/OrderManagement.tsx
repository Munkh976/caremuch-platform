import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus, User, Search, Archive, ArchiveRestore, Eye, ChevronDown, ChevronUp,
  Package, Loader2, Edit,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  addWeeks, addMonths, addYears, subWeeks, subMonths, subYears,
} from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { OrderWizardDialog } from "@/components/orders/OrderWizardDialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useCareServices } from "@/hooks/useCareServices";
import { DAY_NAMES } from "@/lib/orderScheduling";

type Order = {
  id: string;
  order_number: string;
  client_id: string;
  start_date: string;
  end_date: string;
  duration_months?: number | null;
  frequency: string;
  status: string;
  notes?: string;
  archived_at?: string | null;
  created_at: string;
  clients?: { first_name: string; last_name: string };
  shift_count?: number;
  service_lines?: any[];
};

const OrderManagement = () => {
  const navigate = useNavigate();
  const { byCode } = useCareServices();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [orderShifts, setOrderShifts] = useState<Record<string, any[]>>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scope, setScope] = useState<"active" | "completed" | "archived" | "all">("active");
  const [view, setView] = useState<"week" | "month" | "year">("month");
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
      const { data: profileData } = await supabase
        .from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (profileData) {
        setProfile(profileData);
        fetchOrders(profileData.agency_id);
        fetchClients(profileData.agency_id);
      } else {
        setLoading(false);
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate("/auth");
      else setUser(session.user);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchOrders = async (agencyId: string) => {
    const { data: ordersData, error } = await supabase
      .from("client_orders")
      .select(`*, clients(first_name, last_name)`)
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load care plans");
      setLoading(false);
      return;
    }

    const ids = (ordersData || []).map((o: any) => o.id);
    const { data: lines } = ids.length
      ? await supabase.from("order_services" as never).select("*").in("order_id", ids)
      : { data: [] as any[] };

    const withCounts = await Promise.all(
      (ordersData || []).map(async (order: any) => {
        const { count } = await supabase
          .from("shifts").select("*", { count: "exact", head: true }).eq("order_id", order.id);
        return {
          ...order,
          shift_count: count || 0,
          service_lines: ((lines || []) as any[]).filter((l) => l.order_id === order.id),
        };
      })
    );

    setOrders(withCounts as Order[]);
    setLoading(false);
  };

  const fetchClients = async (agencyId: string) => {
    const { data, error } = await supabase
      .from("clients").select("id, first_name, last_name")
      .eq("agency_id", agencyId).eq("is_active", true).order("first_name");
    if (error) toast.error("Failed to load clients");
    else setClients(data || []);
  };

  const handleArchiveOrder = async (order: Order) => {
    const archiving = !order.archived_at;
    if (archiving && !confirm("Archive this care plan? It stays in the Archived tab with all of its shifts — nothing is deleted.")) return;

    const { error } = await supabase
      .from("client_orders")
      .update({
        archived_at: archiving ? new Date().toISOString() : null,
        archived_by: archiving ? user?.id ?? null : null,
      } as never)
      .eq("id", order.id);

    if (error) toast.error(archiving ? "Failed to archive care plan" : "Failed to restore care plan");
    else {
      toast.success(archiving ? "Care plan archived" : "Care plan restored");
      if (profile?.agency_id) fetchOrders(profile.agency_id);
    }
  };

  const fetchOrderShifts = async (orderId: string) => {
    const { data: shifts } = await supabase
      .from("shifts").select("*").eq("order_id", orderId).order("shift_date");
    if (shifts) setOrderShifts((prev) => ({ ...prev, [orderId]: shifts }));
  };

  const toggleOrderExpand = async (orderId: string) => {
    const next = new Set(expandedOrders);
    if (next.has(orderId)) next.delete(orderId);
    else {
      next.add(orderId);
      if (!orderShifts[orderId]) await fetchOrderShifts(orderId);
    }
    setExpandedOrders(next);
  };

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    const today = new Date().toISOString().split("T")[0];
    const isArchived = (o: Order) => !!o.archived_at;
    const isFinished = (o: Order) =>
      o.status === "completed" || o.status === "cancelled" || o.end_date < today;

    if (scope === "active") filtered = filtered.filter((o) => !isArchived(o) && !isFinished(o));
    else if (scope === "completed") filtered = filtered.filter((o) => !isArchived(o) && isFinished(o));
    else if (scope === "archived") filtered = filtered.filter(isArchived);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          `${o.clients?.first_name} ${o.clients?.last_name}`.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") filtered = filtered.filter((o) => o.status === statusFilter);

    if (scope !== "active") {
      const startDate =
        view === "week" ? startOfWeek(currentDate) : view === "month" ? startOfMonth(currentDate) : startOfYear(currentDate);
      const endDate =
        view === "week" ? endOfWeek(currentDate) : view === "month" ? endOfMonth(currentDate) : endOfYear(currentDate);
      filtered = filtered.filter(
        (o) => new Date(o.start_date) <= endDate && new Date(o.end_date) >= startDate
      );
    }
    return filtered;
  }, [orders, scope, searchQuery, statusFilter, view, currentDate]);

  const lineLabel = (l: any) => {
    const name = byCode.get(l.care_type_code)?.name || l.care_type_code;
    const days = (l.days_of_week || []).map((d: number) => DAY_NAMES[d]).join("/");
    return `${name} · ${days} ${String(l.start_time).slice(0, 5)}–${String(l.end_time).slice(0, 5)} · ${l.frequency}`;
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
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-bold">Care Plans</h2>
            <p className="text-muted-foreground mt-1">
              Care plans with recurring service lines. Shifts are generated unassigned and filled from Schedule.
            </p>
          </div>
          <Button onClick={() => { setEditingOrder(null); setWizardOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Create Care Plan
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-2 mb-4">
              {([
                { key: "active", label: "Active" },
                { key: "completed", label: "Completed" },
                { key: "archived", label: "Archived" },
                { key: "all", label: "All" },
              ] as const).map((tab) => (
                <Button
                  key={tab.key}
                  size="sm"
                  variant={scope === tab.key ? "default" : "outline"}
                  onClick={() => setScope(tab.key)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by plan # or client name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Filter by status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-center gap-2 pb-4 border-b flex-wrap">
              {(["week", "month", "year"] as const).map((v) => (
                <Button key={v} variant={view === v ? "default" : "outline"} onClick={() => setView(v)} className="capitalize">
                  {v}
                </Button>
              ))}
              <div className="w-px h-6 bg-border mx-2" />
              <Button
                variant="outline"
                onClick={() =>
                  setCurrentDate(view === "week" ? subWeeks(currentDate, 1) : view === "month" ? subMonths(currentDate, 1) : subYears(currentDate, 1))
                }
              >
                Previous
              </Button>
              <Button variant="outline" onClick={() => setCurrentDate(new Date())}>Today</Button>
              <Button
                variant="outline"
                onClick={() =>
                  setCurrentDate(view === "week" ? addWeeks(currentDate, 1) : view === "month" ? addMonths(currentDate, 1) : addYears(currentDate, 1))
                }
              >
                Next
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{orders.length}</div>
                <div className="text-sm text-muted-foreground">Total Care Plans</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {(() => {
                    const today = new Date().toISOString().split("T")[0];
                    return orders.filter((o) => o.start_date <= today && o.end_date >= today && o.status !== "draft").length;
                  })()}
                </div>
                <div className="text-sm text-muted-foreground">Active</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{orders.filter((o) => o.status === "draft").length}</div>
                <div className="text-sm text-muted-foreground">Drafts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{orders.reduce((s, o) => s + (o.shift_count || 0), 0)}</div>
                <div className="text-sm text-muted-foreground">Total Shifts</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {filteredOrders.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {orders.length === 0 ? "No care plans found. Create your first care plan to get started." : "No care plans match your filters."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Plan #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Services</TableHead>
                    <TableHead>Shifts</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => (
                    <>
                      <TableRow key={order.id} className="hover:bg-muted/50">
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={() => toggleOrderExpand(order.id)}>
                                {expandedOrders.has(order.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{expandedOrders.has(order.id) ? "Collapse details" : "Expand details"}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="font-medium">{order.order_number}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {order.clients?.first_name} {order.clients?.last_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(`${order.start_date}T00:00:00`), "MMM d")} –{" "}
                          {format(new Date(`${order.end_date}T00:00:00`), "MMM d, yyyy")}
                          {order.duration_months ? (
                            <div className="text-xs text-muted-foreground">{order.duration_months} mo</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {order.service_lines?.length
                            ? `${order.service_lines.length} service line${order.service_lines.length === 1 ? "" : "s"}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{order.shift_count || 0}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const today = new Date().toISOString().split("T")[0];
                            const isActive = order.start_date <= today && order.end_date >= today;
                            const isCompleted = order.end_date < today;
                            const isDraft = order.status === "draft";
                            const displayStatus = isDraft ? "draft" : isActive ? "active" : isCompleted ? "completed" : order.status;
                            return (
                              <Badge variant={isDraft ? "secondary" : isCompleted ? "outline" : "default"}>
                                {displayStatus}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => toggleOrderExpand(order.id)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{expandedOrders.has(order.id) ? "Collapse details" : "Expand details"}</TooltipContent>
                            </Tooltip>
                            {!order.archived_at && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setEditingOrder(order); setWizardOpen(true); }}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit care plan</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleArchiveOrder(order)}
                                >
                                  {order.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{order.archived_at ? "Restore care plan" : "Archive care plan"}</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>

                      {expandedOrders.has(order.id) && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30">
                            <div className="p-4 space-y-4">
                              {order.service_lines?.length ? (
                                <div>
                                  <h4 className="font-semibold mb-2">Service lines</h4>
                                  <div className="space-y-1">
                                    {order.service_lines.map((l: any) => (
                                      <div key={l.id} className="text-sm rounded-md border bg-background p-2">
                                        {lineLabel(l)}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              <div>
                                <h4 className="font-semibold mb-3 flex items-center gap-2">
                                  <Package className="h-4 w-4" />
                                  Plan Shifts
                                </h4>
                                {orderShifts[order.id]?.length ? (
                                  <div className="space-y-2">
                                    {orderShifts[order.id].map((shift: any) => (
                                      <div key={shift.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-4">
                                          <div>
                                            <div className="text-sm text-muted-foreground">Date</div>
                                            <div className="font-medium">
                                              {format(new Date(`${shift.shift_date}T00:00:00`), "EEE, MMM d")}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-sm text-muted-foreground">Care Service</div>
                                            <div className="font-medium">
                                              {byCode.get(shift.care_type_code)?.name || shift.care_type_code}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-sm text-muted-foreground">Time</div>
                                            <div className="font-medium">
                                              {String(shift.start_time).slice(0, 5)} - {String(shift.end_time).slice(0, 5)}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-sm text-muted-foreground">Duration</div>
                                            <div className="font-medium">{shift.duration_hours}h</div>
                                          </div>
                                          <div>
                                            <div className="text-sm text-muted-foreground">Status</div>
                                            <Badge variant={shift.status === "open" ? "secondary" : "default"} className="w-fit">
                                              {shift.status}
                                            </Badge>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-center py-4 text-muted-foreground">
                                    {orderShifts[order.id] ? "No shifts on this care plan." : "Loading shifts..."}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <OrderWizardDialog
        open={wizardOpen}
        onOpenChange={(o) => { setWizardOpen(o); if (!o) setEditingOrder(null); }}
        agencyId={profile?.agency_id}
        clients={clients}
        order={editingOrder}
        onSaved={() => profile?.agency_id && fetchOrders(profile.agency_id)}
      />
    </AppLayout>
  );
};

export default OrderManagement;
