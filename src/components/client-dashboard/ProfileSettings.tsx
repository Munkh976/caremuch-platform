import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCareServices } from "@/hooks/useCareServices";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { User, Phone, Mail, MapPin, Heart, Bell, Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactSelect from "react-select";
import { US_STATES } from "@/constants/usStates";
interface Client {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_conditions: string[];
  notes: string | null;
}

interface ProfileSettingsProps {
  clientProfile: Client | null;
  userEmail: string;
  onRefresh: () => void;
}

interface CareType {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
}

interface ClientCareType {
  id: string;
  care_type_code: string;
  priority: number;
  notes: string | null;
  care_type?: CareType;
}

export const ProfileSettings = ({ clientProfile, userEmail, onRefresh }: ProfileSettingsProps) => {
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState(clientProfile);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(true);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [clientCareTypes, setClientCareTypes] = useState<ClientCareType[]>([]);
  const { groupedOptions, optionFor } = useCareServices();
  const [selectedCareTypes, setSelectedCareTypes] = useState<string[]>([]);

  useEffect(() => {
    if (clientProfile?.id) {
      fetchClientCareTypes();
      // Care services come from the shared useCareServices hook.
    }
  }, [clientProfile?.id]);

  const fetchClientCareTypes = async () => {
    if (!clientProfile?.id) return;

    try {
      const { data, error } = await supabase
        .from("client_care_needs")
        .select(`
          id,
          care_type_code,
          priority,
          notes,
          care_types!client_care_needs_care_type_code_fkey (
            id,
            code,
            name,
            category,
            description
          )
        `)
        .eq("client_id", clientProfile.id)
        .order("priority", { ascending: true });

      if (error) throw error;
      
      const formattedData = data.map(item => ({
        ...item,
        care_type: Array.isArray(item.care_types) ? item.care_types[0] : item.care_types
      }));
      
      setClientCareTypes(formattedData as any);
    } catch (error: any) {
      console.error("Error fetching client care types:", error);
    }
  };

  const handleAddCareTypes = async () => {
    if (!selectedCareTypes.length || !clientProfile?.id) return;

    // Filter out care services that are already on the client
    const existingCodes = clientCareTypes.map(cn => cn.care_type_code);
    const newCareTypes = selectedCareTypes.filter(code => !existingCodes.includes(code));

    if (!newCareTypes.length) {
      toast.error("All selected care services are already added");
      return;
    }

    try {
      const insertData = newCareTypes.map((code, index) => ({
        client_id: clientProfile.id,
        care_type_code: code,
        priority: clientCareTypes.length + index + 1,
      }));

      const { error } = await supabase
        .from("client_care_needs")
        .insert(insertData);

      if (error) throw error;

      toast.success(`${newCareTypes.length} care service(s) added successfully`);
      setSelectedCareTypes([]);
      await fetchClientCareTypes();
      onRefresh(); // Refresh parent data
    } catch (error: any) {
      toast.error(error.message || "Failed to add care services");
    }
  };

  const handleRemoveCareType = async (careTypeId: string) => {
    try {
      const { error } = await supabase
        .from("client_care_needs")
        .delete()
        .eq("id", careTypeId);

      if (error) throw error;

      toast.success("Care type removed successfully");
      await fetchClientCareTypes();
      onRefresh(); // Refresh parent data
    } catch (error: any) {
      toast.error(error.message || "Failed to remove care service");
    }
  };


  const handleSave = async () => {
    if (!formData || !clientProfile) return;

    try {
      const { error } = await supabase
        .from("clients")
        .update({
          first_name: formData.first_name,
          last_name: formData.last_name,
          phone: formData.phone,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          zip_code: formData.zip_code,
          emergency_contact_name: formData.emergency_contact_name,
          emergency_contact_phone: formData.emergency_contact_phone,
        })
        .eq("id", clientProfile.id);

      if (error) throw error;

      toast.success("Profile updated successfully");
      setEditMode(false);
      onRefresh();
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    }
  };

  const handlePasswordChange = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword,
      });

      if (error) throw error;

      toast.success("Password updated successfully");
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setShowPasswordSection(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to update password");
    }
  };

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => prev ? { ...prev, [field]: value } : null);
  };

  if (!clientProfile || !formData) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Profile not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold">Profile & Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your personal information and preferences</p>
      </div>

      {/* Personal Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Personal Information
              </CardTitle>
              <CardDescription>Your basic profile details</CardDescription>
            </div>
            {!editMode && (
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input
                value={formData.first_name}
                onChange={(e) => updateFormData('first_name', e.target.value)}
                disabled={!editMode}
              />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input
                value={formData.last_name}
                onChange={(e) => updateFormData('last_name', e.target.value)}
                disabled={!editMode}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={userEmail} disabled />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              value={formData.phone}
              onChange={(e) => updateFormData('phone', e.target.value)}
              disabled={!editMode}
            />
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Address
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Street Address</Label>
            <Input
              value={formData.address}
              onChange={(e) => updateFormData('address', e.target.value)}
              disabled={!editMode}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input
                value={formData.city}
                onChange={(e) => updateFormData('city', e.target.value)}
                disabled={!editMode}
              />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Select
                value={formData.state}
                onValueChange={(v) => updateFormData('state', v)}
                disabled={!editMode}
              >
                <SelectTrigger className="w-full" disabled={!editMode}>
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
              <Label>ZIP Code</Label>
              <Input
                value={formData.zip_code}
                onChange={(e) => updateFormData('zip_code', e.target.value)}
                disabled={!editMode}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Emergency Contact */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Emergency Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Contact Name</Label>
            <Input
              value={formData.emergency_contact_name || ""}
              onChange={(e) => updateFormData('emergency_contact_name', e.target.value)}
              disabled={!editMode}
              placeholder="Enter emergency contact name"
            />
          </div>
          <div className="space-y-2">
            <Label>Contact Phone</Label>
            <Input
              value={formData.emergency_contact_phone || ""}
              onChange={(e) => updateFormData('emergency_contact_phone', e.target.value)}
              disabled={!editMode}
              placeholder="Enter emergency contact phone"
            />
          </div>
        </CardContent>
      </Card>

      {/* Care Needs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-primary" />
                Care Needs
              </CardTitle>
              <CardDescription>Manage your specific care requirements</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {editMode && (
            <div className="space-y-3">
              <Label>Add Care Services</Label>
              <ReactSelect
                isMulti
                options={groupedOptions
                  .map(group => ({
                    label: group.label,
                    options: group.options.filter(
                      o => !clientCareTypes.some(cn => cn.care_type_code === o.value)
                    ),
                  }))
                  .filter(group => group.options.length > 0)}
                value={selectedCareTypes.map(optionFor)}
                onChange={(selected) => {
                  setSelectedCareTypes(selected ? selected.map(s => s.value) : []);
                }}
                placeholder="Select care services to add..."
                className="react-select-container"
                classNamePrefix="react-select"
                styles={{
                  control: (base) => ({
                    ...base,
                    backgroundColor: 'hsl(var(--background))',
                    borderColor: 'hsl(var(--input))',
                    '&:hover': {
                      borderColor: 'hsl(var(--input))'
                    }
                  }),
                  menu: (base) => ({
                    ...base,
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))'
                  }),
                  option: (base, state) => ({
                    ...base,
                    backgroundColor: state.isFocused ? 'hsl(var(--accent))' : 'transparent',
                    color: 'hsl(var(--foreground))',
                    cursor: 'pointer'
                  }),
                  multiValue: (base) => ({
                    ...base,
                    backgroundColor: 'hsl(var(--primary))',
                  }),
                  multiValueLabel: (base) => ({
                    ...base,
                    color: 'hsl(var(--primary-foreground))',
                  }),
                  multiValueRemove: (base) => ({
                    ...base,
                    color: 'hsl(var(--primary-foreground))',
                    ':hover': {
                      backgroundColor: 'hsl(var(--primary) / 0.8)',
                      color: 'hsl(var(--primary-foreground))',
                    },
                  }),
                }}
              />
              {selectedCareTypes.length > 0 && (
                <Button
                  onClick={handleAddCareTypes}
                  className="w-full"
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add {selectedCareTypes.length} Selected Care Service{selectedCareTypes.length > 1 ? 's' : ''}
                </Button>
              )}
            </div>
          )}

          {clientCareTypes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {clientCareTypes.map((clientType) => (
                <Badge key={clientType.id} variant="default" className="px-3 py-2 text-sm">
                  <span className="mr-2">{clientType.care_type?.name}</span>
                  {editMode && (
                    <X
                      className="h-3 w-3 cursor-pointer hover:opacity-70"
                      onClick={() => handleRemoveCareType(clientType.id)}
                    />
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No care needs added yet. {editMode && "Click badges above to add."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Medical Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-primary" />
            Medical Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Medical Conditions</Label>
            <div className="flex flex-wrap gap-2">
              {clientProfile.medical_conditions?.length > 0 ? (
                clientProfile.medical_conditions.map((condition, idx) => (
                  <span key={idx} className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm">
                    {condition}
                  </span>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No medical conditions listed</p>
              )}
            </div>
          </div>
          {/* clients.notes is the staff-only "Notes" field (Client Details dialog): not shown or
              editable in the client portal (M-SEC-2 guard). See known-issues: client_notes. */}
        </CardContent>
      </Card>

      {/* Security & Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Security & Password
          </CardTitle>
          <CardDescription>Manage your account security</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showPasswordSection ? (
            <Button
              variant="outline"
              onClick={() => setShowPasswordSection(true)}
            >
              Change Password
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Current Password</Label>
                <Input
                  type="password"
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                  placeholder="Enter current password"
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  placeholder="Enter new password (min. 6 characters)"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  placeholder="Confirm new password"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPasswordSection(false);
                    setPasswordData({
                      currentPassword: "",
                      newPassword: "",
                      confirmPassword: "",
                    });
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handlePasswordChange}>
                  Update Password
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notification Preferences
          </CardTitle>
          <CardDescription>Manage how you receive updates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive updates via email</p>
            </div>
            <Switch
              checked={emailNotifications}
              onCheckedChange={setEmailNotifications}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>SMS Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive updates via text message</p>
            </div>
            <Switch
              checked={smsNotifications}
              onCheckedChange={setSmsNotifications}
            />
          </div>
        </CardContent>
      </Card>

      {editMode && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => {
            setEditMode(false);
            setFormData(clientProfile);
          }}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
};
