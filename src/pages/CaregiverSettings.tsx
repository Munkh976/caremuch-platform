import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, LogOut } from "lucide-react";
import { CaregiverProfileSettings } from "@/components/caregivers/CaregiverProfileSettings";
import { AppLayout } from "@/components/AppLayout";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { useIsCaregiverRole } from "@/hooks/useIsCaregiverRole";
import { toast } from "sonner";

const CaregiverSettings = () => {
  const navigate = useNavigate();
  const isCaregiver = useIsCaregiverRole();
  const Shell = isCaregiver === false ? AppLayout : CaregiverAppShell;
  const [caregiverProfile, setCaregiverProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCaregiverProfile();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

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

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-screen">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
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

        {/* No sign-out affordance existed anywhere in the caregiver shell once this page
            (and every other caregiver route) moved off AppLayout's sidebar, which is where
            Sign Out used to live -- a caregiver had no way to log out. This is the
            unpolished placement; the mockup's "last row in Profile" treatment is Phase D. */}
        <Card className="mt-6">
          <CardContent className="p-4">
            <Button variant="outline" className="w-full justify-start gap-3 text-destructive" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
};

export default CaregiverSettings;