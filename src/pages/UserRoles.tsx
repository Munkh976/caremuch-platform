import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type AppRole = "system_admin" | "agency_admin" | "manager" | "scheduler" | "hr_staff" | "caregiver" | "client";

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  agency_id: string | null;
  created_at: string;
  email?: string;
  full_name?: string | null;
}

const UserRoles = () => {
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [newRole, setNewRole] = useState<AppRole | "">("");
  const [currentUserRole, setCurrentUserRole] = useState<AppRole | "">("");
  const [availableRoles, setAvailableRoles] = useState<Array<{ role_code: AppRole; role_name: string }>>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    checkAuthAndFetchRoles();
  }, []);

  const checkAuthAndFetchRoles = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate("/auth");
        return;
      }

      // Check user's role
      const { data: roleData } = await supabase.rpc("get_user_role", {
        _user_id: user.id,
      });

      if (!roleData || !["system_admin", "agency_admin"].includes(roleData)) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to manage user roles",
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      setCurrentUserRole(roleData);
      await Promise.all([fetchUserRoles(), fetchAvailableRoles(roleData)]);
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

  const fetchAvailableRoles = async (userRole: AppRole) => {
    try {
      const { data, error } = await supabase
        .from("system_roles")
        .select("role_code, role_name, access_level")
        .eq("is_active", true)
        .order("access_level", { ascending: false });

      if (error) throw error;

      // Filter roles based on current user's role
      const filteredRoles = (data || []).filter((role) => {
        if (userRole === "system_admin") return true;
        return role.role_code !== "system_admin";
      });

      setAvailableRoles(filteredRoles);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const fetchUserRoles = async () => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rolesWithProfiles = await Promise.all(
        (data || []).map(async (role) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", role.user_id)
            .maybeSingle();

          return {
            ...role,
            email: profile?.email,
            full_name: profile?.full_name,
          };
        })
      );

      setUserRoles(rolesWithProfiles);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEditRole = (role: UserRole) => {
    setSelectedRole(role);
    setNewRole(role.role);
    setEditDialogOpen(true);
  };

  const handleUpdateRole = async () => {
    if (!selectedRole || !newRole) {
      toast({
        title: "Validation Error",
        description: "Please select a role",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("user_roles")
        .update({ role: newRole })
        .eq("id", selectedRole.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "User role updated successfully",
      });

      setEditDialogOpen(false);
      await fetchUserRoles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteClick = (role: UserRole) => {
    setSelectedRole(role);
    setDeleteDialogOpen(true);
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;

    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("id", selectedRole.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "User role deleted successfully",
      });

      setDeleteDialogOpen(false);
      await fetchUserRoles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const filteredRoles = userRoles.filter((role) => {
    const matchesSearch = 
      role.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      role.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      role.role.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = roleFilter === "all" || role.role === roleFilter;
    
    return matchesSearch && matchesFilter;
  });

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "system_admin":
        return "destructive";
      case "agency_admin":
        return "default";
      case "manager":
        return "secondary";
      case "caregiver":
        return "outline";
      case "client":
        return "outline";
      default:
        return "secondary";
    }
  };


  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>User Role Management</CardTitle>
              <CardDescription>
                Manage user roles and permissions across the system
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-6">
              <div className="flex-1">
                <Input
                  placeholder="Search by email, name, or role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {availableRoles.map((role) => (
                    <SelectItem key={role.role_code} value={role.role_code}>
                      {role.role_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No user roles found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRoles.map((role) => (
                      <TableRow key={role.id}>
                        <TableCell className="font-medium">
                          {role.full_name || "N/A"}
                        </TableCell>
                        <TableCell>{role.email || "N/A"}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(role.role)}>
                            {role.role.replace("_", " ").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(role.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditRole(role)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteClick(role)}
                                  disabled={role.role === "system_admin"}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Edit Role Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User Role</DialogTitle>
              <DialogDescription>
                Update the role for {selectedRole?.full_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Current Email</Label>
                <Input value={selectedRole?.email || ""} disabled />
              </div>
              <div className="space-y-2">
                <Label>Select New Role</Label>
                <Select value={newRole} onValueChange={(value) => setNewRole(value as AppRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.role_code} value={role.role_code}>
                        {role.role_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateRole}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the role "{selectedRole?.role}" from user{" "}
                {selectedRole?.email}. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteRole}>
                Delete Role
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
};

export default UserRoles;
