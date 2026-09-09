import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FLEXIBILITY_OPTIONS } from "@/lib/flexibility";
import { Clock, Plus, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";


interface AvailabilityDialogProps {
  caregiver: any;
  isOpen: boolean;
  onClose: () => void;
}

interface TimeSlot {
  day_of_week: number;
  /** Preferred (ideal) window */
  start_time: string;
  end_time: string;
  /** Acceptable (outer) window */
  earliest_start: string;
  latest_end: string;
  flexibility_minutes: number;
  is_available: boolean;
}

interface ExceptionRow {
  id?: string;
  exception_date: string;
  is_available: boolean;
  start_time: string;
  end_time: string;
  reason: string;
}

const emptySlot = (day: number, available = false): TimeSlot => ({
  day_of_week: day,
  start_time: "09:00",
  end_time: "17:00",
  earliest_start: "09:00",
  latest_end: "17:00",
  flexibility_minutes: 0,
  is_available: available,
});

interface PrefsRow {
  id?: string;
  flexibility: string;
  desired_weekly_hours: string;
  min_weekly_hours: string;
  max_weekly_hours: string;
  desired_hourly_rate: string;
  max_travel_minutes: string;
  max_travel_miles: string;
  willing_to_travel_outside_area: boolean;
  open_to_short_notice: boolean;
  notes: string;
}

const emptyPrefs = (): PrefsRow => ({
  flexibility: "balanced",
  desired_weekly_hours: "",
  min_weekly_hours: "",
  max_weekly_hours: "",
  desired_hourly_rate: "",
  max_travel_minutes: "",
  max_travel_miles: "",
  willing_to_travel_outside_area: false,
  open_to_short_notice: false,
  notes: "",
});

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export const AvailabilityDialog = ({ caregiver, isOpen, onClose }: AvailabilityDialogProps) => {
  const [availability, setAvailability] = useState<TimeSlot[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [removedExceptionIds, setRemovedExceptionIds] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<PrefsRow>(emptyPrefs());
  const [loading, setLoading] = useState(false);


  const daysOfWeek = [
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
    { value: 0, label: "Sunday" },
  ];

  useEffect(() => {
    if (isOpen && caregiver) {
      fetchAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, caregiver]);

  const hhmm = (t?: string | null, fallback = "09:00") =>
    typeof t === "string" && t.length >= 5 ? t.slice(0, 5) : fallback;

  const fetchAll = async () => {
    setLoading(true);
    setRemovedExceptionIds([]);

    const [weekly, exc, pref] = await Promise.all([
      supabase.from("caregiver_availability").select("*").eq("caregiver_id", caregiver.id).order("day_of_week"),
      supabase
        .from("caregiver_availability_exceptions")
        .select("*")
        .eq("caregiver_id", caregiver.id)
        .order("exception_date"),
      supabase.from("caregiver_preferences").select("*").eq("caregiver_id", caregiver.id).maybeSingle(),
    ]);


    if (weekly.error) {
      console.error("Error fetching availability:", weekly.error);
      toast.error("Failed to load availability");
    } else if (weekly.data && weekly.data.length > 0) {
      setAvailability(
        (weekly.data as any[]).map((slot) => ({
          day_of_week: slot.day_of_week,
          start_time: hhmm(slot.preferred_start ?? slot.start_time),
          end_time: hhmm(slot.preferred_end ?? slot.end_time, "17:00"),
          earliest_start: hhmm(slot.earliest_start ?? slot.start_time),
          latest_end: hhmm(slot.latest_end ?? slot.end_time, "17:00"),
          flexibility_minutes: Number(slot.flexibility_minutes ?? 0),
          is_available: slot.is_available ?? true,
        }))
      );
    } else {
      setAvailability(daysOfWeek.map((d) => emptySlot(d.value)));
    }

    if (exc.error) {
      console.error("Error fetching availability exceptions:", exc.error);
    } else {
      setExceptions(
        (exc.data as any[]).map((e) => ({
          id: e.id,
          exception_date: e.exception_date,
          is_available: e.is_available,
          start_time: hhmm(e.start_time),
          end_time: hhmm(e.end_time, "17:00"),
          reason: e.reason ?? "",
        }))
      );
    }

    const p = (pref as any)?.data;
    setPrefs(
      p
        ? {
            id: p.id,
            flexibility: p.flexibility ?? "balanced",
            desired_weekly_hours: p.desired_weekly_hours?.toString() ?? "",
            min_weekly_hours: p.min_weekly_hours?.toString() ?? "",
            max_weekly_hours: p.max_weekly_hours?.toString() ?? "",
            desired_hourly_rate: p.desired_hourly_rate?.toString() ?? "",
            max_travel_minutes: p.max_travel_minutes?.toString() ?? "",
            max_travel_miles: p.max_travel_miles?.toString() ?? "",
            willing_to_travel_outside_area: !!p.willing_to_travel_outside_area,
            open_to_short_notice: !!p.open_to_short_notice,
            notes: p.notes ?? "",
          }
        : emptyPrefs()
    );

    setLoading(false);
  };



  const handleToggleDay = (dayValue: number) => {
    setAvailability((prev) => {
      const existing = prev.find((slot) => slot.day_of_week === dayValue);
      if (existing) {
        return prev.map((slot) =>
          slot.day_of_week === dayValue ? { ...slot, is_available: !slot.is_available } : slot
        );
      }
      return [...prev, emptySlot(dayValue, true)];
    });
  };

  const updateSlot = (dayValue: number, patch: Partial<TimeSlot>) => {
    setAvailability((prev) =>
      prev.map((slot) => (slot.day_of_week === dayValue ? { ...slot, ...patch } : slot))
    );
  };

  const addException = () => {
    const today = new Date().toISOString().slice(0, 10);
    setExceptions((prev) => [
      ...prev,
      { exception_date: today, is_available: false, start_time: "09:00", end_time: "17:00", reason: "" },
    ]);
  };

  const removeException = (index: number) => {
    setExceptions((prev) => {
      const row = prev[index];
      if (row?.id) setRemovedExceptionIds((ids) => [...ids, row.id!]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const updateException = (index: number, patch: Partial<ExceptionRow>) => {
    setExceptions((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSave = async () => {
    setLoading(true);

    // --- Weekly availability: replace the caregiver's set ---
    await supabase.from("caregiver_availability").delete().eq("caregiver_id", caregiver.id);

    const slotsToInsert = availability
      .filter((slot) => slot.is_available)
      .map((slot) => ({
        caregiver_id: caregiver.id,
        agency_id: caregiver.agency_id,
        day_of_week: slot.day_of_week,
        // effective window used by scheduling is derived from the acceptable window
        start_time: slot.earliest_start || slot.start_time,
        end_time: slot.latest_end || slot.end_time,
        preferred_start: slot.start_time,
        preferred_end: slot.end_time,
        earliest_start: slot.earliest_start || slot.start_time,
        latest_end: slot.latest_end || slot.end_time,
        flexibility_minutes: Number(slot.flexibility_minutes) || 0,
        is_available: true,
      }));

    if (slotsToInsert.length > 0) {
      const { error } = await supabase.from("caregiver_availability").insert(slotsToInsert);
      if (error) {
        console.error("Error saving availability:", error);
        toast.error("Failed to save availability");
        setLoading(false);
        return;
      }
    }

    // --- Date exceptions ---
    if (removedExceptionIds.length > 0) {
      await supabase.from("caregiver_availability_exceptions").delete().in("id", removedExceptionIds);
    }

    for (const row of exceptions) {
      const payload = {
        caregiver_id: caregiver.id,
        agency_id: caregiver.agency_id,
        exception_date: row.exception_date,
        is_available: row.is_available,
        start_time: row.is_available ? row.start_time : null,
        end_time: row.is_available ? row.end_time : null,
        reason: row.reason || null,
      };
      const { error } = row.id
        ? await supabase.from("caregiver_availability_exceptions").update(payload).eq("id", row.id)
        : await supabase.from("caregiver_availability_exceptions").insert(payload);
      if (error) {
        console.error("Error saving exception:", error);
        toast.error(`Failed to save exception for ${row.exception_date}`);
        setLoading(false);
        return;
      }
    }

    // --- Preferences (one row per caregiver) ---
    const prefPayload = {
      caregiver_id: caregiver.id,
      agency_id: caregiver.agency_id,
      flexibility: prefs.flexibility,
      desired_weekly_hours: num(prefs.desired_weekly_hours),
      min_weekly_hours: num(prefs.min_weekly_hours),
      max_weekly_hours: num(prefs.max_weekly_hours),
      desired_hourly_rate: num(prefs.desired_hourly_rate),
      max_travel_minutes: num(prefs.max_travel_minutes),
      max_travel_miles: num(prefs.max_travel_miles),
      willing_to_travel_outside_area: prefs.willing_to_travel_outside_area,
      open_to_short_notice: prefs.open_to_short_notice,
      notes: prefs.notes.trim() || null,
    };
    const { error: prefError } = prefs.id
      ? await supabase.from("caregiver_preferences").update(prefPayload as any).eq("id", prefs.id)
      : await supabase.from("caregiver_preferences").insert(prefPayload as any);
    if (prefError) {
      console.error("Error saving preferences:", prefError);
      toast.error("Failed to save preferences");
      setLoading(false);
      return;
    }

    toast.success("Availability and preferences updated");
    setLoading(false);
    onClose();

  };

  const timeOptions = (() => {
    const times: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let min = 0; min < 60; min += 30) {
        times.push(`${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
      }
    }
    return times;
  })();

  const TimeSelect = ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
  }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[240px]">
          {timeOptions.map((time) => (
            <SelectItem key={time} value={time}>
              {time}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Availability &amp; Preferences - {caregiver?.first_name} {caregiver?.last_name}
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="weekly" className="py-2">
          <TabsList>
            <TabsTrigger value="weekly">Weekly pattern</TabsTrigger>
            <TabsTrigger value="exceptions">Date exceptions ({exceptions.length})</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
          </TabsList>


          <TabsContent value="weekly" className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">
              Preferred hours are the caregiver's ideal window. Acceptable hours are the widest window they will
              work — scheduling eligibility uses the acceptable window.
            </p>

            {daysOfWeek.map((day) => {
              const slot = availability.find((s) => s.day_of_week === day.value) ?? emptySlot(day.value);
              const isAvailable = slot.is_available;

              return (
                <div key={day.value} className="rounded-lg border p-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`day-${day.value}`}
                      checked={isAvailable}
                      onChange={() => handleToggleDay(day.value)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor={`day-${day.value}`} className="font-medium cursor-pointer">
                      {day.label}
                    </Label>
                  </div>

                  {isAvailable && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <TimeSelect
                        label="Preferred from"
                        value={slot.start_time}
                        onChange={(v) => updateSlot(day.value, { start_time: v })}
                      />
                      <TimeSelect
                        label="Preferred to"
                        value={slot.end_time}
                        onChange={(v) => updateSlot(day.value, { end_time: v })}
                      />
                      <TimeSelect
                        label="Acceptable from"
                        value={slot.earliest_start}
                        onChange={(v) => updateSlot(day.value, { earliest_start: v })}
                      />
                      <TimeSelect
                        label="Acceptable to"
                        value={slot.latest_end}
                        onChange={(v) => updateSlot(day.value, { latest_end: v })}
                      />
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Flex (min)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={480}
                          step={15}
                          className="w-[90px]"
                          value={slot.flexibility_minutes}
                          onChange={(e) =>
                            updateSlot(day.value, { flexibility_minutes: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="exceptions" className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">
              One-off changes for a specific date. Use time off requests for paid or approved leave.
            </p>

            {exceptions.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No date exceptions.</p>
            )}

            {exceptions.map((row, index) => (
              <div key={row.id ?? `new-${index}`} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Date</Label>
                    <Input
                      type="date"
                      className="w-[160px]"
                      value={row.exception_date}
                      onChange={(e) => updateException(index, { exception_date: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select
                      value={row.is_available ? "available" : "unavailable"}
                      onValueChange={(v) => updateException(index, { is_available: v === "available" })}
                    >
                      <SelectTrigger className="w-[170px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unavailable">Unavailable all day</SelectItem>
                        <SelectItem value="available">Available (custom hours)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {row.is_available && (
                    <>
                      <TimeSelect
                        label="From"
                        value={row.start_time}
                        onChange={(v) => updateException(index, { start_time: v })}
                      />
                      <TimeSelect
                        label="To"
                        value={row.end_time}
                        onChange={(v) => updateException(index, { end_time: v })}
                      />
                    </>
                  )}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto text-destructive"
                        onClick={() => removeException(index)}
                        aria-label="Remove exception"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove exception</TooltipContent>
                  </Tooltip>
                </div>

                <Input
                  placeholder="Reason (optional)"
                  value={row.reason}
                  onChange={(e) => updateException(index, { reason: e.target.value })}
                />
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addException}>
              <Plus className="h-4 w-4 mr-2" />
              Add exception
            </Button>
          </TabsContent>

          <TabsContent value="preferences" className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Stated intent only — shown to schedulers. No automatic matching acts on these values yet.
            </p>

            <div className="space-y-2">
              <Label>Flexibility stance</Label>
              <Select
                value={prefs.flexibility}
                onValueChange={(v) => setPrefs((p) => ({ ...p, flexibility: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLEXIBILITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label} — {o.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { key: "desired_weekly_hours", label: "Desired weekly hours" },
                { key: "min_weekly_hours", label: "Min weekly hours" },
                { key: "max_weekly_hours", label: "Max weekly hours" },
                { key: "desired_hourly_rate", label: "Desired hourly rate" },
                { key: "max_travel_minutes", label: "Max travel (min)" },
                { key: "max_travel_miles", label: "Max travel (miles)" },
              ].map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{f.label}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={(prefs as any)[f.key]}
                    onChange={(e) => setPrefs((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={prefs.willing_to_travel_outside_area}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, willing_to_travel_outside_area: e.target.checked }))
                  }
                />
                Willing to travel outside preferred area
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={prefs.open_to_short_notice}
                  onChange={(e) => setPrefs((p) => ({ ...p, open_to_short_notice: e.target.checked }))}
                />
                Open to short-notice shifts
              </label>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea
                rows={2}
                value={prefs.notes}
                onChange={(e) => setPrefs((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save changes"}
          </Button>

        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
