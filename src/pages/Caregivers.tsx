import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Mail, Phone, MapPin, Award, Activity, Search, Upload, Eye, Trash2, Edit, Clock, Lock, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import ReactSelect from "react-select";
import { AvailabilityDialog } from "@/components/caregivers/AvailabilityDialog";
import { US_STATES } from "@/constants/usStates";
import { Separator } from "@/components/ui/separator";
import { AppLayout } from "@/components/AppLayout";
import { caregiverFormSchema, passwordResetSchema } from "@/lib/validation";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useCareServices } from "@/hooks/useCareServices";


const Caregivers = () => {
  const navigate = useNavigate();
  const { pendingCount } = usePendingApprovals();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteCaregiver, setDeleteCaregiver] = useState<any>(null);
  const [editCaregiver, setEditCaregiver] = useState<any>(null);
  const [viewCaregiver, setViewCaregiver] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { services: careTypes, groupedOptions, optionFor } = useCareServices();
  const [availabilityCaregiver, setAvailabilityCaregiver] = useState<any>(null);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    hourly_rate: "",
    employment_type: "full_time",
    city: "",
    state: "",
    address: "",
    zip_code: "",
    care_type_codes: [] as string[],
  });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetPasswordCaregiver, setResetPasswordCaregiver] = useState<any>(null);
  const [enablingLoginId, setEnablingLoginId] = useState<string | null>(null);
  const [newCredentials, setNewCredentials] = useState<{ email: string; password: string | null } | null>(null);

  const canManageCaregivers = userRole === 'system_admin' || userRole === 'agency_admin' || userRole === 'manager';

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      setUser(session.user);

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();

      const { data: roleData } = await supabase.rpc('get_user_role', {
        _user_id: session.user.id
      });
      setUserRole(roleData);

      if (profileData) {
        setProfile(profileData);
        fetchCaregivers(session.user.id);
        // Care services come from the shared useCareServices hook.
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchCaregivers = async (userId: string) => {
    try {
      // Fetch user's profile to get the correct agency_id
      const { data: userProfile, error: profileError } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", userId)
        .single();

      if (profileError || !userProfile) {
        console.error("Profile error:", profileError);
        toast.error("Profile not found");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("caregivers")
        .select(`
          *,
          caregiver_skills(
            id,
            care_type_code,
            proficiency_level,
            years_experience,
            is_certified,
            care_types(code, name, category)
          )
        `)
        .eq("agency_id", userProfile.agency_id);

      if (error) {
        console.error("Error loading caregivers:", error);
        toast.error("Failed to load caregivers");
      } else {
        setCaregivers(data || []);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddDialog = () => {
    setIsEditMode(false);
    setEditCaregiver(null);
    setFormData({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      hourly_rate: "",
      employment_type: "full_time",
      city: "",
      state: "",
      address: "",
      zip_code: "",
      care_type_codes: [],
    });
    setShowResetPassword(false);
    setNewPassword("");
    setConfirmPassword("");
    setIsAddDialogOpen(true);
  };

  const handleOpenEditDialog = (caregiver: any) => {
    setIsEditMode(true);
    setEditCaregiver(caregiver);
    setFormData({
      first_name: caregiver.first_name || "",
      last_name: caregiver.last_name || "",
      email: caregiver.email || "",
      phone: caregiver.phone || "",
      hourly_rate: caregiver.hourly_rate?.toString() || "",
      employment_type: caregiver.employment_type || "full_time",
      city: caregiver.city || "",
      state: caregiver.state || "",
      address: caregiver.address || "",
      zip_code: caregiver.zip_code || "",
      care_type_codes: caregiver.caregiver_skills?.map((s: any) => s.care_type_code) || [],
    });
    setShowResetPassword(false);
    setNewPassword("");
    setConfirmPassword("");
    setIsAddDialogOpen(true);
  };

  const handleSaveCaregiver = async () => {
    // Validate form data
    const validation = caregiverFormSchema.safeParse(formData);
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }
    
    if (!user) {
      toast.error("User session not found");
      return;
    }

    const caregiverData = {
      hourly_rate: formData.hourly_rate ? parseFloat(formData.hourly_rate) : null,
      employment_type: formData.employment_type,
      city: formData.city,
      state: formData.state,
      address: formData.address,
      zip_code: formData.zip_code,
    };

    if (isEditMode && editCaregiver) {
      // Update profile if user_id exists
      if (editCaregiver.user_id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            full_name: `${formData.first_name} ${formData.last_name}`,
            email: formData.email,
            phone: formData.phone,
          })
          .eq("id", editCaregiver.user_id);

        if (profileError) {
          toast.error("Failed to update profile");
          return;
        }
      }

      // Update caregiver-specific data (including first_name, last_name, email, phone, address, zip_code)
      const { error } = await supabase
        .from("caregivers")
        .update({
          ...caregiverData,
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: formData.phone,
        })
        .eq("id", editCaregiver.id);

      if (error) {
        toast.error("Failed to update caregiver");
        return;
      }

      // Update caregiver skills
      await supabase
        .from("caregiver_skills")
        .delete()
        .eq("caregiver_id", editCaregiver.id);

      if (formData.care_type_codes.length > 0) {
        const skillsData = formData.care_type_codes.map((code) => ({
          caregiver_id: editCaregiver.id,
          care_type_code: code,
        }));
        await supabase.from("caregiver_skills").insert(skillsData);
      }

      // Handle password reset if requested
      if (showResetPassword && newPassword && editCaregiver.user_id) {
        await handleResetPassword();
      }

      toast.success("Caregiver updated successfully");
      setIsAddDialogOpen(false);
      if (user) fetchCaregivers(user.id);
    } else {
      // Check if email already exists
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', formData.email)
        .maybeSingle();

      if (existingUser) {
        toast.error("A user with this email already exists");
        return;
      }

      // Create user via edge function
      const tempPassword = Math.random().toString(36).slice(-12) + "Aa1!";
      
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: formData.email,
          password: tempPassword,
          firstName: formData.first_name,
          lastName: formData.last_name,
          phone: formData.phone,
          userType: 'caregiver',
          userData: caregiverData,
        }
      });

      if (error || !data?.success) {
        const errorMsg = data?.error || error?.message || "Failed to create caregiver";
        toast.error(errorMsg);
        return;
      }

      // Add caregiver skills
      if (formData.care_type_codes.length > 0 && data.recordId) {
        const skillsData = formData.care_type_codes.map((code) => ({
          caregiver_id: data.recordId,
          care_type_code: code,
        }));
        await supabase.from("caregiver_skills").insert(skillsData);
      }

      toast.success("Caregiver added successfully");
      setIsAddDialogOpen(false);
      if (user) fetchCaregivers(user.id);
    }
  };

  const handleResetPassword = async () => {
    const targetCaregiver = resetPasswordCaregiver || editCaregiver;
    
    if (!targetCaregiver?.user_id) {
      toast.error("Cannot reset password: No user account found");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    // Validate password
    const validation = passwordResetSchema.safeParse({ newPassword });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    try {
      const { error } = await supabase.functions.invoke('admin-reset-password', {
        body: {
          userId: targetCaregiver.user_id,
          newPassword: newPassword,
        }
      });

      if (error) throw error;
      
      toast.success("Password reset successfully");
      setShowResetPassword(false);
      setNewPassword("");
      setConfirmPassword("");
      setResetPasswordCaregiver(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to reset password");
    }
  };

  const handleEnableLogin = async (caregiver: any) => {
    setEnablingLoginId(caregiver.id);
    try {
      const { data, error } = await supabase.functions.invoke("enable-caregiver-login", {
        body: { caregiverId: caregiver.id },
      });
      if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      setNewCredentials({
        email: (data as any)?.email ?? caregiver.email,
        password: (data as any)?.tempPassword ?? null,
      });
      toast.success("Login enabled for this caregiver");
      if (user) fetchCaregivers(user.id);
    } catch (error: any) {
      toast.error(error.message || "Failed to enable login");
    } finally {
      setEnablingLoginId(null);
    }
  };

  const handleDeleteCaregiver = async () => {
    if (!deleteCaregiver) return;

    const { error } = await supabase
      .from("caregivers")
      .delete()
      .eq("id", deleteCaregiver.id);

    if (error) {
      toast.error("Failed to delete caregiver");
    } else {
      toast.success("Caregiver deleted successfully");
      setDeleteCaregiver(null);
      if (user) fetchCaregivers(user.id);
    }
  };

  const handleBulkImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      const lines = text.split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      
      let successCount = 0;
      let errorCount = 0;

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const values = lines[i].split(',').map(v => v.trim());
        const caregiver: any = {};
        
        headers.forEach((header, index) => {
          const value = values[index];
          if (header === 'hourly_rate') {
            caregiver[header] = parseFloat(value) || 0;
          } else if (header === 'is_active') {
            caregiver[header] = value.toLowerCase() === 'true';
          } else {
            caregiver[header] = value;
          }
        });

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) continue;

        const { error } = await supabase
          .from('caregivers')
          .insert({
            ...caregiver,
            agency_id: user.id
          });

        if (error) {
          errorCount++;
        } else {
          successCount++;
        }
      }

      toast.success(`Imported ${successCount} caregivers${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
      if (user) fetchCaregivers(user.id);
    };
    input.click();
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "full_time": return "bg-primary/10 text-primary border-primary/20";
      case "part_time": return "bg-accent/10 text-accent border-accent/20";
      case "on_call": return "bg-secondary/10 text-secondary border-secondary/20";
      default: return "bg-muted";
    }
  };

  // Filter caregivers
  const filteredCaregivers = caregivers.filter(caregiver => {
    const fullName = `${caregiver.first_name} ${caregiver.last_name}`.toLowerCase();
    const matchesSearch = searchQuery === "" ||
      fullName.includes(searchQuery.toLowerCase()) ||
      caregiver.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      caregiver.skills?.some((skill: string) => skill.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = filterRole === "all" || caregiver.employment_type === filterRole;
    const matchesStatus = filterStatus === "all" || 
      (filterStatus === "active" && caregiver.is_active) ||
      (filterStatus === "inactive" && !caregiver.is_active);

    return matchesSearch && matchesRole && matchesStatus;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-muted-foreground">Loading caregivers...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h2 className="text-3xl font-bold mb-2">Caregiver Management</h2>
            <p className="text-muted-foreground">Manage your caregiver roster</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate("/caregiver-approvals")}>
              <Clock className="h-4 w-4" />
              Applications
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-1">{pendingCount}</Badge>
              )}
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleBulkImport}>
              <Upload className="h-4 w-4" />
              Upload/Import Table
            </Button>
            <Button className="gap-2" onClick={handleOpenAddDialog}>
              <Plus className="h-4 w-4" />
              Add Caregiver
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{isEditMode ? "Edit Caregiver" : "Add New Caregiver"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first_name">First Name *</Label>
                      <Input
                        id="first_name"
                        value={formData.first_name}
                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last_name">Last Name *</Label>
                      <Input
                        id="last_name"
                        value={formData.last_name}
                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Street Address</Label>
                    <Input
                      id="address"
                      value={formData.address || ''}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder="123 Main St"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Select
                        value={formData.state}
                        onValueChange={(value) => setFormData({ ...formData, state: value })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zip_code">Zip Code</Label>
                      <Input
                        id="zip_code"
                        value={formData.zip_code || ''}
                        onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })}
                        placeholder="12345"
                        maxLength={5}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="hourly_rate">Hourly Rate</Label>
                      <Input
                        id="hourly_rate"
                        type="number"
                        step="0.01"
                        value={formData.hourly_rate}
                        onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="employment_type">Employment Type</Label>
                      <Select
                        value={formData.employment_type}
                        onValueChange={(value) => setFormData({ ...formData, employment_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_time">Full Time</SelectItem>
                          <SelectItem value="part_time">Part Time</SelectItem>
                          <SelectItem value="on_call">On Call</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Care Services</Label>
                    <ReactSelect
                      isMulti
                      options={groupedOptions}
                      value={formData.care_type_codes.map(optionFor)}
                      onChange={(selected) => setFormData({ ...formData, care_type_codes: selected.map(s => s.value) })}
                      className="react-select-container"
                      classNamePrefix="react-select"
                      styles={{
                        control: (base) => ({
                          ...base,
                          backgroundColor: 'hsl(var(--background))',
                          borderColor: 'hsl(var(--input))',
                          minHeight: '40px',
                        }),
                        menu: (base) => ({
                          ...base,
                          backgroundColor: 'hsl(var(--popover))',
                          zIndex: 9999,
                        }),
                        option: (base, state) => ({
                          ...base,
                          backgroundColor: state.isFocused ? 'hsl(var(--accent))' : 'transparent',
                          color: 'hsl(var(--popover-foreground))',
                        }),
                        multiValue: (base) => ({
                          ...base,
                          backgroundColor: 'hsl(var(--secondary))',
                        }),
                        multiValueLabel: (base) => ({
                          ...base,
                          color: 'hsl(var(--secondary-foreground))',
                        }),
                      }}
                    />
                  </div>

                  {/* Password Reset Section - Only for Edit Mode */}
                  {isEditMode && editCaregiver?.user_id && (
                    <>
                      <Separator className="my-4" />
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Lock className="h-5 w-5 text-primary" />
                            <Label className="text-base font-semibold">Password Reset</Label>
                          </div>
                          {!showResetPassword && (
                            <Button 
                              type="button"
                              variant="outline" 
                              size="sm"
                              onClick={() => setShowResetPassword(true)}
                            >
                              Reset Password
                            </Button>
                          )}
                        </div>

                        {showResetPassword && (
                          <div className="space-y-3 bg-muted/30 p-4 rounded-lg border">
                            <div className="space-y-2">
                              <Label htmlFor="newPassword">New Password</Label>
                              <Input
                                id="newPassword"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Enter new password"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="confirmPassword">Confirm Password</Label>
                              <Input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm new password"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button 
                                type="button"
                                variant="outline" 
                                size="sm"
                                onClick={() => {
                                  setShowResetPassword(false);
                                  setNewPassword("");
                                  setConfirmPassword("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Password will be reset when you click "Update Caregiver"
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveCaregiver}>
                    {isEditMode ? "Update" : "Add"} Caregiver
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Employment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="full_time">Full Time</SelectItem>
              <SelectItem value="part_time">Part Time</SelectItem>
              <SelectItem value="on_call">On Call</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Caregivers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{filteredCaregivers.length}</div>
              <div className="text-xs text-muted-foreground">of {caregivers.length} total</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">
                {caregivers.filter(c => c.is_active).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-accent">
                ${(caregivers.reduce((sum, c) => sum + (c.hourly_rate || 0), 0) / caregivers.length || 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Caregivers Table */}
        <Card>
          <CardContent className="p-6">
            {filteredCaregivers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Activity className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  {caregivers.length === 0 ? "No caregivers in your roster yet" : "No caregivers match your filters"}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Employment</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Account</TableHead>
                      <TableHead>Care Services</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCaregivers.map((caregiver) => (
                    <TableRow key={caregiver.id}>
                      <TableCell className="font-medium">
                        {caregiver.first_name} {caregiver.last_name}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-sm">
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            {caregiver.email}
                          </span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {caregiver.phone}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getRoleColor(caregiver.employment_type)}>
                          {caregiver.employment_type?.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-primary">${caregiver.hourly_rate}</span>
                        <span className="text-xs text-muted-foreground">/hr</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={caregiver.is_active ? "default" : "secondary"}>
                          {caregiver.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={caregiver.user_id ? "default" : "outline"}>
                          {caregiver.user_id ? "Linked" : "No login"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {caregiver.caregiver_skills && caregiver.caregiver_skills.length > 0 ? (
                            caregiver.caregiver_skills.slice(0, 2).map((skill: any, idx: number) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {skill.care_types?.name || skill.care_type_code}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                          {caregiver.caregiver_skills && caregiver.caregiver_skills.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{caregiver.caregiver_skills.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setViewCaregiver(caregiver)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenEditDialog(caregiver)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                          {!caregiver.user_id && canManageCaregivers && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={enablingLoginId === caregiver.id}
                                  onClick={() => handleEnableLogin(caregiver)}
                                >
                                  <UserPlus className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Enable login</TooltipContent>
                            </Tooltip>
                          )}
                          {caregiver.user_id && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setResetPasswordCaregiver(caregiver);
                                    setNewPassword("");
                                    setConfirmPassword("");
                                  }}
                                >
                                  <Lock className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reset password</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAvailabilityCaregiver(caregiver)}
                              >
                                <Clock className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Manage availability</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDeleteCaregiver(caregiver)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      {/* View Details Dialog */}
      <Dialog open={!!viewCaregiver} onOpenChange={() => setViewCaregiver(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Caregiver Details</DialogTitle>
          </DialogHeader>
          {viewCaregiver && (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-bold mb-1">
                    {viewCaregiver.first_name} {viewCaregiver.last_name}
                  </h3>
                  <Badge variant="outline" className={getRoleColor(viewCaregiver.employment_type)}>
                    {viewCaregiver.employment_type?.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-primary">${viewCaregiver.hourly_rate}</div>
                  <div className="text-xs text-muted-foreground">per hour</div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{viewCaregiver.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{viewCaregiver.phone}</span>
                </div>
                {viewCaregiver.city && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{viewCaregiver.city}, {viewCaregiver.state}</span>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Award className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">Care Services & Skills</span>
                </div>
                {viewCaregiver.caregiver_skills && viewCaregiver.caregiver_skills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {viewCaregiver.caregiver_skills.map((skill: any) => (
                      <Badge key={skill.id} variant="secondary">
                        {skill.care_types?.name || skill.care_type_code}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No care services assigned</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteCaregiver} onOpenChange={() => setDeleteCaregiver(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Caregiver</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteCaregiver?.first_name} {deleteCaregiver?.last_name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCaregiver} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPasswordCaregiver} onOpenChange={() => {
        setResetPasswordCaregiver(null);
        setNewPassword("");
        setConfirmPassword("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Reset password for {resetPasswordCaregiver?.first_name} {resetPasswordCaregiver?.last_name}
            </p>
            <div className="space-y-2">
              <Label htmlFor="reset-new-password">New Password</Label>
              <Input
                id="reset-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 6 characters)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm-password">Confirm Password</Label>
              <Input
                id="reset-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setResetPasswordCaregiver(null);
              setNewPassword("");
              setConfirmPassword("");
            }}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword}>
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newCredentials} onOpenChange={(open) => !open && setNewCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Caregiver login created</DialogTitle>
            <DialogDescription>
              No email is sent yet — this notice is stored in the notification outbox. Share these
              details with the caregiver directly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium">Email: </span>
              <span className="text-muted-foreground">{newCredentials?.email}</span>
            </div>
            <div>
              <span className="font-medium">Temporary password: </span>
              <span className="text-muted-foreground">
                {newCredentials?.password ?? "existing account — password unchanged"}
              </span>
            </div>
          </div>
          <DialogFooter>
            {newCredentials?.password && (
              <Button
                variant="outline"
                onClick={() => navigator.clipboard.writeText(newCredentials.password!)}
              >
                Copy password
              </Button>
            )}
            <Button onClick={() => setNewCredentials(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Availability Dialog */}
      {availabilityCaregiver && (
        <AvailabilityDialog
          caregiver={availabilityCaregiver}
          isOpen={!!availabilityCaregiver}
          onClose={() => setAvailabilityCaregiver(null)}
        />
      )}
      </div>
    </AppLayout>
  );
};

export default Caregivers;
