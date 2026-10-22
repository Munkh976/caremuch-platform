import { VisitPlaceLine } from "@/components/schedule/VisitPlaceLine";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin } from "lucide-react";
import { format } from "date-fns";

interface Shift {
  id: string;
  status: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  shifts: {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    care_type_code: string;
    virtual_office_id?: string | null;
    duration_hours: number;
    clients: {
      first_name: string;
      last_name: string;
      address: string;
      city: string;
    };
  };
}

interface ShiftListProps {
  shifts: Shift[];
  onShiftClick: (shift: any) => void;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  borderColor?: string;
}

export const ShiftList = ({ 
  shifts, 
  onShiftClick, 
  emptyMessage = "No shifts found",
  emptyIcon,
  borderColor = "border-primary"
}: ShiftListProps) => {
  const getStatusColor = (status: string) => {
    const colors = {
      scheduled: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      confirmed: "bg-green-500/10 text-green-600 border-green-500/20",
      in_progress: "bg-orange-500/10 text-orange-600 border-orange-500/20",
      completed: "bg-gray-500/10 text-gray-600 border-gray-500/20"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  const getCareTypeColor = (type: string) => {
    const colors = {
      personal_care: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      companionship: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      medication: "bg-green-500/10 text-green-600 border-green-500/20",
      mobility: "bg-orange-500/10 text-orange-600 border-orange-500/20",
      dementia_care: "bg-pink-500/10 text-pink-600 border-pink-500/20",
      hospice: "bg-gray-500/10 text-gray-600 border-gray-500/20",
      skilled_nursing: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
    };
    return colors[type as keyof typeof colors] || "bg-muted";
  };

  if (shifts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-muted/30 rounded-lg border border-border">
        {emptyIcon}
        <p className="text-lg font-medium text-muted-foreground mt-2">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {shifts.map((assignment) => (
        <Card 
          key={assignment.id} 
          className={`border-l-4 ${borderColor} hover:shadow-md transition-shadow cursor-pointer`}
          onClick={() => onShiftClick(assignment.shifts)}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-lg">
                    {assignment.shifts?.clients?.first_name} {assignment.shifts?.clients?.last_name}
                  </p>
                  <Badge className={getStatusColor(assignment.status)}>
                    {assignment.status}
                  </Badge>
                  <Badge className={getCareTypeColor(assignment.shifts?.care_type_code)}>
                    {assignment.shifts?.care_type_code.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span>{format(new Date(assignment.shifts?.shift_date), "MMM d, yyyy")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>{assignment.shifts?.start_time.slice(0, 5)} - {assignment.shifts?.end_time.slice(0, 5)}</span>
                  </div>
                  <VisitPlaceLine officeId={assignment.shifts?.virtual_office_id} client={assignment.shifts?.clients} iconClassName="w-4 h-4" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
