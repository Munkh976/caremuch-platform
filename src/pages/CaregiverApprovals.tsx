import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, Mail, Phone, MapPin } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AppLayout } from "@/components/AppLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { ScreeningResultDialog, ScreeningSession } from "@/components/caregivers/ScreeningResultDialog";
import { BAND_LABELS, ScoreBand } from "@/lib/flowEngine";
import { ClipboardList } from "lucide-react";
import { useCareServices } from "@/hooks/useCareServices";
import { Input } from "@/components/ui/input";
import { OneTimeLinkDialog } from "@/components/auth/OneTimeLinkDialog";
import type { AccountLinkResponse } from "@/lib/accountLinks";
import { UnassignedRegistrations } from "@/components/approvals/UnassignedRegistrations";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CaregiverRegistration {
  id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  employment_type: string;
  hourly_rate: number | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  rejection_reason?: string | null;
  agency_id: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  availability?: any;
  care_type_codes?: string[];
  updated_at?: string;
  virtual_office_id?: string | null;
  notes?: string | null;
}

interface OfficeOption {
  id: string;
  name: string;
}

const CaregiverApprovals = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userRole, hasPermission } = usePermissions();
  const { optionFor, groupedOptions } = useCareServices();
  const [registrations, setRegistrations] = useState<CaregiverRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Mode B (security plan §15): a one-time set-password link, shown once, never stored.
  const [credentials, setCredentials] = useState<{ email: string; link: string | null; existing: boolean } | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [screenings, setScreenings] = useState<Record<string, ScreeningSession>>({});
  const [openScreening, setOpenScreening] = useState<CaregiverRegistration | null>(null);
  const [offices, setOffices] = useState<OfficeOption[]>([]);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [bandFilter, setBandFilter] = useState("all");
  const [officeFilter, setOfficeFilter] = useState("all");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; registrationId: string | null; reason: string }>({
    open: false,
    registrationId: null,
    reason: ""
  });

  useEffect(() => {
    checkAuthAndFetch();
  }, []);

  const checkAuthAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }
    fetchRegistrations();
    fetchOffices();
  };

  const fetchOffices = async () => {
    const { data } = await supabase
      .from("virtual_office")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    setOffices((data as OfficeOption[]) ?? []);
  };

  const saveNote = async (registrationId: string) => {
    setSavingNote(registrationId);
    const { error } = await supabase
      .from("caregiver_registrations")
      .update({ notes: noteDrafts[registrationId] ?? "" } as never)
      .eq("id", registrationId);
    setSavingNote(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setRegistrations((rows) =>
      rows.map((r) => (r.id === registrationId ? { ...r, notes: noteDrafts[registrationId] ?? "" } : r))
    );
    toast({ title: "Note saved" });
  };

  const fetchRegistrations = async () => {
    try {
      const { data, error } = await supabase
        .from("caregiver_registrations")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRegistrations(data as CaregiverRegistration[] || []);

      const ids = (data || []).map((r: any) => r.id);
      if (ids.length) {
        const { data: sessions } = await supabase
          .from("conversation_sessions")
          .select("id, registration_id, status, total_score, band, trait_scores, completed_at, started_at")
          .in("registration_id", ids)
          .order("completed_at", { ascending: false });
        const map: Record<string, ScreeningSession> = {};
        (sessions || []).forEach((s: any) => {
          if (s.registration_id && !map[s.registration_id]) map[s.registration_id] = s as ScreeningSession;
        });
        setScreenings(map);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (registration: CaregiverRegistration) => {
    setProcessingId(registration.id);
    try {
      const { data, error } = await supabase.functions.invoke("approve-caregiver-registration", {
        body: { registrationId: registration.id, action: "approve" },
      });
      if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
      if ((data as AccountLinkResponse | null)?.error) throw new Error((data as AccountLinkResponse | null).error);

      setCredentials({ email: registration.email, link: (data as AccountLinkResponse | null)?.setPasswordLink ?? null, existing: !!(data as AccountLinkResponse | null)?.existingAccount });
      toast({
        title: "Caregiver approved",
        description: "Their login is active and they were added to your team",
      });
      fetchRegistrations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectDialog.registrationId) return;

    try {
      const { data, error } = await supabase.functions.invoke("approve-caregiver-registration", {
        body: {
          registrationId: rejectDialog.registrationId,
          action: "reject",
          rejectionReason: rejectDialog.reason,
        },
      });
      if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
      if ((data as AccountLinkResponse | null)?.error) throw new Error((data as AccountLinkResponse | null).error);

      toast({
        title: "Registration Rejected",
        description: "A notice was recorded in the notification outbox",
      });
      setRejectDialog({ open: false, registrationId: null, reason: "" });
      fetchRegistrations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: any = {
      pending: "bg-warning/10 text-warning border-warning/20",
      approved: "bg-success/10 text-success border-success/20",
      rejected: "bg-destructive/10 text-destructive border-destructive/20",
    };
    return <Badge variant="outline" className={variants[status]}>{status}</Badge>;
  };

  const term = search.trim().toLowerCase();
  const place = locationFilter.trim().toLowerCase();
  const filteredRegistrations = registrations.filter((reg) => {
    if (filter !== 'all' && reg.status !== filter) return false;
    if (
      term &&
      ![reg.first_name, reg.last_name, reg.email, reg.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    )
      return false;
    if (
      place &&
      ![reg.city, reg.state, reg.zip_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(place))
    )
      return false;
    if (serviceFilter !== 'all' && !(reg.care_type_codes ?? []).includes(serviceFilter)) return false;
    if (employmentFilter !== 'all' && reg.employment_type !== employmentFilter) return false;
    if (officeFilter !== 'all') {
      if (officeFilter === 'none' ? !!reg.virtual_office_id : reg.virtual_office_id !== officeFilter)
        return false;
    }
    if (bandFilter !== 'all') {
      const band = screenings[reg.id]?.band ?? null;
      if (bandFilter === 'unscreened' ? !!screenings[reg.id] : band !== bandFilter) return false;
    }
    return true;
  });
  const canReviewApplications =
    !!userRole &&
    ["agency_admin", "manager", "hr_staff"].includes(userRole) &&
    hasPermission("caregiver_approvals", "update");

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div>
        {userRole === "system_admin" && <UnassignedRegistrations onAssigned={fetchRegistrations} />}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Caregiver Applications</h1>
            <p className="text-muted-foreground">Review and approve caregiver registrations</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              variant={filter === 'pending' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('pending')}
            >
              Pending
            </Button>
            <Button
              variant={filter === 'approved' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('approved')}
            >
              Approved
            </Button>
            <Button
              variant={filter === 'rejected' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('rejected')}
            >
              Rejected
            </Button>
          </div>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or phone"
          />
          <Input
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            placeholder="City, state or ZIP"
          />
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger><SelectValue placeholder="All Care Services" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Care Services</SelectItem>
              {groupedOptions.flatMap((group) =>
                group.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Select value={employmentFilter} onValueChange={setEmploymentFilter}>
            <SelectTrigger><SelectValue placeholder="Any employment type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any employment type</SelectItem>
              <SelectItem value="full_time">Full time</SelectItem>
              <SelectItem value="part_time">Part time</SelectItem>
              <SelectItem value="on_call">On call</SelectItem>
            </SelectContent>
          </Select>
          <Select value={bandFilter} onValueChange={setBandFilter}>
            <SelectTrigger><SelectValue placeholder="Any screening result" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any screening result</SelectItem>
              <SelectItem value="strong_fit">Strong fit</SelectItem>
              <SelectItem value="review">Needs review</SelectItem>
              <SelectItem value="not_a_fit">Not a fit</SelectItem>
              <SelectItem value="unscreened">No screening</SelectItem>
            </SelectContent>
          </Select>
          {offices.length > 1 && (
            <Select value={officeFilter} onValueChange={setOfficeFilter}>
              <SelectTrigger><SelectValue placeholder="All offices" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All offices</SelectItem>
                {offices.map((office) => (
                  <SelectItem key={office.id} value={office.id}>{office.name}</SelectItem>
                ))}
                <SelectItem value="none">No office (direct form)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="grid gap-4">
          {filteredRegistrations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No applications found</p>
              </CardContent>
            </Card>
          ) : (
            filteredRegistrations.map((registration) => (
              <Card key={registration.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <CardTitle className="text-xl">
                        {registration.first_name} {registration.last_name}
                      </CardTitle>
                      <CardDescription className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-4 w-4" />
                          {registration.email}
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-4 w-4" />
                          {registration.phone}
                        </div>
                        {registration.city && (
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="h-4 w-4" />
                            {registration.city}, {registration.state} {registration.zip_code}
                          </div>
                        )}
                      </CardDescription>
                    </div>
                    {getStatusBadge(registration.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-medium mb-1">Employment Type</p>
                      <p className="text-muted-foreground capitalize">{registration.employment_type.replace('_', ' ')}</p>
                    </div>
                    <div>
                      <p className="font-medium mb-1">Desired Rate</p>
                      <p className="text-muted-foreground">${registration.hourly_rate}/hr</p>
                    </div>
                  </div>

                  <div>
                    <p className="font-medium mb-2 text-sm">Care Services</p>
                    {registration.care_type_codes && registration.care_type_codes.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {registration.care_type_codes.map((code) => (
                          <Badge key={code} variant="secondary">
                            {optionFor(code).label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No Care Services selected.</p>
                    )}
                  </div>

                  {registration.rejection_reason && (
                    <div className="bg-destructive/10 p-3 rounded-lg">
                      <p className="font-medium text-sm text-destructive mb-1">Rejection Reason</p>
                      <p className="text-sm text-muted-foreground">{registration.rejection_reason}</p>
                    </div>
                  )}

                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    {screenings[registration.id] ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">Assistant screening</span>
                          <Badge
                            variant={
                              screenings[registration.id].band === "strong_fit" ? "default" : "secondary"
                            }
                          >
                            {screenings[registration.id].band
                              ? BAND_LABELS[screenings[registration.id].band as ScoreBand] ??
                                screenings[registration.id].band
                              : "Not scored"}
                          </Badge>
                          <span className="text-muted-foreground">
                            Score {screenings[registration.id].total_score}
                          </span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setOpenScreening(registration)}>
                          <ClipboardList className="mr-2 h-4 w-4" />
                          View transcript
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No assistant screening was completed with this application.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`note-${registration.id}`} className="text-sm font-medium">
                      Internal notes
                    </Label>
                    <Textarea
                      id={`note-${registration.id}`}
                      rows={2}
                      placeholder="Notes for your team (not shared with the applicant)"
                      value={noteDrafts[registration.id] ?? registration.notes ?? ""}
                      onChange={(e) =>
                        setNoteDrafts((drafts) => ({ ...drafts, [registration.id]: e.target.value }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        savingNote === registration.id ||
                        (noteDrafts[registration.id] ?? registration.notes ?? "") === (registration.notes ?? "")
                      }
                      onClick={() => saveNote(registration.id)}
                    >
                      {savingNote === registration.id ? "Saving..." : "Save note"}
                    </Button>
                  </div>

                  {registration.status === "pending" && canReviewApplications && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="bg-success hover:bg-success/90 text-primary-foreground"
                        disabled={processingId === registration.id}
                        onClick={() => handleApprove(registration)}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {processingId === registration.id ? "Approving..." : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/20 hover:bg-destructive/10"
                        onClick={() => setRejectDialog({ open: true, registrationId: registration.id, reason: "" })}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Dialog open={rejectDialog.open} onOpenChange={(open) => setRejectDialog({ ...rejectDialog, open })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Application</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejection. This will be shared with the applicant.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reason">Reason for Rejection</Label>
                <Textarea
                  id="reason"
                  placeholder="Enter reason..."
                  value={rejectDialog.reason}
                  onChange={(e) => setRejectDialog({ ...rejectDialog, reason: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialog({ open: false, registrationId: null, reason: "" })}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={!rejectDialog.reason.trim()}>
                Reject Application
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <OneTimeLinkDialog
          open={!!credentials}
          onClose={() => setCredentials(null)}
          title="Account activated"
          email={credentials?.email ?? null}
          link={credentials?.link ?? null}
          existingAccount={credentials?.existing}
        />

        <ScreeningResultDialog
          open={!!openScreening}
          onOpenChange={(open) => !open && setOpenScreening(null)}
          session={openScreening ? screenings[openScreening.id] ?? null : null}
          applicantName={
            openScreening ? `${openScreening.first_name} ${openScreening.last_name}` : ""
          }
          applicantEmail={openScreening?.email ?? ""}
        />
      </div>
    </AppLayout>
  );
};

export default CaregiverApprovals;
