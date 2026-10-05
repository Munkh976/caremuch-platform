import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, User, Briefcase, FileText, Zap } from "lucide-react";
interface ShiftDetailsDialogProps {
  shift: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssign?: (shift: any) => void;
}

export const ShiftDetailsDialog = ({ shift, open, onOpenChange, onAssign }: ShiftDetailsDialogProps) => {
  if (!shift) return null;

  const isUnassigned =
    !(shift.shift_assignments || []).some((a: any) => a?.status !== "cancelled");


  // Different views pass either `clients`/`care_types` (Supabase relations) or
  // pre-mapped `client`/`care_type` objects — support both.
  const client = shift.clients || shift.client;
  const careType = shift.care_types || shift.care_type;
  const serviceName = careType?.name || shift.order_title || "Care service";
  const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(" ");
  // Client phone comes from a caregiver-scoped view that includes clients on browsable
  // open shifts, not just assigned ones -- don't surface a phone number for a shift the
  // caregiver hasn't picked up yet.
  const isOpenShift = shift.status === "open" || shift.status === "unassigned";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{serviceName}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {shift.care_type_code && <Badge variant="outline">{shift.care_type_code}</Badge>}
            {careType?.category && <Badge variant="secondary">{careType.category}</Badge>}
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Client Information */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
              <User className="h-4 w-4" />
              Client
            </div>
            <div className="ml-6">
              <p className="font-medium text-lg">{clientName || "Unknown client"}</p>
              {client?.phone && !isOpenShift && (
                <p className="text-sm text-muted-foreground">{client.phone}</p>
              )}
            </div>
          </div>

          {/* Location */}
          {client?.address && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
                <MapPin className="h-4 w-4" />
                Location
              </div>
              <div className="ml-6">
                <p className="text-sm">
                  {client.address}
                  {client.city && `, ${client.city}`}
                  {client.state && `, ${client.state}`}
                  {client.zip_code && ` ${client.zip_code}`}
                </p>
              </div>
            </div>
          )}

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
                <Calendar className="h-4 w-4" />
                Date
              </div>
              <div className="ml-6">
                <p className="text-sm">{new Date(shift.shift_date).toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
                <Clock className="h-4 w-4" />
                Time
              </div>
              <div className="ml-6">
                <p className="text-sm">
                  {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                  <span className="text-muted-foreground ml-2">
                    ({shift.duration_hours} hours)
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Care Requirements / Needs */}
          {client?.care_requirements && client.care_requirements.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
                <FileText className="h-4 w-4" />
                Care Needs
              </div>
              <div className="ml-6">
                <div className="flex flex-wrap gap-2">
                  {client.care_requirements.map((req: string, idx: number) => (
                    <Badge key={idx} variant="secondary">
                      {req}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Special Instructions */}
          {shift.special_instructions && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
                <FileText className="h-4 w-4" />
                Special Instructions
              </div>
              <div className="ml-6">
                <p className="text-sm whitespace-pre-wrap">{shift.special_instructions}</p>
              </div>
            </div>
          )}

          {/* Assigned Caregiver */}
          {shift.shift_assignments && shift.shift_assignments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold">
                <User className="h-4 w-4" />
                Assigned Caregiver
              </div>
              <div className="ml-6">
                <p className="font-medium">
                  {shift.shift_assignments[0].caregiver?.first_name}{" "}
                  {shift.shift_assignments[0].caregiver?.last_name}
                </p>
                <Badge variant="outline" className="mt-2">
                  {shift.shift_assignments[0].status}
                </Badge>
              </div>
            </div>
          )}

          {/* Quick Assign Button for Unassigned Shifts -- staff-only, so it also needs an onAssign
              handler. Caregiver callers pass none and don't embed shift_assignments, so their own
              assigned shift would otherwise read as unassigned and show a no-op button. */}
          {isUnassigned && onAssign && (
            <div className="mt-6 pt-6 border-t">
              <Button
                className="w-full gap-2"
                onClick={() => {
                  onAssign(shift);
                  onOpenChange(false);
                }}
              >
                <Zap className="h-4 w-4" />
                Assign Caregiver
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
