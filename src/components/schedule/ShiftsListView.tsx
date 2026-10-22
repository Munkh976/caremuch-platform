import { VisitActionsMenu } from "@/components/schedule/VisitActions";
import { useMemo, useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Search, Zap, Clock, MapPin } from "lucide-react";
import { VisitPlaceLine } from "@/components/schedule/VisitPlaceLine";

interface ShiftsListViewProps {
  shifts: any[];
  days: Date[];
  getAssignedCaregiver: (shift: any) => any;
  getCategoryForShift: (shift: any) => any;
  onSelectShift: (shift: any) => void;
  onQuickAssign: (shiftId: string) => void;
}

export const ShiftsListView = ({
  shifts,
  days,
  getAssignedCaregiver,
  getCategoryForShift,
  onSelectShift,
  onQuickAssign,
}: ShiftsListViewProps) => {
  const [search, setSearch] = useState("");

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shifts;
    return shifts.filter((s) => {
      const caregiver = getAssignedCaregiver(s);
      const haystack = [
        s.clients?.first_name,
        s.clients?.last_name,
        s.clients?.city,
        s.care_types?.name,
        s.care_types?.code,
        caregiver?.first_name,
        caregiver?.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [shifts, search, getAssignedCaregiver]);

  const unassigned = useMemo(
    () => searched.filter((s) => !getAssignedCaregiver(s)),
    [searched, getAssignedCaregiver]
  );

  const groups = useMemo(() => {
    return days
      .map((day) => ({
        day,
        items: searched
          .filter((s) => isSameDay(parseISO(s.shift_date), day))
          .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "")),
      }))
      .filter((g) => g.items.length > 0);
  }, [days, searched]);

  const renderRow = (shift: any, showDate = false) => {
    const caregiver = getAssignedCaregiver(shift);
    const category = getCategoryForShift(shift);

    return (
      <TableRow
        key={shift.id}
        className="cursor-pointer"
        onClick={() => onSelectShift(shift)}
      >
        <TableCell className="whitespace-nowrap font-medium">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
          </div>
          {showDate && (
            <div className="text-xs text-muted-foreground mt-1">
              {format(parseISO(shift.shift_date), "EEE, MMM d")}
            </div>
          )}
        </TableCell>
        <TableCell>
          <div className="font-medium">
            {shift.clients?.first_name} {shift.clients?.last_name}
          </div>
          <VisitPlaceLine officeId={shift.virtual_office_id} client={shift.clients} className="text-xs text-muted-foreground" />
        </TableCell>
        <TableCell>
          <span
            className="inline-flex items-center gap-2 text-sm"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            {shift.care_types?.name || "—"}
          </span>
        </TableCell>
        <TableCell>
          {caregiver ? (
            <span className="text-sm">
              {caregiver.first_name} {caregiver.last_name}
            </span>
          ) : (
            <Badge variant="outline" className="border-dashed text-warning">
              Unassigned
            </Badge>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={shift.status === "completed" ? "secondary" : "outline"}>
            {shift.status || "scheduled"}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          {caregiver && <VisitActionsMenu shift={shift} />}
          {!caregiver && (
            <Button
              size="sm"
              className="gap-1"
              onClick={(e) => {
                e.stopPropagation();
                onQuickAssign(shift.id);
              }}
            >
              <Zap className="h-3.5 w-3.5" />
              Assign
            </Button>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client, caregiver or service..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {searched.length} shift{searched.length === 1 ? "" : "s"}
        </span>
      </div>

      {unassigned.length > 0 && (
        <Card className="border-dashed border-2 border-warning bg-warning/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <h3 className="font-semibold">
                Needs action — {unassigned.length} unassigned shift
                {unassigned.length === 1 ? "" : "s"}
              </h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Caregiver</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{unassigned.map((s) => renderRow(s, true))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No shifts in this period.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.day.toISOString()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">
                {format(group.day, "EEEE, MMMM d")}
              </h3>
              <span className="text-sm text-muted-foreground">
                {group.items.length} shift{group.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Caregiver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{group.items.map((s) => renderRow(s))}</TableBody>
              </Table>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
