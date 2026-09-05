import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Save, Loader2 } from "lucide-react";
import { US_STATES } from "@/constants/usStates";
import { agencyFormSchema } from "@/lib/validation";

interface BackfillResult {
  scope: string;
  agency_total_chunks: number;
  agency_null_candidates_at_start: number;
  embedded_this_run: number;
  batch_count: number;
  agency_remaining_null: number;
  errors: { chunk_id: string; message: string }[];
}

interface IngestResult {
  document_id: string;
  ingestion_status: string;
  chunk_count?: number;
  ingestion_error?: string;
  error?: string;
}

interface AgencyData {
  id: string;
  agency_name: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  phone?: string;
  email?: string;
  website?: string;
  naics_code?: string;
  business_type?: string;
  tax_id?: string;
  is_active?: boolean;
}

const AgencySettings = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agencyData, setAgencyData] = useState<AgencyData | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      navigate("/auth");
      return;
    }

    // Check if user has agency_admin or system_admin role
    const { data: roleData } = await supabase.rpc('get_user_role', { _user_id: session.user.id });
    
    if (roleData !== 'system_admin' && roleData !== 'agency_admin') {
      toast.error("Access denied. Agency admin role required.");
      navigate("/dashboard");
      return;
    }

    await fetchAgencyData(session.user.id);
    setLoading(false);
  };

  const fetchAgencyData = async (userId: string) => {
    try {
      // Get user's agency_id from profiles
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) throw profileError;

      if (!profileData?.agency_id) {
        toast.error("No agency associated with this account");
        return;
      }

      // Fetch agency data
      const { data: agency, error: agencyError } = await supabase
        .from("agency")
        .select("*")
        .eq("id", profileData.agency_id)
        .maybeSingle();

      if (agencyError) throw agencyError;

      setAgencyData(agency);
    } catch (error) {
      toast.error("Failed to load agency data");
    }
  };

  const handleSave = async () => {
    if (!agencyData) return;

    // Validate form data
    const validation = agencyFormSchema.safeParse(agencyData);
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("agency")
        .update({
          agency_name: agencyData.agency_name,
          address: agencyData.address,
          city: agencyData.city,
          state: agencyData.state,
          zip_code: agencyData.zip_code,
          phone: agencyData.phone,
          email: agencyData.email,
          website: agencyData.website,
          naics_code: agencyData.naics_code,
          business_type: agencyData.business_type,
          tax_id: agencyData.tax_id,
          is_active: agencyData.is_active,
        })
        .eq("id", agencyData.id);

      if (error) throw error;

      toast.success("Agency settings saved successfully");
    } catch (error) {
      toast.error("Failed to save agency settings");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof AgencyData, value: any) => {
    if (!agencyData) return;
    setAgencyData({ ...agencyData, [field]: value });
  };

  // Phase 3 Tranche 3B: STAFF-ONLY TEST HARNESS for the ingestion mechanism, not a
  // real agency-facing upload surface -- mechanism-only phase, synthetic files only.
  // surface defaults to 'caregiver' (the safe direction, matching 3A) but is always
  // sent explicitly; the ingest function itself has no default and would reject an
  // omitted value.
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [ingestTitle, setIngestTitle] = useState("");
  const [ingestSurface, setIngestSurface] = useState<"caregiver" | "public">("caregiver");
  const [ingestLanguage, setIngestLanguage] = useState<"en" | "es">("en");
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const handleIngestDocument = async () => {
    if (!ingestFile || !agencyData || !ingestTitle.trim()) return;
    setIngestLoading(true);
    setIngestResult(null);
    setIngestError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const storagePath = `${agencyData.id}/${crypto.randomUUID()}/${ingestFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-uploads")
        .upload(storagePath, ingestFile);
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data, error } = await supabase.functions.invoke("ingest-knowledge-document", {
        body: {
          storage_path: storagePath,
          filename: ingestFile.name,
          surface: ingestSurface,
          language: ingestLanguage,
          title: ingestTitle.trim(),
        },
      });
      if (error) {
        const bodyText = await (error as any)?.context?.text?.().catch(() => null);
        throw new Error(bodyText || error.message);
      }
      const result = data as IngestResult;
      if (result.error) throw new Error(result.error);

      setIngestResult(result);
      if (result.ingestion_status === "ready") {
        toast.success(`Ingested ${result.chunk_count} chunk(s)`);
      } else {
        toast.error(result.ingestion_error || "Ingestion did not complete");
      }
    } catch (err: any) {
      setIngestError(err.message || "Failed to ingest document");
      toast.error(err.message || "Failed to ingest document");
    } finally {
      setIngestLoading(false);
    }
  };

  // Reuses the same invoke + error-unwrap pattern as AdminUtilities.tsx's
  // handleLinkExistingAccounts. This UI gate (the page's own checkAuth guard,
  // system_admin/agency_admin) is convenience only -- backfill-knowledge-embeddings
  // enforces 401-anon/403-wrong-role itself, server-side, regardless.
  const handleRunKnowledgeBackfill = async () => {
    setBackfillLoading(true);
    setBackfillResult(null);
    setBackfillError(null);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-knowledge-embeddings");
      if (error) {
        const bodyText = await (error as any)?.context?.text?.().catch(() => null);
        throw new Error(bodyText || error.message);
      }
      if ((data as any)?.error) {
        throw new Error((data as any).error);
      }
      setBackfillResult(data as BackfillResult);
      toast.success(`Embedded ${(data as BackfillResult).embedded_this_run} chunk(s) this run`);
    } catch (err: any) {
      setBackfillError(err.message || "Failed to run knowledge base backfill");
      toast.error(err.message || "Failed to run knowledge base backfill");
    } finally {
      setBackfillLoading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Loading agency settings...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!agencyData) {
    return (
      <AppLayout>
        <div className="text-center py-8">
          <p className="text-muted-foreground">No agency data found</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Building2 className="h-8 w-8 text-primary" />
              Agency Settings
            </h1>
            <p className="text-muted-foreground mt-1">Manage your agency business information</p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>General agency details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agency_name">Agency Name *</Label>
                <Input
                  id="agency_name"
                  value={agencyData.agency_name}
                  onChange={(e) => updateField("agency_name", e.target.value)}
                  placeholder="Enter agency name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business_type">Business Type</Label>
                <Input
                  id="business_type"
                  value={agencyData.business_type || ""}
                  onChange={(e) => updateField("business_type", e.target.value)}
                  placeholder="e.g., LLC, Corporation, Partnership"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={agencyData.phone || ""}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={agencyData.email || ""}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder="contact@agency.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={agencyData.website || ""}
                onChange={(e) => updateField("website", e.target.value)}
                placeholder="https://www.agency.com"
              />
            </div>
          </CardContent>
        </Card>

        {/* Address Information */}
        <Card>
          <CardHeader>
            <CardTitle>Address Information</CardTitle>
            <CardDescription>Physical business location</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                value={agencyData.address || ""}
                onChange={(e) => updateField("address", e.target.value)}
                placeholder="123 Main Street"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={agencyData.city || ""}
                  onChange={(e) => updateField("city", e.target.value)}
                  placeholder="City"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Select value={agencyData.state || ""} onValueChange={(value) => updateField("state", value)}>
                  <SelectTrigger id="state">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((state) => (
                      <SelectItem key={state.value} value={state.value}>
                        {state.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip_code">ZIP Code</Label>
                <Input
                  id="zip_code"
                  value={agencyData.zip_code || ""}
                  onChange={(e) => updateField("zip_code", e.target.value)}
                  placeholder="12345"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Information */}
        <Card>
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
            <CardDescription>Tax and industry classification details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tax_id">Tax ID / EIN</Label>
                <Input
                  id="tax_id"
                  value={agencyData.tax_id || ""}
                  onChange={(e) => updateField("tax_id", e.target.value)}
                  placeholder="XX-XXXXXXX"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="naics_code">NAICS Code</Label>
                <Input
                  id="naics_code"
                  value={agencyData.naics_code || ""}
                  onChange={(e) => updateField("naics_code", e.target.value)}
                  placeholder="621610 (Home Health Care Services)"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Base */}
        <Card>
          <CardHeader>
            <CardTitle>Knowledge Base</CardTitle>
            <CardDescription>
              Embed knowledge base chunks that don't yet have a vector embedding. Safe to
              run repeatedly -- already-embedded chunks are skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleRunKnowledgeBackfill} disabled={backfillLoading}>
              {backfillLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run Embedding Backfill
            </Button>

            {backfillError && (
              <p className="text-sm text-red-600">{backfillError}</p>
            )}

            {backfillResult && (
              <div className="rounded-md border bg-muted p-4 text-sm space-y-1">
                <p className="text-muted-foreground">{backfillResult.scope}</p>
                <p>Total chunks (your agency): {backfillResult.agency_total_chunks}</p>
                <p>Missing embedding at start: {backfillResult.agency_null_candidates_at_start}</p>
                <p>Embedded this run: {backfillResult.embedded_this_run}</p>
                <p>Batches processed: {backfillResult.batch_count}</p>
                <p>Still missing embedding: {backfillResult.agency_remaining_null}</p>
                {backfillResult.errors?.length > 0 && (
                  <div>
                    <p className="font-semibold text-red-600 mt-2">Errors:</p>
                    <ul className="list-disc list-inside">
                      {backfillResult.errors.map((e, i) => (
                        <li key={i}>{e.chunk_id}: {e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Document Ingestion (Tranche 3B test harness) */}
        <Card>
          <CardHeader>
            <CardTitle>Document Ingestion (Test Harness)</CardTitle>
            <CardDescription>
              Mechanism-only test harness for Phase 3 Tranche 3B -- synthetic test
              files only, not a real agency upload surface yet. PDF, DOCX, or TXT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ingest-title">Title</Label>
                <Input
                  id="ingest-title"
                  value={ingestTitle}
                  onChange={(e) => setIngestTitle(e.target.value)}
                  placeholder="Test document title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ingest-file">File (.pdf, .docx, .txt)</Label>
                <Input
                  id="ingest-file"
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => setIngestFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ingest-surface">Surface</Label>
                <Select value={ingestSurface} onValueChange={(v) => setIngestSurface(v as "caregiver" | "public")}>
                  <SelectTrigger id="ingest-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caregiver">Caregiver (private)</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ingest-language">Language</Label>
                <Select value={ingestLanguage} onValueChange={(v) => setIngestLanguage(v as "en" | "es")}>
                  <SelectTrigger id="ingest-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleIngestDocument} disabled={ingestLoading || !ingestFile || !ingestTitle.trim()}>
              {ingestLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ingest Document
            </Button>

            {ingestError && <p className="text-sm text-red-600">{ingestError}</p>}

            {ingestResult && (
              <div className="rounded-md border bg-muted p-4 text-sm space-y-1">
                <p>Document ID: {ingestResult.document_id}</p>
                <p>Status: {ingestResult.ingestion_status}</p>
                {ingestResult.chunk_count !== undefined && <p>Chunks: {ingestResult.chunk_count}</p>}
                {ingestResult.ingestion_error && (
                  <p className="text-red-600">{ingestResult.ingestion_error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AgencySettings;
