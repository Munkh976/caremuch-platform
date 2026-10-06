import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Queue, StaffNote } from "@/lib/staffNotes";

/** The office's review queue (list_notes_for_review; clinical tier, office scope, DB clock). */
export function useNotesQueue(officeId: string | null) {
  return useQuery({
    queryKey: ["staff-notes", "queue", officeId],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<Queue> => {
      const { data, error } = await supabase.rpc("list_notes_for_review", { _office_id: officeId as string });
      if (error) throw error;
      return data as unknown as Queue;
    },
  });
}

/** One note for review / print (get_progress_note_for_staff). */
export function useStaffNote(noteId: string) {
  return useQuery({
    queryKey: ["staff-notes", "note", noteId],
    enabled: !!noteId,
    retry: false,
    queryFn: async (): Promise<StaffNote> => {
      const { data, error } = await supabase.rpc("get_progress_note_for_staff", { _note_id: noteId });
      if (error) throw error;
      return data as unknown as StaffNote;
    },
  });
}

export interface ReviewCount { office_id: string; to_review: number; overdue: number }
/** To-review / overdue per module office in the caller's clinical scope (menu badge, dashboard panel). */
export function useNotesReviewCounts(enabled: boolean) {
  return useQuery({
    queryKey: ["staff-notes", "counts"],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ReviewCount[]> => {
      const { data, error } = await supabase.rpc("get_notes_review_counts");
      if (error) throw error;
      return (data as unknown as ReviewCount[]) ?? [];
    },
  });
}

export function useRefreshStaffNotes() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["staff-notes"] });
}
