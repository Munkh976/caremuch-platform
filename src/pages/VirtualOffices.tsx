import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Network, Plus, Settings2 } from "lucide-react";
import { CreateVirtualOfficeDialog } from "@/components/virtual-office/CreateVirtualOfficeDialog";
import { ROW_OPEN_CLASS, rowOpenProps } from "@/lib/rowOpen";
import { cn } from "@/lib/utils";

interface VoRow {
  id: string;
  name: string;
  code: string | null;
  is_primary: boolean;
  is_active: boolean;
  city: string | null;
  state: string | null;
}

const VirtualOffices = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [offices, setOffices] = useState<VoRow[]>([]);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("agency_id")
      .eq("id", session.user.id)
      .maybeSingle();

    if (!profile?.agency_id) {
      toast.error("No agency associated with this account");
      setLoading(false);
      return;
    }
    setAgencyId(profile.agency_id);
    await fetchOffices(profile.agency_id);
    setLoading(false);
  };

  const fetchOffices = async (aid: string) => {
    const { data, error } = await supabase
      .from("virtual_office")
      .select("id, name, code, is_primary, is_active, city, state")
      .eq("agency_id", aid)
      .order("is_primary", { ascending: false })
      .order("name");

    if (error) {
      toast.error("Failed to load virtual offices");
      return;
    }
    setOffices(data || []);
  };

  const toggleActive = async (vo: VoRow, next: boolean) => {
    if (vo.is_primary && !next) {
      toast.error("The primary office cannot be deactivated");
      return;
    }
    const { error } = await supabase
      .from("virtual_office")
      .update({ is_active: next })
      .eq("id", vo.id);
    if (error) {
      toast.error("Failed to update office status");
      return;
    }
    toast.success(next ? "Office activated" : "Office deactivated");
    if (agencyId) fetchOffices(agencyId);
  };

  const makePrimary = async (vo: VoRow) => {
    if (!agencyId || vo.is_primary) return;
    if (!vo.is_active) {
      toast.error("Activate the office before making it primary");
      return;
    }
    // Demote the current primary first — a partial unique index allows only one.
    const current = offices.find((o) => o.is_primary);
    if (current) {
      const { error: demoteError } = await supabase
        .from("virtual_office")
        .update({ is_primary: false })
        .eq("id", current.id);
      if (demoteError) {
        toast.error("Failed to update primary office");
        return;
      }
    }
    const { error } = await supabase
      .from("virtual_office")
      .update({ is_primary: true })
      .eq("id", vo.id);
    if (error) {
      // Restore the previous primary if promotion failed.
      if (current) {
        await supabase.from("virtual_office").update({ is_primary: true }).eq("id", current.id);
      }
      toast.error("Failed to set primary office");
      return;
    }
    toast.success(`${vo.name} is now the primary office`);
    fetchOffices(agencyId);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Loading virtual offices...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Network className="h-8 w-8 text-primary" />
              Virtual Offices
            </h1>
            <p className="text-muted-foreground mt-1">
              Operating sub-units of your agency — branding, service area and hours.{" "}
              <button
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => navigate("/agency-settings")}
              >
                Agency legal details
              </button>{" "}
              are managed in Agency Settings.
            </p>
          </div>
          {canManage && agencyId && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Office
            </Button>
          )}
        </div>

        {offices.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No virtual offices yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {offices.map((vo) => (
              // The whole card opens the office like Configure; the switch and the buttons do only their own job.
              <Card key={vo.id} data-office-card={vo.id} {...rowOpenProps(() => navigate(`/virtual-offices/${vo.id}`))}
                className={cn(ROW_OPEN_CLASS, "hover:bg-muted/40")}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <Link to={`/virtual-offices/${vo.id}`} className="text-primary underline-offset-4 hover:underline">{vo.name}</Link>
                        {vo.is_primary && <Badge>Primary</Badge>}
                        <Badge variant={vo.is_active ? "secondary" : "outline"}>
                          {vo.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        {[vo.code, [vo.city, vo.state].filter(Boolean).join(", ")]
                          .filter(Boolean)
                          .join(" · ") || "No code set"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={vo.is_active}
                      disabled={!canManage || vo.is_primary}
                      onCheckedChange={(c) => toggleActive(vo, c)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {vo.is_primary ? "Primary office is always active" : "Active"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {canManage && !vo.is_primary && (
                      <Button variant="outline" size="sm" onClick={() => makePrimary(vo)}>
                        Make Primary
                      </Button>
                    )}
                    <Button size="sm" onClick={() => navigate(`/virtual-offices/${vo.id}`)}>
                      <Settings2 className="h-4 w-4 mr-2" />
                      Configure
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {agencyId && (
        <CreateVirtualOfficeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          agencyId={agencyId}
          onCreated={() => fetchOffices(agencyId)}
        />
      )}
    </AppLayout>
  );
};

export default VirtualOffices;
