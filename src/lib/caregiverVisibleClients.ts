import { supabase } from "@/integrations/supabase/client";

/**
 * SINGLE SOURCE OF TRUTH for caregiver-facing client info.
 *
 * public.clients has no RLS policy granting caregivers row access at all — a nested
 * PostgREST embed (shifts -> clients) silently resolves to null for a caregiver caller,
 * which previously surfaced as "Unknown client" everywhere. get_caregiver_visible_clients()
 * (SECURITY DEFINER) does its own row filtering (assigned shift, or an open shift in the
 * caregiver's own office) and returns ONLY a narrow, non-PHI column set — never
 * medical_conditions, care_requirements, or free-text notes, mirroring the same exclusion
 * match-caregiver already applies. Never widen this without updating both the DB function
 * and this type together.
 */
export interface CaregiverVisibleClient {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  scheduling_flexibility: string | null;
}

export async function fetchCaregiverVisibleClients(): Promise<Map<string, CaregiverVisibleClient>> {
  const map = new Map<string, CaregiverVisibleClient>();
  const { data, error } = await supabase.rpc("get_caregiver_visible_clients" as never);
  if (error || !data) return map;
  for (const row of data as unknown as CaregiverVisibleClient[]) {
    map.set(row.id, row);
  }
  return map;
}
