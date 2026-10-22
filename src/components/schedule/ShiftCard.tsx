import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, User } from "lucide-react";
import { format } from "date-fns";
import { VisitPlaceLine } from "@/components/schedule/VisitPlaceLine";

interface ShiftCardProps {
  shift: any;
  onView?: (shift: any) => void;
  onAssign?: (shift: any) => void;
  showClient?: boolean;
  showCaregiver?: boolean;
  actions?: React.ReactNode;
}

export const ShiftCard = ({ 
  shift, 
  onView, 
  onAssign,
  showClient = true,
  showCaregiver = true,
  actions
}: ShiftCardProps) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned': return 'bg-success/10 text-success border-success/20';
      case 'open': return 'bg-warning/10 text-warning border-warning/20';
      case 'completed': return 'bg-muted text-muted-foreground';
      default: return 'bg-secondary text-secondary-foreground';
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView?.(shift)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={getStatusColor(shift.status)}>
                {shift.status}
              </Badge>
              {shift.care_type_code && (
                <Badge variant="outline">
                  {shift.care_type_code.replace(/_/g, ' ')}
                </Badge>
              )}
            </div>

            {showClient && shift.clients && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {shift.clients.first_name} {shift.clients.last_name}
                </span>
              </div>
            )}

            {showCaregiver &&
              (shift.shift_assignments || []).some((a: any) => a?.status !== "cancelled") && (

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Caregiver assigned</span>
              </div>
            )}


            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                {format(new Date(shift.shift_date), "MMM d, yyyy")} • {" "}
                {shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}
              </span>
            </div>

            <VisitPlaceLine officeId={shift.virtual_office_id} client={shift.clients} className="gap-2 text-sm text-muted-foreground" iconClassName="h-4 w-4" />
          </div>

          <div className="flex flex-col gap-2">
            {actions || (
              <>
                {onView && (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onView(shift); }}>
                    View
                  </Button>
                )}
                {onAssign && shift.status === 'open' && (
                  <Button size="sm" onClick={(e) => { e.stopPropagation(); onAssign(shift); }}>
                    Assign
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
