import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Calendar, Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";

interface TimeOffRequest {
  id: string;
  start_date: string;
  end_date: string;
  request_type: string;
  reason: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const CaregiverTimeOff = () => {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    start_date: "",
    end_date: "",
    request_type: "vacation",
    reason: ""
  });

  useEffect(() => {
    fetchCaregiverAndRequests();
  }, []);

  const fetchCaregiverAndRequests = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      // Get caregiver ID
      const { data: caregiverData } = await supabase
        .from("caregivers")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (caregiverData) {
        setCaregiverId(caregiverData.id);

        // Fetch time off requests
        const { data: requestsData, error } = await supabase
          .from("time_off_requests")
          .select("*")
          .eq("caregiver_id", caregiverData.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setRequests(requestsData || []);
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to load time off requests");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRequest = async () => {
    if (!caregiverId) {
      toast.error("Caregiver profile not found");
      return;
    }

    if (!formData.start_date || !formData.end_date) {
      toast.error("Please select both start and end dates");
      return;
    }

    try {
      const { error } = await supabase
        .from("time_off_requests")
        // agency_id is derived server-side from the caregiver record
        .insert([{
          caregiver_id: caregiverId,
          start_date: formData.start_date,
          end_date: formData.end_date,
          request_type: formData.request_type as any,
          reason: formData.reason || null,
          status: "pending" as any
        }] as any);

      if (error) throw error;

      toast.success("Time off request submitted successfully!");
      setIsDialogOpen(false);
      setFormData({
        start_date: "",
        end_date: "",
        request_type: "vacation",
        reason: ""
      });
      fetchCaregiverAndRequests();
    } catch (error: any) {
      console.error("Error:", error);
      toast.error(error.message || "Failed to submit request");
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
      approved: "bg-green-500/10 text-green-600 border-green-500/20",
      denied: "bg-red-500/10 text-red-600 border-red-500/20"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  const getRequestTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      vacation: "Vacation",
      sick: "Sick Leave",
      personal: "Personal Day",
      emergency: "Emergency"
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <CaregiverAppShell>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </CaregiverAppShell>
    );
  }

  return (
    <CaregiverAppShell>
    <div className="-mx-4 -mt-5">
      <header className="bg-gradient-to-r from-primary/10 via-primary/5 to-background border-b">
        <div className="container mx-auto px-4 py-6">
          <Button
            variant="ghost"
            onClick={() => navigate("/caregiver-settings")}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Profile
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Time Off Requests</h1>
              <p className="text-muted-foreground mt-1">
                Manage your vacation and sick leave
              </p>
            </div>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Request
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {requests.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No time off requests</h3>
              <p className="text-muted-foreground mb-4">
                You haven't submitted any time off requests yet
              </p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Submit Your First Request
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {requests.map((request) => (
              <Card key={request.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {getRequestTypeLabel(request.request_type)}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {format(new Date(request.start_date), "MMM d, yyyy")} - {format(new Date(request.end_date), "MMM d, yyyy")}
                      </p>
                    </div>
                    <Badge className={getStatusColor(request.status)}>
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </Badge>
                  </div>
                </CardHeader>
                {(request.reason || request.notes) && (
                  <CardContent>
                    {request.reason && (
                      <div className="mb-2">
                        <p className="text-sm font-medium mb-1">Reason:</p>
                        <p className="text-sm text-muted-foreground">{request.reason}</p>
                      </div>
                    )}
                    {request.notes && (
                      <div>
                        <p className="text-sm font-medium mb-1">Manager Notes:</p>
                        <p className="text-sm text-muted-foreground">{request.notes}</p>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New Request Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Time Off</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Request Type</Label>
              <Select
                value={formData.request_type}
                onValueChange={(value) => setFormData({ ...formData, request_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacation">Vacation</SelectItem>
                  <SelectItem value="sick">Sick Leave</SelectItem>
                  <SelectItem value="personal">Personal Day</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                min={format(new Date(), "yyyy-MM-dd")}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                min={formData.start_date || format(new Date(), "yyyy-MM-dd")}
              />
            </div>
            <div className="space-y-2">
              <Label>Reason (Optional)</Label>
              <Textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Explain why you need time off..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitRequest}>
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </CaregiverAppShell>
  );
};

export default CaregiverTimeOff;
