import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save } from "lucide-react";
import { BrandingCard } from "@/components/virtual-office/BrandingCard";
import { ServiceAreaCard } from "@/components/virtual-office/ServiceAreaCard";
import { OperatingHoursCard } from "@/components/virtual-office/OperatingHoursCard";
import { ContactCard, ContactValues } from "@/components/virtual-office/ContactCard";
import { ComplianceCard } from "@/components/virtual-office/ComplianceCard";
import {
  SchedulingOverridesCard,
  AgencyDefaults,
  OverrideValues,
} from "@/components/virtual-office/SchedulingOverridesCard";
import {
  Branding,
  OperatingHours,
  ServiceArea,
  VirtualOfficeRow,
  normalizeHours,
} from "@/components/virtual-office/types";

const VirtualOfficeConfig = () => {
  const { id } = useParams();
  // S11: the dashboard's "Compliance settings" link opens ?tab=compliance
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [vo, setVo] = useState<VirtualOfficeRow | null>(null);
  const [defaults, setDefaults] = useState<AgencyDefaults>({
    max_weekly_hours: null,
    travel_buffer_minutes: null,
    late_trade_hours: null,
    smart_match_weights: null,
  });

  const [branding, setBranding] = useState<Branding>({});
  const [states, setStates] = useState<string[]>([]);
  const [zipcodes, setZipcodes] = useState<string[]>([]);
  const [area, setArea] = useState<ServiceArea>({});
  const [hours, setHours] = useState<OperatingHours>(normalizeHours({}));
  const [contact, setContact] = useState<ContactValues>({
    contact_email: "",
    contact_phone: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    timezone: "America/New_York",
  });
  const [overrides, setOverrides] = useState<OverrideValues>({
    max_weekly_hours: null,
    travel_buffer_minutes: null,
    late_trade_hours: null,
    smart_match_weights: null,
  });
  const [weightsText, setWeightsText] = useState("");
  const [weightsError, setWeightsError] = useState<string | null>(null);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }
    const { data: role } = await supabase.rpc("get_user_role", { _user_id: session.user.id });
    if (!["system_admin", "agency_admin", "manager"].includes(role as string)) {
      toast.error("Access denied");
      navigate("/dashboard");
      return;
    }
    setCanManage(role === "system_admin" || role === "agency_admin");

    const { data, error } = await supabase
      .from("virtual_office")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      toast.error("Virtual office not found");
      navigate("/virtual-offices");
      return;
    }

    const row = data as unknown as VirtualOfficeRow;
    setVo(row);
    setBranding((row.branding as Branding) || {});
    setStates(row.service_states || []);
    setZipcodes(row.service_zipcodes || []);
    setArea((row.service_area as ServiceArea) || {});
    setHours(normalizeHours(row.operating_hours));
    setContact({
      contact_email: row.contact_email || "",
      contact_phone: row.contact_phone || "",
      address: row.address || "",
      city: row.city || "",
      state: row.state || "",
      zip_code: row.zip_code || "",
      timezone: row.timezone || "America/New_York",
    });
    setOverrides({
      max_weekly_hours: row.max_weekly_hours,
      travel_buffer_minutes: row.travel_buffer_minutes,
      late_trade_hours: row.late_trade_hours,
      smart_match_weights: row.smart_match_weights,
    });
    setWeightsText(row.smart_match_weights ? JSON.stringify(row.smart_match_weights, null, 2) : "");

    const { data: agency } = await supabase
      .from("agency")
      .select("max_weekly_hours, travel_buffer_minutes, late_trade_hours, smart_match_weights")
      .eq("id", row.agency_id)
      .maybeSingle();
    if (agency) setDefaults(agency as AgencyDefaults);

    setLoading(false);
  };

  const handleSave = async () => {
    if (!vo) return;

    let weights: any = null;
    if (weightsText.trim()) {
      try {
        weights = JSON.parse(weightsText);
        setWeightsError(null);
      } catch {
        setWeightsError("Invalid JSON — fix or clear the field to inherit the agency default.");
        toast.error("Smart match weights must be valid JSON");
        return;
      }
    } else {
      setWeightsError(null);
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("virtual_office")
        .update({
          branding: branding as any,
          service_states: states,
          service_zipcodes: zipcodes,
          service_area: area as any,
          operating_hours: hours as any,
          contact_email: contact.contact_email || null,
          contact_phone: contact.contact_phone || null,
          address: contact.address || null,
          city: contact.city || null,
          state: contact.state || null,
          zip_code: contact.zip_code || null,
          timezone: contact.timezone,
          max_weekly_hours: overrides.max_weekly_hours,
          travel_buffer_minutes: overrides.travel_buffer_minutes,
          late_trade_hours: overrides.late_trade_hours,
          smart_match_weights: weights,
        })
        .eq("id", vo.id);

      if (error) throw error;
      toast.success("Virtual office saved");
    } catch {
      toast.error("Failed to save virtual office");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !vo) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Loading virtual office...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate("/virtual-offices")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Virtual Offices
            </Button>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              {vo.name}
              {vo.is_primary && <Badge>Primary</Badge>}
            </h1>
            <p className="text-muted-foreground mt-1">Operating configuration for this office</p>
          </div>
          {canManage && (
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>

        <Tabs defaultValue={search.get("tab") === "compliance" ? "compliance" : "branding"} className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="branding">Branding</TabsTrigger>
            <TabsTrigger value="area">Service Area</TabsTrigger>
            <TabsTrigger value="hours">Operating Hours</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="overrides">Scheduling Overrides</TabsTrigger>
            <TabsTrigger value="compliance" data-testid="tab-compliance">Compliance</TabsTrigger>
          </TabsList>

          <TabsContent value="branding">
            <BrandingCard value={branding} onChange={setBranding} />
          </TabsContent>
          <TabsContent value="area">
            <ServiceAreaCard
              states={states}
              zipcodes={zipcodes}
              area={area}
              onChange={(next) => {
                setStates(next.states);
                setZipcodes(next.zipcodes);
                setArea(next.area);
              }}
            />
          </TabsContent>
          <TabsContent value="hours">
            <OperatingHoursCard value={hours} onChange={setHours} />
          </TabsContent>
          <TabsContent value="contact">
            <ContactCard value={contact} onChange={setContact} />
          </TabsContent>
          <TabsContent value="overrides">
            <SchedulingOverridesCard
              value={overrides}
              defaults={defaults}
              weightsText={weightsText}
              weightsError={weightsError}
              onChange={setOverrides}
              onWeightsTextChange={setWeightsText}
            />
          </TabsContent>
          <TabsContent value="compliance">
            <ComplianceCard officeId={vo.id} officeName={vo.name} canManage={canManage} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default VirtualOfficeConfig;
