import { VisitActionsMenu } from "@/components/schedule/VisitActions";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Plus, Search, Star, UserCheck } from "lucide-react";
import {
  fetchCaregiverPerformance,
  type CaregiverPerformance,
} from "@/lib/caregiverPerformance";

interface Props {
  caregivers: any[];
  shifts: any[];
  getAssignedCaregiver: (shift: any) => any;
  onSelectShift: (shift: any) => void;
  onAssignShiftFor: (caregiver: any) => void;
}

export const CaregiverGridView = ({
  caregivers,
  shifts,
  getAssignedCaregiver,
  onSelectShift,
  onAssignShiftFor,
}: Props) => {
  const [search, setSearch] = useState("");
  const [load, setLoad] = useState<"all" | "with" | "without">("all");
  const [perf, setPerf] = useState<Map<string, CaregiverPerformance>>(new Map());

  const caregiverIds = useMemo(() => caregivers.map((c) => c.id).sort().join(","), [caregivers]);

  useEffect(() => {
    if (!caregiverIds) {
      setPerf(new Map());
      return;
    }
    let cancelled = false;
    fetchCaregiverPerformance(caregiverIds.split(",")).then((m) => {
      if (!cancelled) setPerf(m);
    });
    return () => {
      cancelled = true;
    };
  }, [caregiverIds]);

  const byCaregiver = useMemo(() => {
    const map = new Map<string, any[]>();
    shifts.forEach((s) => {
      const cg = getAssignedCaregiver(s);
      if (!cg) return;
      map.set(cg.id, [...(map.get(cg.id) || []), s]);
    });
    return map;
  }, [shifts, getAssignedCaregiver]);

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return caregivers
      .filter((c) => {
        const name = `${c.first_name} ${c.last_name} ${c.city || ""}`.toLowerCase();
        if (q && !name.includes(q)) return false;
        const count = (byCaregiver.get(c.id) || []).length;
        if (load === "with" && count === 0) return false;
        if (load === "without" && count > 0) return false;
        return true;
      })
      .map((c) => ({
        caregiver: c,
        items: (byCaregiver.get(c.id) || []).sort(
          (a, b) =>
            (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time)
        ),
      }));
  }, [caregivers, byCaregiver, search, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search caregiver or city..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={load} onValueChange={(v: any) => setLoad(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All caregivers</SelectItem>
            <SelectItem value="with">With shifts</SelectItem>
            <SelectItem value="without">No shifts</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{cards.length} caregivers</span>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No caregivers match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ caregiver, items }) => {
            const hours = items.reduce(
              (sum, s) => sum + (Number(s.duration_hours) || 0),
              0
            );
            return (
              <Card key={caregiver.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                        {caregiver.first_name?.[0]}
                        {caregiver.last_name?.[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          {caregiver.first_name} {caregiver.last_name}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {perf.get(caregiver.id)?.avg_rating != null ? (
                            <span className="inline-flex items-center gap-1">
                              <Star className="h-3 w-3 fill-warning text-warning" />
                              {perf.get(caregiver.id)!.avg_rating!.toFixed(1)} (
                              {perf.get(caregiver.id)!.rating_count})
                            </span>
                          ) : (
                            <span className="text-muted-foreground/70">No ratings yet</span>
                          )}
                          <span>{caregiver.city || "—"}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 shrink-0"
                      onClick={() => onAssignShiftFor(caregiver)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Assign Shift
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="gap-1">
                      <UserCheck className="h-3 w-3" />
                      {items.length} shift{items.length === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Clock className="h-3 w-3" />
                      {hours}h
                    </Badge>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No shifts in this period.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {items.slice(0, 4).map((s) => (
                        <li key={s.id} className="flex items-start gap-1">
                          <button
                            className="min-w-0 flex-1 text-left rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                            onClick={() => onSelectShift(s)}
                          >
                            <span className="font-medium">
                              {format(parseISO(s.shift_date), "EEE d")}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {s.clients?.first_name} {s.clients?.last_name} ·{" "}
                              {s.care_types?.name || s.order_title || "—"}
                            </span>
                          </button>
                          {s.caregiver_id && <VisitActionsMenu shift={s} />}
                        </li>
                      ))}
                      {items.length > 4 && (
                        <li className="text-xs text-muted-foreground">
                          +{items.length - 4} more
                        </li>
                      )}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
