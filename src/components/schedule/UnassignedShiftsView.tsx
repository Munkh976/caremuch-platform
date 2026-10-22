import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
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
import { AlertTriangle, CalendarDays, Clock, MapPin, Search, Sparkles, Zap } from "lucide-react";
import { VisitPlaceLine } from "@/components/schedule/VisitPlaceLine";

interface Props {
  shifts: any[];
  getCategoryForShift: (shift: any) => any;
  onSelectShift: (shift: any) => void;
  onAssign: (shift: any) => void;
  onSmartAssign?: (shift: any) => void;
  onAutoFill?: () => void;
}

export const UnassignedShiftsView = ({
  shifts,
  getCategoryForShift,
  onSelectShift,
  onAssign,
  onSmartAssign,
  onAutoFill,
}: Props) => {
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shifts;
    return shifts.filter((s) =>
      [
        s.clients?.first_name,
        s.clients?.last_name,
        s.clients?.city,
        s.care_types?.name,
        s.care_types?.code,
        s.order_title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [shifts, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client, city or service..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge variant="outline" className="border-warning text-warning gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          {results.length} unassigned
        </Badge>
        {onAutoFill && (
          // always visible (owner 4f); the dialog has its own Day / Week / Month picker and says when a period is empty
          <Button variant="outline" className="gap-2 ml-auto" onClick={onAutoFill} data-testid="auto-assign-button">
            <Sparkles className="h-4 w-4" />
            Auto-assign…
          </Button>
        )}
      </div>

      {results.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Every shift in this period has a caregiver assigned.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((shift) => {
                const category = getCategoryForShift(shift);
                return (
                  <TableRow
                    key={shift.id}
                    className="cursor-pointer"
                    onClick={() => onSelectShift(shift)}
                  >
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2 font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        {format(parseISO(shift.shift_date), "EEE, MMM d")}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {shift.clients?.first_name} {shift.clients?.last_name}
                      </div>
                      <VisitPlaceLine officeId={shift.virtual_office_id} client={shift.clients} className="text-xs text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        {shift.care_types?.name || shift.order_title || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-dashed text-warning">
                        {shift.status || "open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAssign(shift);
                          }}
                        >
                          <Zap className="h-3.5 w-3.5" />
                          Assign
                        </Button>
                        {onSmartAssign && (
                          <Button
                            size="sm"
                            className="gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSmartAssign(shift);
                            }}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            Smart assign
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
