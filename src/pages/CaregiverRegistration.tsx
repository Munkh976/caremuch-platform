import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Activity, ArrowLeft, CheckCircle2 } from "lucide-react";
import { caregiverRegistrationSchema, firstError } from "@/lib/validation";
import { US_STATES } from "@/constants/usStates";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { ScoreResult } from "@/lib/flowEngine";
import { useCareServices } from "@/hooks/useCareServices";

const CaregiverRegistration = () => {
  const navigate = useNavigate();
  const { groupedOptions, isLoading: servicesLoading } = useCareServices();
  const [loading, setLoading] = useState(false);
  const [screening, setScreening] = useState<{
    sessionId: string | null;
    score: ScoreResult | null;
    link: (registrationId: string) => Promise<void>;
  } | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    phone: "",
    firstName: "",
    lastName: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    employmentType: "full_time",
    hourlyRate: "",
    careTypeCodes: [] as string[],
  });

  const handleCareServiceToggle = (code: string, checked: boolean | "indeterminate") => {
    setFormData((current) => ({
      ...current,
      careTypeCodes: checked === true
        ? Array.from(new Set([...current.careTypeCodes, code]))
        : current.careTypeCodes.filter((existing) => existing !== code),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const parsed = caregiverRegistrationSchema.safeParse(formData);
      if (!parsed.success) {
        toast.error(firstError(parsed));
        return;
      }

      const values = parsed.data;

      // Goes through submit_caregiver_registration (not a direct insert) --
      // this route (/caregiver-registration) is a generic, agency-less public page
      // (same class of gap as /assistant), so the RPC's fallback chain (M-Office
      // plan §3d/§5) is what attributes the submission to a real agency/office
      // instead of leaving both NULL.
      const { data: registrationId, error: regError } = await supabase.rpc("submit_caregiver_registration", {
        p_first_name: values.firstName,
        p_last_name: values.lastName,
        p_phone: values.phone,
        p_email: values.email,
        p_care_type_codes: values.careTypeCodes,
        p_hourly_rate: values.hourlyRate ? parseFloat(values.hourlyRate) : null,
        p_address: values.address || null,
        p_city: values.city || null,
        p_state: values.state || null,
        p_zip_code: values.zipCode || null,
        p_employment_type: values.employmentType,
      });

      if (regError) throw regError;

      if (screening?.sessionId) {
        await screening.link(registrationId as string);
      }

      toast.success("Application submitted successfully. You can sign in after a manager approves your application.");
      navigate("/auth");
    } catch (error: any) {
      toast.error(error.message || "Failed to submit registration");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5 p-4">
      <div className="container mx-auto max-w-3xl py-8">
        <Button variant="ghost" onClick={() => navigate("/auth")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Login
        </Button>

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-accent">
              <Activity className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
            Caregiver Registration
          </h1>
          <p className="text-muted-foreground">Join our network of professional caregivers</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Apply to Join CareMuch</CardTitle>
            <CardDescription>
              Submit your caregiver application for manager review. Login access is created only after approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!screening ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Step 1 of 2 — answer a few quick questions so our team can get to know you. Your
                  answers are attached to your application.
                </p>
                <ChatWidget
                  audience="caregiver_screening"
                  title="Caregiver screening"
                  completionTitle="Screening complete"
                  completionMessage="Now finish your application details below."
                  onComplete={(payload) =>
                    setScreening({
                      sessionId: payload.sessionId,
                      score: payload.score,
                      link: payload.linkRegistration,
                    })
                  }
                />
              </div>
            ) : (
            <>
            {screening && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Screening answers saved — they will be attached to this application.
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Select
                    value={formData.state}
                    onValueChange={(value) => setFormData({ ...formData, state: value })}
                  >
                    <SelectTrigger id="state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {US_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code *</Label>
                  <Input
                    id="zipCode"
                    inputMode="numeric"
                    placeholder="12345"
                    maxLength={10}
                    value={formData.zipCode}
                    onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employmentType">Employment Type</Label>
                  <Select
                    value={formData.employmentType}
                    onValueChange={(value) => setFormData({ ...formData, employmentType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full Time</SelectItem>
                      <SelectItem value="part_time">Part Time</SelectItem>
                      <SelectItem value="on_call">On Call</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hourlyRate">Desired Hourly Rate ($)</Label>
                  <Input
                    id="hourlyRate"
                    type="number"
                    step="0.01"
                    value={formData.hourlyRate}
                    onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>Care Services *</Label>
                  <p className="text-sm text-muted-foreground">
                    Select the services you can provide. These become your caregiver service profile after approval.
                  </p>
                </div>
                {servicesLoading ? (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    Loading Care Services...
                  </div>
                ) : groupedOptions.length === 0 ? (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    No active Care Services are available right now.
                  </div>
                ) : (
                  <div className="space-y-4 rounded-lg border border-border p-4">
                    {groupedOptions.map((group) => (
                      <div key={group.label} className="space-y-2">
                        <p className="text-sm font-medium">{group.label}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {group.options.map((option) => (
                            <label
                              key={option.value}
                              htmlFor={`care-service-${option.value}`}
                              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm transition-colors hover:bg-muted/50"
                            >
                              <Checkbox
                                id={`care-service-${option.value}`}
                                checked={formData.careTypeCodes.includes(option.value)}
                                onCheckedChange={(checked) => handleCareServiceToggle(option.value, checked)}
                                className="mt-0.5"
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Submitting..." : "Submit Registration"}
              </Button>
            </form>
            </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CaregiverRegistration;
