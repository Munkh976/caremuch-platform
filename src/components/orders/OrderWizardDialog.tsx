import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { useCareServices } from "@/hooks/useCareServices";
import {
  DAY_NAMES, DURATION_OPTIONS, OrderFrequency, OrderServiceLine,
  computeEndDate, durationHours, findConflicts, generateShifts, summarizeLine,
} from "@/lib/orderScheduling";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agencyId?: string | null;
  clients: { id: string; first_name: string; last_name: string }[];
  order?: any | null;
  onSaved: () => void;
}

const emptyLine = (): OrderServiceLine => ({
  care_type_code: "",
  days_of_week: [],
  start_time: "09:00",
  end_time: "13:00",
  frequency: "weekly",
  notes: "",
});

const FREQUENCIES: { value: OrderFrequency; label: string }[] = [
  { value: "once", label: "One time only" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
];

export function OrderWizardDialog({ open, onOpenChange, agencyId, clients, order, onSaved }: Props) {
  const { groupedOptions, byCode, isLoading: servicesLoading } = useCareServices();
  const isEdit = !!order;

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [months, setMonths] = useState(3);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderServiceLine[]>([emptyLine()]);

  useEffect(() => {
    if (!open) return;
    if (order) {
      setClientId(order.client_id);
      setStartDate(order.start_date);
      setMonths(order.duration_months || 3);
      setNotes(order.notes || "");
      supabase
        .from("order_services" as never)
        .select("*")
        .eq("order_id", order.id)
        .then(({ data }) => {
          const rows = (data || []) as any[];
          setLines(
            rows.length
              ? rows.map((r) => ({
                  id: r.id,
                  care_type_code: r.care_type_code,
                  days_of_week: r.days_of_week || [],
                  start_time: String(r.start_time).slice(0, 5),
                  end_time: String(r.end_time).slice(0, 5),
                  frequency: r.frequency as OrderFrequency,
                  notes: r.notes || "",
                }))
              : [emptyLine()]
          );
        });
    } else {
      setClientId("");
      setStartDate(format(new Date(), "yyyy-MM-dd"));
      setMonths(3);
      setNotes("");
      setLines([emptyLine()]);
    }
    setStep(1);
  }, [open, order]);

  const endDate = useMemo(() => computeEndDate(startDate, months), [startDate, months]);

  const namedLines = useMemo(
    () => lines.map((l) => ({ ...l, care_type_name: byCode.get(l.care_type_code)?.name })),
    [lines, byCode]
  );

  const preview = useMemo(
    () => (startDate ? generateShifts(namedLines, startDate, endDate) : []),
    [namedLines, startDate, endDate]
  );
  const conflicts = useMemo(() => findConflicts(preview), [preview]);
  const totalHours = useMemo(
    () => Math.round(preview.reduce((s, p) => s + p.duration_hours, 0) * 10) / 10,
    [preview]
  );
  const weeksSpan = Math.max(1, Math.round((months * 52) / 12));

  const updateLine = (i: number, patch: Partial<OrderServiceLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const toggleDay = (i: number, day: number) =>
    setLines((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? {
              ...l,
              days_of_week: l.days_of_week.includes(day)
                ? l.days_of_week.filter((d) => d !== day)
                : [...l.days_of_week, day].sort(),
            }
          : l
      )
    );

  const lineErrors = (l: OrderServiceLine) => {
    const errs: string[] = [];
    if (!l.care_type_code) errs.push("Pick a care service");
    if (!l.days_of_week.length) errs.push("Pick at least one day");
    if (durationHours(l.start_time, l.end_time) <= 0) errs.push("End time must be after start time");
    return errs;
  };

  const linesValid = lines.length > 0 && lines.every((l) => lineErrors(l).length === 0);

  const handleSave = async (status: "draft" | "submitted") => {
    if (!clientId || !linesValid || !startDate) {
      toast.error("Please complete the client, service lines and start date");
      return;
    }
    setSaving(true);
    try {
      let orderId = order?.id as string | undefined;

      if (isEdit && orderId) {
        const { error } = await supabase
          .from("client_orders")
          .update({
            client_id: clientId,
            start_date: startDate,
            end_date: endDate,
            duration_months: months,
            frequency: lines[0].frequency,
            notes: notes || null,
            status,
          } as never)
          .eq("id", orderId);
        if (error) throw error;

        // Remove future, unassigned shifts — completed/assigned history is preserved.
        const today = format(new Date(), "yyyy-MM-dd");
        await supabase
          .from("shifts")
          .delete()
          .eq("order_id", orderId)
          .gte("shift_date", today)
          .is("caregiver_id", null);
        await supabase.from("order_services" as never).delete().eq("order_id", orderId);
      } else {
        const { data: orderNumber, error: fnError } = await supabase.rpc("generate_order_number");
        if (fnError) throw fnError;
        const { data: newOrder, error } = await supabase
          .from("client_orders")
          .insert({
            client_id: clientId,
            agency_id: agencyId,
            order_number: orderNumber,
            start_date: startDate,
            end_date: endDate,
            duration_months: months,
            frequency: lines[0].frequency,
            notes: notes || null,
            status,
          } as never)
          .select()
          .single();
        if (error) throw error;
        orderId = (newOrder as any).id;
      }

      const { data: insertedLines, error: linesError } = await supabase
        .from("order_services" as never)
        .insert(
          lines.map((l) => ({
            order_id: orderId,
            care_type_code: l.care_type_code,
            days_of_week: l.days_of_week,
            start_time: `${l.start_time}:00`,
            end_time: `${l.end_time}:00`,
            frequency: l.frequency,
            notes: l.notes || null,
          })) as never
        )
        .select("id");
      if (linesError) throw linesError;

      const lineIds = ((insertedLines || []) as any[]).map((r) => r.id);
      const today = format(new Date(), "yyyy-MM-dd");
      const rows = preview
        .filter((p) => !isEdit || p.shift_date >= today)
        .map((p) => ({
          client_id: clientId,
          agency_id: agencyId,
          order_id: orderId,
          order_service_id: lineIds[p.lineIndex] ?? null,
          shift_date: p.shift_date,
          start_time: `${p.start_time}:00`,
          end_time: `${p.end_time}:00`,
          duration_hours: p.duration_hours,
          care_type_code: p.care_type_code,
          status: "open",
          order_title: byCode.get(p.care_type_code)?.name || p.care_type_code,
          special_notes: lines[p.lineIndex]?.notes || null,
        }));

      if (rows.length) {
        const { error: shiftsError } = await supabase.from("shifts").insert(rows as never);
        if (shiftsError) throw shiftsError;
      }

      toast.success(
        `${isEdit ? "Care plan updated" : status === "draft" ? "Draft saved" : "Care plan submitted"} — ${rows.length} shift${rows.length === 1 ? "" : "s"} scheduled`
      );
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to save care plan");
    } finally {
      setSaving(false);
    }
  };

  const stepTitles = ["Client", "Care services", "Duration", "Review"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit care plan ${order?.order_number}` : "Create care plan"}</DialogTitle>
          <DialogDescription>
            Step {step} of 4 — {stepTitles[step - 1]}. Shifts are created unassigned and filled from Schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {stepTitles.map((t, i) => (
            <div
              key={t}
              className={`h-1 flex-1 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div>
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.first_name} {c.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Care plan notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            {servicesLoading && <div className="text-sm text-muted-foreground">Loading care services…</div>}
            {lines.map((line, i) => {
              const errs = lineErrors(line);
              return (
                <Card key={i}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Service line {i + 1}</span>
                      {lines.length > 1 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove line item</TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Care service</Label>
                        <Select
                          value={line.care_type_code}
                          onValueChange={(v) => updateLine(i, { care_type_code: v })}
                        >
                          <SelectTrigger><SelectValue placeholder="Select a care service" /></SelectTrigger>
                          <SelectContent>
                            {groupedOptions.map((g) => (
                              <SelectGroup key={g.label}>
                                <SelectLabel>{g.label}</SelectLabel>
                                {g.options.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Repeats</Label>
                        <Select
                          value={line.frequency}
                          onValueChange={(v) => updateLine(i, { frequency: v as OrderFrequency })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FREQUENCIES.map((f) => (
                              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Days of the week</Label>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => updateLine(i, { days_of_week: [0, 1, 2, 3, 4, 5, 6] })}>All</Button>
                          <Button variant="outline" size="sm" onClick={() => updateLine(i, { days_of_week: [1, 2, 3, 4, 5] })}>Weekdays</Button>
                          <Button variant="outline" size="sm" onClick={() => updateLine(i, { days_of_week: [0, 6] })}>Weekends</Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {DAY_NAMES.map((d, idx) => (
                          <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant={line.days_of_week.includes(idx) ? "default" : "outline"}
                            onClick={() => toggleDay(i, idx)}
                          >
                            {d}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <Label>Start time</Label>
                        <Input type="time" value={line.start_time} onChange={(e) => updateLine(i, { start_time: e.target.value })} />
                      </div>
                      <div>
                        <Label>End time</Label>
                        <Input type="time" value={line.end_time} onChange={(e) => updateLine(i, { end_time: e.target.value })} />
                      </div>
                      <div>
                        <Label>Hours per visit</Label>
                        <Input readOnly value={Math.max(0, durationHours(line.start_time, line.end_time))} />
                      </div>
                    </div>

                    <div>
                      <Label>Line notes (optional)</Label>
                      <Input value={line.notes || ""} onChange={(e) => updateLine(i, { notes: e.target.value })} />
                    </div>

                    {errs.length > 0 && (
                      <div className="text-sm text-destructive">{errs.join(" · ")}</div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            <Button variant="outline" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              <Plus className="mr-2 h-4 w-4" /> Add another service
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-2">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>Duration</Label>
                <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m === 12 ? "12 months (1 year)" : `${m} month${m > 1 ? "s" : ""}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              Runs {format(new Date(startDate), "MMM d, yyyy")} → {format(new Date(endDate), "MMM d, yyyy")}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{preview.length}</div>
                <div className="text-xs text-muted-foreground">shifts</div>
              </CardContent></Card>
              <Card><CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{totalHours}h</div>
                <div className="text-xs text-muted-foreground">total hours</div>
              </CardContent></Card>
              <Card><CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{Math.round((totalHours / weeksSpan) * 10) / 10}h</div>
                <div className="text-xs text-muted-foreground">per week</div>
              </CardContent></Card>
            </div>

            <div className="space-y-2">
              {namedLines.map((l, i) => (
                <div key={i} className="rounded-md border p-3 text-sm">{summarizeLine(l)}</div>
              ))}
            </div>

            {conflicts.length > 0 && (
              <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {conflicts.length} overlapping shift{conflicts.length === 1 ? "" : "s"} for this client
                </div>
                <p className="text-muted-foreground mt-1">
                  Two service lines land on the same date at the same time. You can still save, but the client will
                  need two caregivers at once.
                </p>
              </div>
            )}

            {preview.length > 500 && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                This care plan generates {preview.length} shifts. Consider a shorter duration.
              </div>
            )}

            <div>
              <Label className="mb-2 block">First dates</Label>
              <div className="flex flex-wrap gap-2">
                {preview.slice(0, 10).map((p, i) => (
                  <Badge key={i} variant="secondary">
                    {format(new Date(`${p.shift_date}T00:00:00`), "EEE MMM d")} {p.start_time}
                  </Badge>
                ))}
                {preview.length > 10 && <Badge variant="outline">+{preview.length - 10} more</Badge>}
              </div>
            </div>

            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Saving replaces future unassigned shifts on this care plan. Past and already-assigned shifts stay untouched.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={() => (step === 1 ? onOpenChange(false) : setStep(step - 1))}>
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 4 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={(step === 1 && !clientId) || (step === 2 && !linesValid) || (step === 3 && !startDate)}
            >
              Next
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save draft
              </Button>
              <Button onClick={() => handleSave("submitted")} disabled={saving || !preview.length}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Update care plan" : "Submit care plan"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
