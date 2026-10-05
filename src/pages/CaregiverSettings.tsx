import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarOff, ChevronRight, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { CaregiverProfileSettings } from "@/components/caregivers/CaregiverProfileSettings";
import { toast } from "sonner";

const CaregiverSettings = () => {
  const navigate = useNavigate();
  const [caregiverProfile, setCaregiverProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCaregiverProfile();
  }, []);

  const fetchCaregiverProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: caregiver, error } = await supabase
        .from("caregivers")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;
      setCaregiverProfile(caregiver);
    } catch (error: any) {
      toast.error("Failed to load profile");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Sign out lives here now: the caregiver app has no staff sidebar (salvaged from caregiver-app-shell).
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate("/auth");
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
      <header className="bg-gradient-to-r from-primary/10 via-primary/5 to-background border-b border-border/40">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/caregiver-dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Settings</h1>
              <p className="text-muted-foreground mt-1">
                Manage your profile and availability
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <CaregiverProfileSettings 
          caregiverProfile={caregiverProfile}
          onRefresh={fetchCaregiverProfile}
        />

        <Card className="mt-6">
          <CardContent className="space-y-2 p-4">
            <Button variant="outline" className="min-h-11 w-full justify-between hover:bg-muted hover:text-foreground" onClick={() => navigate("/caregiver-time-off")}>
              <span className="flex items-center gap-3"><CalendarOff className="h-4 w-4" />Time off</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="min-h-11 w-full justify-start gap-3 text-destructive hover:bg-muted hover:text-destructive" onClick={handleSignOut} data-testid="caregiver-sign-out">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
    </CaregiverAppShell>
  );
};

export default CaregiverSettings;