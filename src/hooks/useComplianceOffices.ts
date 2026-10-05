import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { STAFF } from "@/lib/roleHome";

export interface ComplianceOffice {
  id: string;
  name: string;
  moduleEnabled: boolean;
  enforcementEnabled: boolean;
  /** Go-live date of the care-plan module (stamped by the server; read-only). */
  moduleEnabledAt: string | null;
}

/**
 * Offices the user can see, with the care-plan module and enforcement flags (Q3).
 *
 * `virtual_office` is readable agency-wide, so the M-Office scope is applied here: an
 * office-restricted user sees only their own office, unrestricted staff see every office of their
 * agency, and system_admin / caregivers / clients see none (not in the clinical tier). This only
 * decides what renders (menus, sections); RLS and the RPC checks remain the enforcement.
 */
export function useComplianceOffices() {
  const { profile, isLoading: profileLoading } = useCurrentProfile();
  const query = useQuery({
    queryKey: ["compliance-offices", profile?.userId, profile?.agencyId, profile?.officeId, profile?.officeRestricted, profile?.role],
    enabled: !!profile,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ComplianceOffice[]> => {
      if (!profile?.agencyId || !profile.role || profile.role === "system_admin" || !STAFF.includes(profile.role)) return [];
      if (profile.officeRestricted && !profile.officeId) return [];
      let q = supabase
        .from("virtual_office")
        .select("id, name, care_plan_module_enabled, compliance_enforcement_enabled, care_plan_module_enabled_at")
        .eq("agency_id", profile.agencyId)
        .order("name");
      if (profile.officeRestricted && profile.officeId) q = q.eq("id", profile.officeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        moduleEnabled: o.care_plan_module_enabled === true,
        enforcementEnabled: o.compliance_enforcement_enabled === true,
        moduleEnabledAt: o.care_plan_module_enabled_at ?? null,
      }));
    },
  });
  const offices = query.data ?? [];
  const moduleOffices = offices.filter((o) => o.moduleEnabled);
  return {
    ...query,
    offices,
    moduleOffices,
    hasModuleOffice: moduleOffices.length > 0,
    /** True until both the profile and the offices are known (render nothing gated meanwhile). */
    loading: profileLoading || (!!profile && query.isLoading),
  };
}
