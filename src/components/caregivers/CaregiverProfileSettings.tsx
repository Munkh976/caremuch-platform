import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, Lock, User, Briefcase, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AvailabilityDialog } from "./AvailabilityDialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCareServices } from "@/hooks/useCareServices";
import { US_STATES } from "@/constants/usStates";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface Caregiver {
  id: string;
  user_id?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  location_zip_code: string | null;
  service_radius_miles: number | null;
  service_zipcodes: string[] | null;
}

interface CaregiverSkill {
  id: string;
  care_type_code: string;
  proficiency_level: string;
  years_experience: number;
  is_certified: boolean;
}

interface CareType {
  code: string;
  name: string;
  category: string;
}

interface CaregiverProfileSettingsProps {
  caregiverProfile: Caregiver | null;
  onRefresh: () => void;
}

export const CaregiverProfileSettings = ({ caregiverProfile, onRefresh }: CaregiverProfileSettingsProps) => {
  const [editMode, setEditMode] = useState(false);
  const [showAvailabilityDialog, setShowAvailabilityDialog] = useState(false);
  const [formData, setFormData] = useState(caregiverProfile);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [skills, setSkills] = useState<CaregiverSkill[]>([]);
  const { services, categoryNames } = useCareServices();
  const careTypes = services as unknown as CareType[];
  const [editSkillsMode, setEditSkillsMode] = useState(false);
  const [selectedCareType, setSelectedCareType] = useState("");
  const [newSkillData, setNewSkillData] = useState({
    proficiency_level: "intermediate",
    years_experience: 0,
    is_certified: false,
  });
  const [suggestedZipCodes, setSuggestedZipCodes] = useState<string[]>([]);
  const [loadingZipCodes, setLoadingZipCodes] = useState(false);

useEffect(() => {
  fetchSkills();
  // Care services come from the shared useCareServices hook.
}, [caregiverProfile?.id]);

// Keep local form state in sync with incoming profile
useEffect(() => {
  setFormData(caregiverProfile);
}, [caregiverProfile]);

  const fetchSkills = async () => {
    if (!caregiverProfile?.id) return;
    
    const { data, error } = await supabase
      .from("caregiver_skills")
      .select("*")
      .eq("caregiver_id", caregiverProfile.id);

    if (error) {
      console.error("Error fetching skills:", error);
      return;
    }
    setSkills(data || []);
  };

  const handleSave = async () => {
    if (!formData || !caregiverProfile) return;

    try {
      // Update caregiver record (including personal info + address/location)
      const { error } = await supabase
        .from("caregivers")
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
          location_city: formData.location_city,
          location_state: formData.location_state,
          service_zipcodes: formData.service_zipcodes || [],
        })
        .eq("id", caregiverProfile.id);

      if (error) throw error;

      // If linked user exists, update profiles for consistency
      if (caregiverProfile.user_id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            full_name: `${formData.first_name || ''} ${formData.last_name || ''}`.trim(),
            phone: formData.phone || undefined,
          })
          .eq("id", caregiverProfile.user_id);
        if (profileError) throw profileError;
      }

      toast.success("Profile updated successfully");
      setEditMode(false);
      onRefresh();
    } catch (error: any) {
      toast.error(error.message || "Failed to update settings");
    }
  };

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => prev ? { ...prev, [field]: value } : null);
  };

  const handleAddSkill = async () => {
    if (!selectedCareType || !caregiverProfile?.id) {
      toast.error("Please select a care service");
      return;
    }

    const existingSkill = skills.find(s => s.care_type_code === selectedCareType);
    if (existingSkill) {
      toast.error("This skill is already added");
      return;
    }

    try {
      const { error } = await supabase
        .from("caregiver_skills")
        .insert({
          caregiver_id: caregiverProfile.id,
          care_type_code: selectedCareType,
          proficiency_level: newSkillData.proficiency_level,
          years_experience: newSkillData.years_experience,
          is_certified: newSkillData.is_certified,
        });

      if (error) throw error;

      toast.success("Skill added successfully");
      setSelectedCareType("");
      setNewSkillData({
        proficiency_level: "intermediate",
        years_experience: 0,
        is_certified: false,
      });
      fetchSkills();
    } catch (error: any) {
      toast.error("Failed to add skill");
      console.error(error);
    }
  };

  const handleRemoveSkill = async (skillId: string) => {
    try {
      const { error } = await supabase
        .from("caregiver_skills")
        .delete()
        .eq("id", skillId);

      if (error) throw error;

      toast.success("Skill removed successfully");
      fetchSkills();
    } catch (error: any) {
      toast.error("Failed to remove skill");
      console.error(error);
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

  const fetchZipCodesForCity = async (city: string, state: string) => {
    if (!city || !state) {
      setSuggestedZipCodes([]);
      return;
    }

    setLoadingZipCodes(true);
    try {
      const response = await fetch(`https://api.zippopotam.us/us/${state}/${encodeURIComponent(city)}`);
      if (response.ok) {
        const data = await response.json();
        const zipcodes = data.places?.map((place: any) => place['post code']) || [];
        setSuggestedZipCodes(zipcodes);
      } else {
        setSuggestedZipCodes([]);
      }
    } catch (error) {
      console.error("Error fetching zip codes:", error);
      setSuggestedZipCodes([]);
    } finally {
      setLoadingZipCodes(false);
    }
  };

  const handleAddZipCode = (zipCode: string) => {
    if (!zipCode.trim()) return;

    const currentZips = formData?.service_zipcodes || [];
    if (currentZips.includes(zipCode)) {
      toast.error("This zip code is already added");
      return;
    }

    setFormData({
      ...formData,
      service_zipcodes: [...currentZips, zipCode]
    });
  };

  const handleRemoveZipCode = (zipCode: string) => {
    setFormData({
      ...formData,
      service_zipcodes: (formData.service_zipcodes || []).filter((z: string) => z !== zipCode)
    });
  };

  if (!caregiverProfile || !formData) {
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
        <p className="text-sm text-muted-foreground">Manage your location and availability</p>
      </div>

      {/* Personal Information */}
      <Card>
<CardHeader>
  <div className="flex items-center justify-between">
    <div>
      <CardTitle>Personal Information</CardTitle>
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
    value={formData?.first_name || ""}
    onChange={(e) => updateFormData('first_name', e.target.value)}
    disabled={!editMode}
  />
</div>
<div className="space-y-2">
  <Label>Last Name</Label>
  <Input
    value={formData?.last_name || ""}
    onChange={(e) => updateFormData('last_name', e.target.value)}
    disabled={!editMode}
  />
</div>
</div>
<div className="space-y-2">
  <Label>Email</Label>
  {/* Login email is the account identity; only the office can change it (M-SEC-2 guard). */}
  <Input value={formData?.email || ""} disabled readOnly />
  {editMode && (
    <p className="text-xs text-muted-foreground">To change your email, contact your office.</p>
  )}
</div>
<div className="space-y-2">
  <Label>Phone</Label>
  <Input
    value={formData?.phone || ""}
    onChange={(e) => updateFormData('phone', e.target.value)}
    disabled={!editMode}
  />
</div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <Label>Address</Label>
            <Input
              value={formData?.address || ""}
              onChange={(e) => updateFormData('address', e.target.value)}
              disabled={!editMode}
              placeholder="Street address"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input
                value={formData?.city || ""}
                onChange={(e) => updateFormData('city', e.target.value)}
                disabled={!editMode}
                placeholder="City"
              />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Select
                value={formData?.state || ""}
                onValueChange={(v) => updateFormData('state', v)}
                disabled={!editMode}
              >
                <SelectTrigger disabled={!editMode}>
                  <SelectValue placeholder="State" />
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
                value={formData?.zip_code || ""}
                onChange={(e) => updateFormData('zip_code', e.target.value)}
                disabled={!editMode}
                placeholder="ZIP"
              />
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <Label>Emergency Contact Name</Label>
            <Input
              value={formData?.emergency_contact_name || ""}
              onChange={(e) => updateFormData('emergency_contact_name', e.target.value)}
              disabled={!editMode}
              placeholder="Emergency contact name"
            />
          </div>
          <div className="space-y-2">
            <Label>Emergency Contact Phone</Label>
            <Input
              value={formData?.emergency_contact_phone || ""}
              onChange={(e) => updateFormData('emergency_contact_phone', e.target.value)}
              disabled={!editMode}
              placeholder="Emergency contact phone"
            />
          </div>
        </CardContent>
      </Card>

      {/* Location Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Service Location
              </CardTitle>
              <CardDescription>Set your preferred service area</CardDescription>
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
              <Label>City</Label>
              <Input
                value={formData.location_city || ""}
                onChange={(e) => {
                  const newCity = e.target.value;
                  updateFormData('location_city', newCity);
                  if (newCity && formData.location_state) {
                    fetchZipCodesForCity(newCity, formData.location_state);
                  }
                }}
                disabled={!editMode}
                placeholder="Enter city"
              />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Select
                value={formData.location_state || ""}
                onValueChange={(v) => {
                  updateFormData('location_state', v);
                  if (v && formData.location_city) {
                    fetchZipCodesForCity(formData.location_city, v);
                  }
                }}
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
          </div>

          <div className="space-y-3">
            <div>
              <Label>Service Zip Codes</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Select zip codes where you provide services (based on your city/state above)
              </p>
            </div>

            {editMode ? (
              <div className="space-y-3">
                {loadingZipCodes && (
                  <p className="text-sm text-muted-foreground">Loading zip codes...</p>
                )}
                
                {!loadingZipCodes && suggestedZipCodes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2">
                      Available zip codes for {formData.location_city}, {formData.location_state}:
                    </p>
                    <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-md max-h-40 overflow-y-auto">
                      {suggestedZipCodes.map((zipCode) => (
                        <Badge
                          key={zipCode}
                          variant={formData.service_zipcodes?.includes(zipCode) ? "default" : "outline"}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => {
                            if (formData.service_zipcodes?.includes(zipCode)) {
                              handleRemoveZipCode(zipCode);
                            } else {
                              handleAddZipCode(zipCode);
                            }
                          }}
                        >
                          {zipCode}
                          {formData.service_zipcodes?.includes(zipCode) && " ✓"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {!loadingZipCodes && suggestedZipCodes.length === 0 && formData.location_city && formData.location_state && (
                  <p className="text-sm text-muted-foreground">
                    No zip codes found. Please check your city and state selection.
                  </p>
                )}
                
                {formData.service_zipcodes && formData.service_zipcodes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2">Selected zip codes:</p>
                    <div className="flex flex-wrap gap-2">
                      {formData.service_zipcodes.map((zipCode: string, index: number) => (
                        <Badge key={index} variant="secondary" className="gap-1">
                          {zipCode}
                          <button
                            type="button"
                            onClick={() => handleRemoveZipCode(zipCode)}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {formData.service_zipcodes && formData.service_zipcodes.length > 0 ? (
                  formData.service_zipcodes.map((zipCode: string, index: number) => (
                    <Badge key={index} variant="secondary">
                      {zipCode}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No zip codes added yet</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Skills & Certifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                Skills & Certifications
              </CardTitle>
              <CardDescription>Manage the care services you can deliver</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditSkillsMode(!editSkillsMode)}
            >
              {editSkillsMode ? "Done" : "Edit Skills"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills added yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => {
                const careType = careTypes.find(ct => ct.code === skill.care_type_code);
                return (
                  <Badge key={skill.id} variant="secondary" className="text-sm py-1 px-3">
                    {careType?.name || skill.care_type_code}
                    {editSkillsMode && (
                      <button
                        onClick={() => handleRemoveSkill(skill.id)}
                        className="ml-2 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                );
              })}
            </div>
          )}

          {editSkillsMode && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label>Add Care Service</Label>
                <Select value={selectedCareType} onValueChange={setSelectedCareType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select care service" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryNames.map((category) => (
                      <SelectGroup key={category}>
                        <SelectLabel>{category}</SelectLabel>
                        {services
                          .filter((s) => s.category === category)
                          .map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.name} · {s.code}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Proficiency</Label>
                    <Select
                      value={newSkillData.proficiency_level}
                      onValueChange={(value) =>
                        setNewSkillData((prev) => ({ ...prev, proficiency_level: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                        <SelectItem value="expert">Expert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Years</Label>
                    <Input
                      type="number"
                      min="0"
                      value={newSkillData.years_experience}
                      onChange={(e) =>
                        setNewSkillData((prev) => ({
                          ...prev,
                          years_experience: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Certified</Label>
                    <Select
                      value={newSkillData.is_certified ? "yes" : "no"}
                      onValueChange={(value) =>
                        setNewSkillData((prev) => ({ ...prev, is_certified: value === "yes" }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleAddSkill} className="w-full">
                  Add Skill
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Availability Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Availability Schedule
          </CardTitle>
          <CardDescription>Manage your weekly availability</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setShowAvailabilityDialog(true)}>
            Manage Availability
          </Button>
        </CardContent>
      </Card>

      {/* Password & Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Password & Security
          </CardTitle>
          <CardDescription>Update your password and security settings</CardDescription>
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
                  onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                  placeholder="Enter current password"
                />
              </div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                  placeholder="Enter new password"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
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

      {editMode && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => {
            setEditMode(false);
            setFormData(caregiverProfile);
          }}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      )}

      {showAvailabilityDialog && (
        <AvailabilityDialog
          caregiver={caregiverProfile}
          isOpen={showAvailabilityDialog}
          onClose={() => setShowAvailabilityDialog(false)}
        />
      )}
    </div>
  );
};