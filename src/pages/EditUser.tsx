import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

const EditUser = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [currentRole, setCurrentRole] = useState<string>("");
  const [targetAgencyId, setTargetAgencyId] = useState<string | null>(null);

  useEffect(() => {
    checkAuthAndLoadUser();
  }, [id]);

  const checkAuthAndLoadUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: roleData } = await supabase.rpc('get_user_role', { _user_id: user.id });
      setCurrentUserRole(roleData);

      if (!roleData || (roleData !== 'agency_admin' && roleData !== 'system_admin')) {
        toast.error("You don't have permission to access this page");
        navigate("/dashboard");
        return;
      }

      await loadUser();
    } catch (error: any) {
      toast.error("Failed to load user");
      console.error(error);
      navigate("/users");
    } finally {
      setLoading(false);
    }
  };

  const loadUser = async () => {
    if (!id) return;

    try {
      // Fetch user profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .single();

      if (profileError) throw profileError;

      setUserEmail(profile.email);
      setUserName(profile.full_name || profile.email);
      setTargetAgencyId(profile.agency_id);

      // Fetch user role
      const { data: roleData } = await supabase.rpc('get_user_role', { _user_id: id });
      if (roleData) {
        setCurrentRole(roleData);
        setSelectedRole(roleData);
      }
    } catch (error: any) {
      toast.error("Failed to load user details");
      console.error(error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedRole) {
      toast.error("Please select a role");
      return;
    }

    setSaving(true);
    try {
      // Upsert the new role first (agency-scoped to the target user's own agency,
      // matching how every other user_roles write in this app scopes it), then
      // remove any other role rows for this user. Ordering matters: doing the
      // upsert before the delete means a mid-operation failure never leaves the
      // user with zero roles.
      const { error: upsertError } = await supabase
        .from("user_roles")
        .upsert(
          { user_id: id, role: selectedRole as any, agency_id: targetAgencyId },
          { onConflict: "user_id,role" }
        );

      if (upsertError) throw upsertError;

      const { error: deleteError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", id)
        .neq("role", selectedRole);

      if (deleteError) throw deleteError;

      toast.success("User role updated successfully!");
      navigate("/users");
    } catch (error: any) {
      toast.error(error.message || "Failed to update user role");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate("/users")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Button>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>Edit User Role</CardTitle>
            <CardDescription>Update role for {userName}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <div className="text-sm text-muted-foreground">{userEmail}</div>
              </div>

              <div className="space-y-2">
                <Label>Current Role</Label>
                <div className="text-sm font-medium">
                  {currentRole?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">New Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentUserRole === 'system_admin' && (
                      <SelectItem value="system_admin">System Admin - Full system access</SelectItem>
                    )}
                    <SelectItem value="agency_admin">Agency Admin - Manage agency</SelectItem>
                    <SelectItem value="manager">Manager - Manage operations</SelectItem>
                    <SelectItem value="scheduler">Scheduler - Schedule management</SelectItem>
                    <SelectItem value="hr_staff">HR Staff - HR operations</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full" disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Updating..." : "Update Role"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default EditUser;
