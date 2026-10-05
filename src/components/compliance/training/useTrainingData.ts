import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RetrainShift, TrainingContext } from "@/lib/training";

/**
 * Training-tier reads (manager, agency_admin, hr_staff): get_client_training_context carries the
 * plan spine only, never goals, needs or notes, so hr_staff screens built on it stay non-clinical.
 */
export const trKey = (clientId: string, ...rest: unknown[]) => ["tr", clientId, ...rest];
export function useRefreshTraining(clientId: string) {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["tr", clientId] }); qc.invalidateQueries({ queryKey: ["cp", clientId] }); qc.invalidateQueries({ queryKey: ["retrain"] }); };
}

export function useTrainingContext(clientId: string, enabled = true) {
  return useQuery({
    queryKey: trKey(clientId, "context"),
    enabled: enabled && !!clientId,
    retry: false,
    queryFn: async (): Promise<TrainingContext> => {
      const { data, error } = await supabase.rpc("get_client_training_context", { _client_id: clientId });
      if (error) throw error;
      return data as unknown as TrainingContext;
    },
  });
}

export function useRetraining(officeId: string | null | undefined) {
  return useQuery({
    queryKey: ["retrain", officeId],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<RetrainShift[]> => {
      const { data, error } = await supabase.rpc("list_caregivers_needing_retraining", { _office_id: officeId as string });
      if (error) throw error;
      return (data ?? []) as unknown as RetrainShift[];
    },
  });
}

export interface TrainingStatusRow { client_id: string; client_short: string; plan_version: number; training_version: number; inservice_current: boolean;
  caregivers_trained: number; needing_retraining: number; last_training_date: string | null }
export function useTrainingStatus(officeId: string | null) {
  return useQuery({
    queryKey: ["tr-status", officeId],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<TrainingStatusRow[]> => {
      const { data, error } = await supabase.rpc("list_client_training_status", { _office_id: officeId as string });
      if (error) throw error;
      return (data ?? []) as unknown as TrainingStatusRow[];
    },
  });
}
