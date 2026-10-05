import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CaregiverClock, NoteDueItem } from "@/lib/caregiverNotes";

/** Signed-in user id, kept in sync with auth changes (undefined until the session is known). */
export function useSessionUserId(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setUserId(data.session?.user.id ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUserId(session?.user.id ?? null));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);
  return userId;
}

export interface CaregiverRecord { id: string; first_name: string | null; virtual_office_id: string | null }

/**
 * The caller's linked caregiver record: an active caregivers row with user_id = auth.uid() in the
 * user's own agency (owner decision, Oct 5: a record test, not a role ranking, so a dual-role user
 * reaches both the staff UI and the caregiver app). null = none.
 */
export function useCaregiverRecord(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["caregiver-record", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CaregiverRecord | null> => {
      const { data: profile } = await supabase.from("profiles").select("agency_id").eq("id", userId as string).maybeSingle();
      if (!profile?.agency_id) return null;
      const { data } = await supabase.from("caregivers").select("id, first_name, virtual_office_id, is_active")
        .eq("user_id", userId as string).eq("agency_id", profile.agency_id).limit(1);
      const row = (data ?? [])[0];
      return row && row.is_active !== false ? { id: row.id, first_name: row.first_name, virtual_office_id: row.virtual_office_id } : null;
    },
  });
}

/** The caregiver's day from the database clock (office time zone, office week start). */
export function useCaregiverClock() {
  return useQuery({
    queryKey: ["caregiver-clock"],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CaregiverClock> => {
      const { data, error } = await supabase.rpc("get_caregiver_clock");
      if (error) throw error;
      return data as unknown as CaregiverClock;
    },
  });
}

/** The caller's own progress-note work (list_my_notes_due): open items and recent history. */
export function useNotesDue() {
  return useQuery({
    queryKey: ["caregiver-notes-due"],
    queryFn: async (): Promise<NoteDueItem[]> => {
      const { data, error } = await supabase.rpc("list_my_notes_due");
      if (error) throw error;
      return (data as unknown as NoteDueItem[]) ?? [];
    },
  });
}
