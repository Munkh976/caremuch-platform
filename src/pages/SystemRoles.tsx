import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

type AppRole = "system_admin" | "agency_admin" | "manager" | "scheduler" | "hr_staff" | "caregiver" | "client";

interface SystemRole {
  id: string;
  role_name: string;
  role_code: AppRole;
  description: string | null;
  access_level: number;
  is_active: boolean;
  created_at: string;
}

const SystemRoles = () => {
  const [systemRoles, setSystemRoles] = useState<SystemRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<SystemRole | null>(null);
  const [formData, setFormData] = useState({
    role_name: "",
    role_code: "" as AppRole | "",
    description: "",
    access_level: 0,
    is_active: true,
  });
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

      const { data: roleData } = await supabase.rpc("get_user_role", {
        _user_id: user.id,
      });

      if (!roleData || roleData !== "system_admin") {
        toast({
          title: "Access Denied",
          description: "Only system administrators can manage system roles",
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      await fetchSystemRoles();
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

  const fetchSystemRoles = async () => {
    try {
      const { data, error } = await supabase
        .from("system_roles")
        .select("*")
        .order("access_level", { ascending: false });

      if (error) throw error;
      setSystemRoles(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleAddRole = () => {
    setFormData({
      role_name: "",
      role_code: "",
      description: "",
      access_level: 0,
      is_active: true,
    });
    setAddDialogOpen(true);
  };

  const handleEditRole = (role: SystemRole) => {
    setSelectedRole(role);
    setFormData({
      role_name: role.role_name,
      role_code: role.role_code,
      description: role.description || "",
      access_level: role.access_level,
      is_active: role.is_active,
    });
    setEditDialogOpen(true);
  };

  const handleSaveRole = async () => {
    // Validation
    if (!formData.role_name.trim()) {
      toast({
        title: "Validation Error",
        description: "Role name is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.role_code.trim()) {
      toast({
        title: "Validation Error",
        description: "Role code is required",
        variant: "destructive",
      });
      return;
    }

    if (formData.access_level < 0 || formData.access_level > 100) {
      toast({
        title: "Validation Error",
        description: "Access level must be between 0 and 100",
        variant: "destructive",
      });
      return;
    }

    try {
      if (selectedRole) {
        const { error } = await supabase
          .from("system_roles")
          .update({
            role_name: formData.role_name,
            description: formData.description || null,
            access_level: formData.access_level,
            is_active: formData.is_active,
          })
          .eq("id", selectedRole.id);

        if (error) throw error;

        toast({
          title: "Success",
          description: "System role updated successfully",
        });
        setEditDialogOpen(false);
      } else {
        const { error } = await supabase
          .from("system_roles")
          .insert([{
            role_name: formData.role_name,
            role_code: formData.role_code as AppRole,
            description: formData.description || null,
            access_level: formData.access_level,
            is_active: formData.is_active,
          }]);

        if (error) throw error;

        toast({
          title: "Success",
          description: "System role created successfully",
        });
        setAddDialogOpen(false);
      }

      await fetchSystemRoles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteClick = (role: SystemRole) => {
    setSelectedRole(role);
    setDeleteDialogOpen(true);
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;

    try {
      const { error } = await supabase
        .from("system_roles")
        .delete()
        .eq("id", selectedRole.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "System role deleted successfully",
      });

      setDeleteDialogOpen(false);
      await fetchSystemRoles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const filteredRoles = systemRoles.filter((role) => 
    role.role_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    role.role_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    role.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getAccessLevelBadge = (level: number) => {
    if (level >= 80) return "destructive";
    if (level >= 60) return "default";
    if (level >= 40) return "secondary";
    return "outline";
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>System Role Management</CardTitle>
                <CardDescription>
                  Define and manage system roles with access levels
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate("/role-permissions")}>
                  Manage Permissions
                </Button>
                <Button onClick={handleAddRole}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add System Role
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
              <Input
                placeholder="Search by name, code, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role Name</TableHead>
                    <TableHead>Role Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Access Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No system roles found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRoles.map((role) => (
                      <TableRow key={role.id}>
                        <TableCell className="font-medium">{role.role_name}</TableCell>
                        <TableCell>
                          <Badge variant={getAccessLevelBadge(role.access_level)}>
                            {role.role_code.replace("_", " ").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-md truncate">
                          {role.description || "N/A"}
                        </TableCell>
                        <TableCell>{role.access_level}</TableCell>
                        <TableCell>
                          <Badge variant={role.is_active ? "default" : "outline"}>
                            {role.is_active ? "Active" : "Inactive"}
                          </Badge>
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

        {/* Add/Edit Role Dialog */}
        <Dialog open={addDialogOpen || editDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setAddDialogOpen(false);
            setEditDialogOpen(false);
            setSelectedRole(null);
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedRole ? "Edit" : "Add"} System Role</DialogTitle>
              <DialogDescription>
                {selectedRole ? "Update the system role details" : "Create a new system role"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Role Name</Label>
                <Input
                  value={formData.role_name}
                  onChange={(e) => setFormData({ ...formData, role_name: e.target.value })}
                  placeholder="e.g., System Administrator"
                />
              </div>
              <div className="space-y-2">
                <Label>Role Code</Label>
                <Input
                  value={formData.role_code}
                  onChange={(e) => setFormData({ ...formData, role_code: e.target.value as AppRole })}
                  placeholder="e.g., system_admin"
                  disabled={!!selectedRole}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the role's purpose and permissions"
                />
              </div>
              <div className="space-y-2">
                <Label>Access Level (0-100)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={formData.access_level}
                  onChange={(e) => setFormData({ ...formData, access_level: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setAddDialogOpen(false);
                setEditDialogOpen(false);
                setSelectedRole(null);
              }}>
                Cancel
              </Button>
              <Button onClick={handleSaveRole}>
                {selectedRole ? "Save Changes" : "Create Role"}
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
                This will permanently delete the "{selectedRole?.role_name}" system role. 
                Users with this role may lose access. This action cannot be undone.
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

export default SystemRoles;
