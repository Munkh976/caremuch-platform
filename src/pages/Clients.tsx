import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Plus, Phone, MapPin, Heart, AlertCircle, User, Search, Upload, Eye, Trash2, Edit, Key } from "lucide-react";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import ReactSelect from "react-select";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { useCareServices } from "@/hooks/useCareServices";
import { clientFormSchema, passwordResetSchema } from "@/lib/validation";
import { FamilyDialog } from "@/components/families/FamilyDialog";
import { ClientSchedulingDialog } from "@/components/clients/ClientSchedulingDialog";
import { CalendarClock } from "lucide-react";


const Clients = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [familyDialogId, setFamilyDialogId] = useState<string | null>(null);
  const [schedulingClient, setSchedulingClient] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [searchDob, setSearchDob] = useState("");
  // Mirrors Caregiver Applications' combined "City, state or ZIP" text filter
  // (CaregiverApprovals.tsx's locationFilter) rather than the dropdown-of-known-
  // cities this used to be -- covers City, State, and Zip Code in one field, the
  // same way that page does it.
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [filterService, setFilterService] = useState<string>("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteClient, setDeleteClient] = useState<any>(null);
  const [editClient, setEditClient] = useState<any>(null);
  const [viewClient, setViewClient] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { services: careTypes, groupedOptions, optionFor } = useCareServices();
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [enablingLoginId, setEnablingLoginId] = useState<string | null>(null);
  const [newCredentials, setNewCredentials] = useState<{ email: string; password: string | null } | null>(null);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    date_of_birth: "",
    medical_conditions: [] as string[],
    care_type_codes: [] as string[],
    emergency_contact_name: "",
    emergency_contact_phone: "",
    notes: "",
  });

  const medicalConditionsOptions = [
    { value: "Diabetes", label: "Diabetes" },
    { value: "Hypertension", label: "Hypertension" },
    { value: "Alzheimer's", label: "Alzheimer's" },
    { value: "Dementia", label: "Dementia" },
    { value: "Heart Disease", label: "Heart Disease" },
    { value: "Arthritis", label: "Arthritis" },
    { value: "Parkinson's", label: "Parkinson's" },
    { value: "COPD", label: "COPD" },
  ];

  const canManageClients = userRole === 'system_admin' || userRole === 'agency_admin' || userRole === 'manager';

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

      if (profileData) {
        setProfile(profileData);
        fetchClients(profileData.agency_id);
      }

      // Fetch user role
      const { data: roleData } = await supabase.rpc('get_user_role', {
        _user_id: session.user.id
      });

      if (roleData) {
        setUserRole(roleData);
        
        // Check if user has permission to view clients
        const allowedRoles = ['system_admin', 'agency_admin', 'manager', 'scheduler', 'hr_staff'];
        if (!allowedRoles.includes(roleData)) {
          toast.error("You don't have permission to access client management");
          navigate("/");
          return;
        }
      }
    };

    checkAuth();
    // Care services come from the shared useCareServices hook.

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchClients = async (agencyId: string) => {
    try {
      const { data, error } = await supabase
        .from("clients")
        .select(`
          *,
          families(id, family_name),
          client_care_needs(
            care_type_code,
            priority,
            care_types!client_care_needs_care_type_code_fkey(code, name, category)
          )
        `)
        .eq("agency_id", agencyId)
        .order("first_name", { ascending: true });

      if (error) {
        console.error("Error loading clients:", error);
        toast.error("Failed to load clients");
      } else {
        setClients(data || []);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };


  const calculateAge = (dob: string | null) => {
    if (!dob) return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleOpenAddDialog = () => {
    if (!canManageClients) {
      toast.error("You don't have permission to add clients");
      return;
    }
    setIsEditMode(false);
    setEditClient(null);
    setFormData({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zip_code: "",
      date_of_birth: "",
      medical_conditions: [],
      care_type_codes: [],
      emergency_contact_name: "",
      emergency_contact_phone: "",
      notes: "",
    });
    setIsAddDialogOpen(true);
  };

  const handleEnableLogin = async (client: any) => {
    setEnablingLoginId(client.id);
    try {
      const { data, error } = await supabase.functions.invoke("enable-client-login", {
        body: { clientId: client.id },
      });
      if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      setNewCredentials({
        email: (data as any)?.email ?? client.email,
        password: (data as any)?.tempPassword ?? null,
      });
      toast.success("Login enabled for this client");
      if (profile) fetchClients(profile.agency_id);
    } catch (error: any) {
      toast.error(error.message || "Failed to enable login");
    } finally {
      setEnablingLoginId(null);
    }
  };

  const handleOpenEditDialog = (client: any) => {
    if (!canManageClients) {
      toast.error("You don't have permission to edit clients");
      return;
    }
    setIsEditMode(true);
    setEditClient(client);
    setFormData({
      first_name: client.first_name || "",
      last_name: client.last_name || "",
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
      city: client.city || "",
      state: client.state || "",
      zip_code: client.zip_code || "",
      date_of_birth: client.date_of_birth || "",
      medical_conditions: client.medical_conditions || [],
      care_type_codes: client.client_care_needs?.map((cn: any) => cn.care_type_code) || [],
      emergency_contact_name: client.emergency_contact_name || "",
      emergency_contact_phone: client.emergency_contact_phone || "",
      notes: client.notes || "",
    });
    setIsAddDialogOpen(true);
  };

  const handleSaveClient = async () => {
    if (!canManageClients) {
      toast.error("You don't have permission to modify clients");
      return;
    }

    // Validate form data
    const validation = clientFormSchema.safeParse(formData);
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    if (!user) {
      toast.error("User session not found");
      return;
    }

    if (!isEditMode && !formData.email) {
      toast.error("Email is required for new clients");
      return;
    }

    const clientData = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      phone: formData.phone,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      zip_code: formData.zip_code,
      date_of_birth: formData.date_of_birth || null,
      medical_conditions: formData.medical_conditions,
      emergency_contact_name: formData.emergency_contact_name,
      emergency_contact_phone: formData.emergency_contact_phone,
      notes: formData.notes,
    };

    if (isEditMode && editClient) {
      // Update profile if it exists
      if (editClient.user_id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            full_name: `${formData.first_name} ${formData.last_name}`,
            phone: formData.phone,
          })
          .eq("id", editClient.user_id);

        if (profileError) {
          toast.error("Failed to update profile");
          return;
        }
      }

      // Update client-specific data
      const { error } = await supabase
        .from("clients")
        .update(clientData)
        .eq("id", editClient.id);

      if (error) {
        toast.error("Failed to update client");
        return;
      }

      // Update care needs
      await supabase
        .from("client_care_needs")
        .delete()
        .eq("client_id", editClient.id);

      if (formData.care_type_codes.length > 0) {
        const careNeedsData = formData.care_type_codes.map((code, idx) => ({
          client_id: editClient.id,
          care_type_code: code,
          priority: idx + 1,
        }));

        await supabase.from("client_care_needs").insert(careNeedsData);
      }

      toast.success("Client updated successfully");
      setIsAddDialogOpen(false);
      if (profile) fetchClients(profile.agency_id);
    } else {
      if (!profile) {
        toast.error("Profile not found");
        return;
      }

      // Creates ONLY the client record -- no login. Login creation happens
      // exclusively via the deliberate Enable Login action (enable-client-login),
      // which uses the Admin API's pre-confirmed path. See Bug 3 investigation:
      // this used to auto-create a login here via create-user with a randomly
      // generated, never-surfaced password -- a phantom account nobody could
      // use. One login-creation path, not two.
      const { data: newClient, error } = await supabase
        .from("clients")
        .insert({
          ...clientData,
          email: formData.email,
          agency_id: profile.agency_id,
        })
        .select()
        .single();

      if (error || !newClient) {
        toast.error(error?.message || "Failed to create client");
        return;
      }

      // Add care needs
      if (formData.care_type_codes.length > 0) {
        const careNeedsData = formData.care_type_codes.map((code, idx) => ({
          client_id: newClient.id,
          care_type_code: code,
          priority: idx + 1,
        }));

        await supabase.from("client_care_needs").insert(careNeedsData);
      }

      toast.success("Client added successfully");
      setIsAddDialogOpen(false);
      setSearchQuery("");
      if (profile) fetchClients(profile.agency_id);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedClient || !newPassword) return;

    // Validate password
    const validation = passwordResetSchema.safeParse({ newPassword });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session found");

      // Get user_id from client profile
      const userId = selectedClient.user_id;
      if (!userId) {
        throw new Error("Client doesn't have a user account");
      }

      // Call edge function to reset password
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: userId,
            newPassword: newPassword,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to reset password");
      }

      toast.success("Password reset successfully!");
      setResetPasswordDialogOpen(false);
      setNewPassword("");
      setSelectedClient(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to reset password");
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!canManageClients) {
      toast.error("You don't have permission to delete clients");
      return;
    }

    if (!deleteClient) return;

    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", deleteClient.id);

    if (error) {
      toast.error("Failed to delete client");
    } else {
      toast.success("Client deleted successfully");
      setDeleteClient(null);
      if (profile) fetchClients(profile.agency_id);
    }
  };

  const handleBulkImport = () => {
    if (!canManageClients) {
      toast.error("You don't have permission to import clients");
      return;
    }

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
        const client: any = {};
        
        headers.forEach((header, index) => {
          const value = values[index];
          if (header === 'medical_conditions' || header === 'care_requirements') {
            client[header] = value ? value.split(';').map(s => s.trim()) : [];
          } else if (header === 'is_active') {
            client[header] = value.toLowerCase() === 'true';
          } else if (header === 'date_of_birth') {
            client[header] = value || null;
          } else {
            client[header] = value;
          }
        });

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) continue;

        const { error } = await supabase
          .from('clients')
          .insert({
            ...client,
            agency_id: user.id
          });

        if (error) {
          errorCount++;
        } else {
          successCount++;
        }
      }

      toast.success(`Imported ${successCount} clients${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
      if (profile) fetchClients(profile.agency_id);
    };
    input.click();
  };

  // Filter clients
  const filteredClients = clients.filter(client => {
    const fullName = `${client.first_name} ${client.last_name}`.toLowerCase();
    const matchesSearch = searchQuery === "" ||
      fullName.includes(searchQuery.toLowerCase()) ||
      client.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.medical_conditions?.some((condition: string) => 
        condition.toLowerCase().includes(searchQuery.toLowerCase())
      ) ||
      client.client_care_needs?.some((cn: any) => 
        cn.care_types?.name.toLowerCase().includes(searchQuery.toLowerCase())
      );

    const matchesPhone = searchPhone === "" ||
      client.phone?.includes(searchPhone);

    const matchesDob = searchDob === "" || client.date_of_birth === searchDob;

    // Mirrors CaregiverApprovals.tsx's locationFilter -- one combined field checked
    // against city, state, and zip together, not three separate filters.
    const place = filterLocation.trim().toLowerCase();
    const matchesLocation =
      place === "" ||
      [client.city, client.state, client.zip_code]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(place));

    const matchesService =
      filterService === "all" ||
      (client.client_care_needs ?? []).some((cn: any) => cn.care_type_code === filterService);

    const matchesStatus = filterStatus === "all" ||
      (filterStatus === "active" && client.is_active) ||
      (filterStatus === "inactive" && !client.is_active);

    return matchesSearch && matchesPhone && matchesDob && matchesLocation && matchesService && matchesStatus;
  });

  // Get unique locations
  const uniqueLocations = Array.from(new Set(clients.map(c => c.city).filter(Boolean)));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-muted-foreground">Loading clients...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h2 className="text-3xl font-bold mb-2">Client Management</h2>
            <p className="text-muted-foreground">Manage your client profiles</p>
          </div>
          <div className="flex gap-2">
            {canManageClients && (
              <>
                <Button variant="outline" className="gap-2" onClick={handleBulkImport}>
                  <Upload className="h-4 w-4" />
                  Upload/Import Table
                </Button>
                <Button className="gap-2" onClick={handleOpenAddDialog}>
                  <Plus className="h-4 w-4" />
                  Add Client
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, location, or care needs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="relative w-full sm:w-[180px]">
            <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Phone number..."
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="relative w-full sm:w-[160px]">
            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Date of birth..."
              type="date"
              value={searchDob}
              onChange={(e) => setSearchDob(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="relative w-full sm:w-[200px]">
            <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="City, state or ZIP..."
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select value={filterService} onValueChange={setFilterService}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All Care Services" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Care Services</SelectItem>
              {groupedOptions.flatMap((group) =>
                group.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))
              )}
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

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{clients.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {clients.filter(c => c.is_active).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">With Care Needs</CardTitle>
              <Heart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {clients.filter(c => c.client_care_needs && c.client_care_needs.length > 0).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Locations</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{uniqueLocations.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Clients Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              {filteredClients.length} Client{filteredClients.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredClients.length === 0 ? (
              <div className="text-center py-12">
                <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-2">No clients found</p>
                {canManageClients && (
                  <Button variant="outline" onClick={handleOpenAddDialog}>
                    Add Your First Client
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Family</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Care Needs</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">
                        {client.first_name} {client.last_name}
                      </TableCell>
                      <TableCell>
                        {client.families?.id ? (
                          <Button
                            variant="link"
                            className="h-auto p-0 text-sm"
                            onClick={() => setFamilyDialogId(client.families.id)}
                          >
                            {client.families.family_name}
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{client.profiles?.email || client.email || '-'}</span>
                      </TableCell>

                      <TableCell>
                        <span className="text-sm">{client.phone}</span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {client.city}, {client.state}
                        </div>
                      </TableCell>
                      <TableCell>
                        {client.date_of_birth ? calculateAge(client.date_of_birth) : "-"}
                      </TableCell>
                      <TableCell>
                        {client.client_care_needs && client.client_care_needs.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {client.client_care_needs.slice(0, 2).map((cn: any, idx: number) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {cn.care_types?.name || cn.care_type_code}
                              </Badge>
                            ))}
                            {client.client_care_needs.length > 2 && (
                              <Badge variant="secondary" className="text-xs">
                                +{client.client_care_needs.length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">None specified</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.is_active ? "default" : "secondary"}>
                          {client.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.user_id ? "default" : "outline"}>
                          {client.user_id ? "Linked" : "No login"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setViewClient(client)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View</TooltipContent>
                          </Tooltip>
                          {canManageClients && (
                            <>
                              {!client.user_id && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={enablingLoginId === client.id}
                                      onClick={() => handleEnableLogin(client)}
                                    >
                                      <UserPlus className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Enable login</TooltipContent>
                                </Tooltip>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSchedulingClient(client)}
                                  >
                                    <CalendarClock className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Scheduling preferences &amp; flexibility</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleOpenEditDialog(client)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedClient(client);
                                      setResetPasswordDialogOpen(true);
                                    }}
                                    disabled={!client.user_id}
                                  >
                                    <Key className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {!client.user_id ? "Client doesn't have a user account" : "Reset password"}
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDeleteClient(client)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      {/* Add/Edit Client Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit Client" : "Add New Client"}</DialogTitle>
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
              <Label htmlFor="email">Email {!isEditMode && '*'}</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="client@example.com"
                disabled={isEditMode}
              />
              <p className="text-xs text-muted-foreground">
                {isEditMode
                  ? "Email cannot be changed after account creation"
                  : "Contact info -- used if a manager later clicks Enable Login"}
              </p>
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
              <Label htmlFor="address">Address *</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
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
                <Input
                  id="state"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip_code">Zip Code</Label>
                <Input
                  id="zip_code"
                  value={formData.zip_code}
                  onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date_of_birth">Date of Birth</Label>
              <Input
                id="date_of_birth"
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Medical Conditions</Label>
              <ReactSelect
                isMulti
                options={medicalConditionsOptions}
                value={medicalConditionsOptions.filter(opt => formData.medical_conditions.includes(opt.value))}
                onChange={(selected) => setFormData({ 
                  ...formData, 
                  medical_conditions: selected.map(s => s.value) 
                })}
                className="react-select-container"
                classNamePrefix="react-select"
              />
            </div>
            <div className="space-y-2">
              <Label>Care Services</Label>
              <ReactSelect
                isMulti
                options={groupedOptions}
                value={formData.care_type_codes.map(optionFor)}
                onChange={(selected) => setFormData({ 
                  ...formData, 
                  care_type_codes: selected.map(s => s.value) 
                })}
                className="react-select-container"
                classNamePrefix="react-select"
                placeholder="Select care services by category..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergency_contact_name">Emergency Contact Name</Label>
              <Input
                id="emergency_contact_name"
                value={formData.emergency_contact_name}
                onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergency_contact_phone">Emergency Contact Phone</Label>
              <Input
                id="emergency_contact_phone"
                type="tel"
                value={formData.emergency_contact_phone}
                onChange={(e) => setFormData({ ...formData, emergency_contact_phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveClient}>
              {isEditMode ? "Update" : "Add"} Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={!!viewClient} onOpenChange={() => setViewClient(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Client Details</DialogTitle>
          </DialogHeader>
          {viewClient && (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-bold mb-1">
                    {viewClient.first_name} {viewClient.last_name}
                  </h3>
                  {viewClient.date_of_birth && (
                    <p className="text-sm text-muted-foreground">
                      Age {calculateAge(viewClient.date_of_birth)} • Born {format(new Date(viewClient.date_of_birth), "MMM dd, yyyy")}
                    </p>
                  )}
                </div>
                <Badge variant={viewClient.is_active ? "default" : "secondary"}>
                  {viewClient.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{viewClient.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{viewClient.address}, {viewClient.city}, {viewClient.state} {viewClient.zip_code}</span>
                </div>
              </div>

              {viewClient.medical_conditions && viewClient.medical_conditions.length > 0 && (
                <div className="pt-3 border-t">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-medium">Medical Conditions</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {viewClient.medical_conditions.map((condition: string, idx: number) => (
                      <Badge key={idx} variant="outline" className="text-xs bg-destructive/5 text-destructive border-destructive/20">
                        {condition}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewClient.client_care_needs && viewClient.client_care_needs.length > 0 && (
                <div className="pt-3 border-t">
                  <div className="flex items-center gap-2 mb-2">
                    <Heart className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Care Needs</span>
                  </div>
                  <div className="space-y-2">
                    {viewClient.client_care_needs.map((cn: any, idx: number) => (
                      <div key={idx} className="flex items-start justify-between p-2 rounded bg-secondary/10">
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            {cn.care_types?.name || cn.care_type_code}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {cn.care_needs?.category}
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          Priority {cn.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(viewClient.emergency_contact_name || viewClient.emergency_contact_phone) && (
                <div className="pt-3 border-t">
                  <div className="flex items-center gap-2 mb-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Emergency Contact</span>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">{viewClient.emergency_contact_name}</p>
                    <p className="text-muted-foreground">{viewClient.emergency_contact_phone}</p>
                  </div>
                </div>
              )}

              {viewClient.notes && (
                <div className="pt-3 border-t">
                  <div className="text-sm font-medium mb-1">Notes</div>
                  <p className="text-sm text-muted-foreground">{viewClient.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedClient?.first_name} {selectedClient?.last_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
              />
              <p className="text-xs text-muted-foreground">
                Minimum 6 characters required
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetPasswordDialogOpen(false);
                setNewPassword("");
                setSelectedClient(null);
              }}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleResetPassword}
              disabled={resetting || newPassword.length < 6}
            >
              {resetting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newCredentials} onOpenChange={(open) => !open && setNewCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Client login created</DialogTitle>
            <DialogDescription>
              No email is sent yet — this notice is stored in the notification outbox. Share these
              details with the client directly.
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteClient} onOpenChange={() => setDeleteClient(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteClient?.first_name} {deleteClient?.last_name} from your client list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FamilyDialog
        familyId={familyDialogId}
        open={!!familyDialogId}
        onOpenChange={(open) => !open && setFamilyDialogId(null)}
        onChanged={() => profile?.agency_id && fetchClients(profile.agency_id)}
      />

      <ClientSchedulingDialog
        client={schedulingClient}
        open={!!schedulingClient}
        onOpenChange={(open) => !open && setSchedulingClient(null)}
        onSaved={() => profile?.agency_id && fetchClients(profile.agency_id)}
      />

      </div>

    </AppLayout>
  );
};

export default Clients;
