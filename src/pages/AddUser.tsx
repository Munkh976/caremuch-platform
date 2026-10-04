import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OneTimeLinkDialog } from "@/components/auth/OneTimeLinkDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, UserPlus } from "lucide-react";
import { toast } from "sonner";

const AddUser = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("scheduler");
  // Mode B (security plan §15): no typed password; the new user sets their own via a one-time link.
  const [linkInfo, setLinkInfo] = useState<{ email: string; link: string } | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }

    const { data: roleData } = await supabase.rpc('get_user_role', { _user_id: user.id });
    if (!roleData || (roleData !== 'agency_admin' && roleData !== 'system_admin')) {
      toast.error("You don't have permission to access this page");
      navigate("/dashboard");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      toast.error("Valid email is required");
      return;
    }
    setLoading(true);
    try {
      // create-user resolves agency_id server-side (never client-supplied), checks the
      // requested role against what this caller may grant (M-SEC-2b), and creates the
      // account through a one-time invite link (Mode B) that is returned once and shown
      // in OneTimeLinkDialog. No password is typed or stored.
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email,
          firstName,
          lastName,
          userType: 'staff',
          userData: { staffRole: role },
        },
      });

      if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to create user");

      toast.success("User created");
      if (data?.setPasswordLink) setLinkInfo({ email, link: data.setPasswordLink });
      else navigate("/users");
    } catch (error: any) {
      toast.error(error.message || "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

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
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-primary/10 p-3">
                <UserPlus className="h-8 w-8 text-primary" />
              </div>
            </div>
            <CardTitle>Add New User</CardTitle>
            <CardDescription>Create a new user account</CardDescription>
            <div className="inline-flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1 rounded-md text-sm mx-auto mt-2">
              <span className="font-medium">⚠ Admin Only</span>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    type="text"
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <p className="text-xs text-muted-foreground">
                No password is set here. After creating the user you get a one-time link to give them, so they choose their own password.
              </p>

              <div className="space-y-2">
                <Label htmlFor="role">Account Type</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system_admin">System Admin - Full system access</SelectItem>
                    <SelectItem value="agency_admin">Agency Admin - Manage agency</SelectItem>
                    <SelectItem value="manager">Manager - Manage operations</SelectItem>
                    <SelectItem value="scheduler">Scheduler - Schedule management</SelectItem>
                    <SelectItem value="hr_staff">HR Staff - HR operations</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  As a system admin, you can create both user and admin accounts
                </p>
              </div>


              <Button type="submit" className="w-full" disabled={loading}>
                <UserPlus className="mr-2 h-4 w-4" />
                {loading ? "Creating user..." : "Add User"}
              </Button>
            </form>
            <OneTimeLinkDialog
              open={!!linkInfo}
              onClose={() => { setLinkInfo(null); navigate("/users"); }}
              title="User created"
              email={linkInfo?.email ?? null}
              link={linkInfo?.link ?? null}
            />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AddUser;
