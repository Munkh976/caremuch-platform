import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, UserPlus, KeyRound, UserX } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { ADMIN, type AppRole } from "@/lib/roleHome";

const AdminUserManagement = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  // Delete-user is agency_admin / system_admin only (admin-delete-user refuses managers, security
  // plan §10.4), so the tab is not shown to managers at all.
  const { userRole } = usePermissions();
  const canDeleteUsers = !!userRole && ADMIN.includes(userRole as AppRole);

  // Create User State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>("");

  // Reset Password State
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Delete User State
  const [deleteEmail, setDeleteEmail] = useState("");

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in");
        return;
      }

      // For system_admin, agency_admin, manager roles - use user_roles table approach
      if (['system_admin', 'agency_admin', 'manager', 'scheduler', 'hr_staff'].includes(role)) {
        // Create auth user with admin API via edge function
        const { data, error } = await supabase.functions.invoke('create-user', {
          body: {
            email,
            password,
            firstName,
            lastName,
            phone,
            userType: 'staff', // Generic staff type
            userData: {
              staffRole: role // Pass the actual staff role
            }
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        toast.success(`User created successfully with ${role} role`);
      } else {
        // For caregiver/client, use the existing flow
        const { data, error } = await supabase.functions.invoke('create-user', {
          body: {
            email,
            password,
            firstName,
            lastName,
            phone,
            userType: role,
            userData: {}
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        toast.success(`${role} created successfully`);
      }

      // Reset form
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      setPhone("");
      setRole("");
    } catch (error: any) {
      console.error('Create user error:', error);
      toast.error(error.message || "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in");
        return;
      }

      // Find user by email
      const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', resetEmail)
        .single();

      if (userError || !users) {
        toast.error("User not found");
        return;
      }

      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: {
          userId: users.id,
          newPassword
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Password reset successfully");
      setResetEmail("");
      setNewPassword("");
    } catch (error: any) {
      console.error('Reset password error:', error);
      toast.error(error.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!confirm(`Are you sure you want to delete user ${deleteEmail}? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in");
        return;
      }

      // Find user by email
      const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', deleteEmail)
        .single();

      if (userError || !users) {
        toast.error("User not found");
        return;
      }

      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: {
          userId: users.id
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("User deleted successfully");
      setDeleteEmail("");
    } catch (error: any) {
      console.error('Delete user error:', error);
      toast.error(error.message || "Failed to delete user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-3xl font-bold">Admin User Management</h1>
          <p className="text-muted-foreground mt-2">
            Create, reset passwords, and manage users using secure backend functions
          </p>
        </div>

        <Tabs defaultValue="create" className="w-full">
          <TabsList className={`grid w-full ${canDeleteUsers ? "grid-cols-3" : "grid-cols-2"}`}>
            <TabsTrigger value="create">
              <UserPlus className="h-4 w-4 mr-2" />
              Create User
            </TabsTrigger>
            <TabsTrigger value="reset">
              <KeyRound className="h-4 w-4 mr-2" />
              Reset Password
            </TabsTrigger>
            {canDeleteUsers && (
            <TabsTrigger value="delete">
              <UserX className="h-4 w-4 mr-2" />
              Delete User
            </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="create">
            <Card>
              <CardHeader>
                <CardTitle>Create New User</CardTitle>
                <CardDescription>
                  Creates a new user with proper authentication and role assignment
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
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
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Min 8 characters"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone (Optional)</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={role} onValueChange={setRole} required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system_admin">System Admin</SelectItem>
                        <SelectItem value="agency_admin">Agency Admin</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="scheduler">Scheduler</SelectItem>
                        <SelectItem value="hr_staff">HR Staff</SelectItem>
                        <SelectItem value="caregiver">Caregiver</SelectItem>
                        <SelectItem value="client">Client</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating..." : "Create User"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reset">
            <Card>
              <CardHeader>
                <CardTitle>Reset User Password</CardTitle>
                <CardDescription>
                  Reset a user's password using their email address
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="resetEmail">User Email</Label>
                    <Input
                      id="resetEmail"
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      placeholder="user@example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      placeholder="Min 8 characters"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Resetting..." : "Reset Password"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {canDeleteUsers && (
          <TabsContent value="delete">
            <Card>
              <CardHeader>
                <CardTitle>Delete User</CardTitle>
                <CardDescription>
                  Permanently delete a user and all associated data
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleDeleteUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="deleteEmail">User Email</Label>
                    <Input
                      id="deleteEmail"
                      type="email"
                      value={deleteEmail}
                      onChange={(e) => setDeleteEmail(e.target.value)}
                      required
                      placeholder="user@example.com"
                    />
                  </div>

                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4">
                    <p className="text-sm text-destructive">
                      ⚠️ Warning: This action cannot be undone. All user data, including
                      profiles, roles, and associated records will be permanently deleted.
                    </p>
                  </div>

                  <Button 
                    type="submit" 
                    variant="destructive" 
                    className="w-full" 
                    disabled={loading}
                  >
                    {loading ? "Deleting..." : "Delete User"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default AdminUserManagement;
