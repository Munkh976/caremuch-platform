import { supabase } from "@/integrations/supabase/client";

/**
 * Client-portal reads of caregivers (M-SEC-5). Clients no longer have any direct SELECT on
 * `caregivers` / `caregiver_availability`; these two SECURITY DEFINER RPCs scope to the signed-in
 * client's own record(s) and return display-safe fields only (first name, last initial, role label,
 * care types, aggregate rating) — never email, phone, address, zip codes or pay rate.
 * Same pattern as caregiverVisibleClients.ts on the caregiver side.
 */

export interface CareTeamMember {
  caregiver_id: string;
  first_name: string;
  last_initial: string;
  employment_role: string | null;
  care_type_codes: string[];
  avg_rating: number | null;
  rating_count: number;
  shift_count: number;
  last_shift_date: string | null;
  next_shift_date: string | null;
  is_preferred: boolean;
}

export interface BookableCaregiver {
  caregiver_id: string;
  first_name: string;
  last_initial: string;
  care_type_codes: string[];
  avg_rating: number | null;
  rating_count: number;
  day_windows: { start_time: string; end_time: string }[];
}

/** "Maria G." */
export const displayName = (c: { first_name: string; last_initial: string }) =>
  c.last_initial ? `${c.first_name} ${c.last_initial}.` : c.first_name;

const num = (v: unknown) => (v == null ? null : Number(v));

/** Caregivers on the caller's shifts (CURRENT_DATE-180 .. +90 days) plus the preferred caregiver. */
export async function fetchMyCareTeam(): Promise<CareTeamMember[]> {
  const { data, error } = await supabase.rpc("get_my_care_team" as never);
  if (error) throw error;
  return ((data as unknown as CareTeamMember[]) ?? []).map((r) => ({
    ...r,
    care_type_codes: r.care_type_codes ?? [],
    avg_rating: num(r.avg_rating),
    rating_count: Number(r.rating_count ?? 0),
    shift_count: Number(r.shift_count ?? 0),
  }));
}

/** Booking picker: caregivers serving the client's zip with availability on `dayOfWeek` (0=Sun). */
export async function fetchBookableCaregivers(dayOfWeek: number): Promise<BookableCaregiver[]> {
  const { data, error } = await supabase.rpc("get_bookable_caregivers" as never, { _day_of_week: dayOfWeek } as never);
  if (error) throw error;
  return ((data as unknown as BookableCaregiver[]) ?? []).map((r) => ({
    ...r,
    care_type_codes: r.care_type_codes ?? [],
    avg_rating: num(r.avg_rating),
    rating_count: Number(r.rating_count ?? 0),
    day_windows: r.day_windows ?? [],
  }));
}
