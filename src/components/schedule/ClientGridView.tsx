import { VisitActionsMenu } from "@/components/schedule/VisitActions";
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Clock, MapPin, Search } from "lucide-react";

interface Props {
  clients: any[];
  shifts: any[];
  getAssignedCaregiver: (shift: any) => any;
  onSelectShift: (shift: any) => void;
  onAssign?: (shift: any) => void;
}

export const ClientGridView = ({
  clients,
  shifts,
  getAssignedCaregiver,
  onSelectShift,
}: Props) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unassigned" | "with">("all");

  const byClient = useMemo(() => {
    const map = new Map<string, any[]>();
    shifts.forEach((s) => {
      if (!s.client_id) return;
      map.set(s.client_id, [...(map.get(s.client_id) || []), s]);
    });
    return map;
  }, [shifts]);

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .map((c) => {
        const items = (byClient.get(c.id) || []).sort((a, b) =>
          (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time)
        );
        return { client: c, items };
      })
      .filter(({ client, items }) => {
        const name = `${client.first_name} ${client.last_name} ${client.city || ""}`.toLowerCase();
        if (q && !name.includes(q)) return false;
        if (filter === "with" && items.length === 0) return false;
        if (
          filter === "unassigned" &&
          !items.some((s) => !getAssignedCaregiver(s))
        )
          return false;
        return true;
      });
  }, [clients, byClient, search, filter, getAssignedCaregiver]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client or city..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            <SelectItem value="with">With shifts</SelectItem>
            <SelectItem value="unassigned">Needs a caregiver</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{cards.length} clients</span>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No clients match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ client, items }) => {
            const unassigned = items.filter((s) => !getAssignedCaregiver(s));
            const hours = items.reduce(
              (sum, s) => sum + (Number(s.duration_hours) || 0),
              0
            );
            return (
              <Card key={client.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {client.first_name} {client.last_name}
                      </div>
                      {client.city && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {client.city}
                          {client.state ? `, ${client.state}` : ""}
                        </div>
                      )}
                    </div>
                    {unassigned.length > 0 && (
                      <Badge variant="outline" className="border-warning text-warning gap-1 shrink-0">
                        <AlertTriangle className="h-3 w-3" />
                        {unassigned.length}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary">
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
                      {items.slice(0, 4).map((s) => {
                        const cg = getAssignedCaregiver(s);
                        return (
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
                                {cg
                                  ? `${cg.first_name} ${cg.last_name}`
                                  : "Unassigned"}{" "}
                                · {s.care_types?.name || s.order_title || "—"}
                              </span>
                            </button>
                            {s.caregiver_id && <VisitActionsMenu shift={s} />}
                          </li>
                        );
                      })}
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
