import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OfficePlace } from "@/lib/visitPlace";

/**
 * The agency's offices with their "Visits take place at" setting and address (owner, Oct 22, A), keyed by office id.
 * virtual_office SELECT is agency-wide under RLS (staff and caregivers of the agency).
 */
export function useOfficePlaces() {
  const q = useQuery({
    queryKey: ["office-places"],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, OfficePlace>> => {
      const { data, error } = await supabase.from("virtual_office")
        .select("id, name, visit_location, note_location_default, address, city, state, zip_code");
      if (error) throw error;
      return new Map((data ?? []).map((o) => [o.id, o as OfficePlace]));
    },
  });
  return q.data ?? new Map<string, OfficePlace>();
}
