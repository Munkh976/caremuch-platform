import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TemplateField } from "@/lib/formTemplates";
import type { GoalRow, MeasureKind, Onboarding, PlanRow, ShellRow } from "@/lib/carePlan";

/**
 * Reads for the client care-plan screens. Manager-tier tables are read through their SELECT policies
 * (clinical tier: care_plans + children, client_documents; authorization tier: service_authorizations,
 * office_service_types; all staff: form templates, measure types); the rest through the read RPCs.
 * Every key starts with ["cp", clientId] so one invalidation refreshes the page after a write.
 */
export const cpKey = (clientId: string, ...rest: unknown[]) => ["cp", clientId, ...rest];
export function useRefreshClient(clientId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["cp", clientId] });
}

export interface ClientHead { id: string; first_name: string | null; last_name: string | null; virtual_office_id: string | null; case_number: string | null }
export function useClientHead(clientId: string) {
  return useQuery({
    queryKey: cpKey(clientId, "client"),
    queryFn: async (): Promise<ClientHead | null> => {
      const { data, error } = await supabase.from("clients").select("id, first_name, last_name, virtual_office_id, case_number").eq("id", clientId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useOnboarding(clientId: string, enabled = true) {
  return useQuery({
    queryKey: cpKey(clientId, "onboarding"),
    enabled,
    retry: false,
    queryFn: async (): Promise<Onboarding> => {
      const { data, error } = await supabase.rpc("get_client_onboarding_status", { _client_id: clientId });
      if (error) throw error;
      return data as unknown as Onboarding;
    },
  });
}

export interface PlanRowFull {
  id: string; version: number; training_version: number; status: "active" | "superseded" | "expired"; plan_type: "initial" | "annual" | "addendum";
  meeting_date: string | null; effective_date: string | null; expiration_date: string | null; next_review_date: string | null; review_frequency: string | null;
  michicans_date: string | null; facilitator_name: string | null; recorder_name: string | null; discharge_criteria: string | null; signed_by: string | null;
  signed_date: string | null; template_id: string | null; template_version: number | null; field_snapshot: { fields?: TemplateField[] } | null;
  field_values: Record<string, unknown>; created_at: string;
}
export function usePlans(clientId: string) {
  return useQuery({
    queryKey: cpKey(clientId, "plans"),
    queryFn: async (): Promise<PlanRowFull[]> => {
      const { data, error } = await supabase.from("care_plans").select("id, version, training_version, status, plan_type, meeting_date, effective_date, expiration_date, next_review_date, review_frequency, michicans_date, facilitator_name, recorder_name, discharge_criteria, signed_by, signed_date, template_id, template_version, field_snapshot, field_values, created_at")
        .eq("client_id", clientId).order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PlanRowFull[];
    },
  });
}

/** Form shells with their current published version (all-staff read tier). */
export function useShells() {
  return useQuery({
    queryKey: ["cp-shells"],
    queryFn: async (): Promise<ShellRow[]> => {
      const { data, error } = await supabase.from("form_templates")
        .select("id, name, kind, virtual_office_id, intake_doc_type, is_active, created_at, form_template_versions(id, version, is_current)");
      if (error) throw error;
      return (data ?? []).map((t) => {
        const cur = (t.form_template_versions ?? []).find((v) => v.is_current);
        return { id: t.id, name: t.name, kind: t.kind, virtual_office_id: t.virtual_office_id, intake_doc_type: t.intake_doc_type, is_active: t.is_active,
          created_at: t.created_at, current_version_id: cur?.id ?? null, current_version: cur?.version ?? null };
      });
    },
  });
}

export interface AuthorizationRow {
  id: string; auth_number: string; service_type: string; service_code: string | null; modifier: string | null; effective_date: string; expiration_date: string;
  unit_minutes: number; units_authorized: number; units_used_before_caremuch: number; units_charged: number; units_used: number; units_available: number;
  units_pending: number; units_left: number; period_type: "per_week" | "per_auth" | "per_quarter" | "per_month" | "per_day" | null; units_per_period: number | null;
  period_left: number | null; reviewed_from: string | null; reviewed_to: string | null; status: "active" | "expired" | "future"; void_available: boolean;
}
export function useAuthorizations(clientId: string) {
  return useQuery({
    queryKey: cpKey(clientId, "authorizations"),
    queryFn: async (): Promise<{ as_of: string; authorizations: AuthorizationRow[] }> => {
      const { data, error } = await supabase.rpc("get_client_authorizations", { _client_id: clientId });
      if (error) throw error;
      return data as unknown as { as_of: string; authorizations: AuthorizationRow[] };
    },
  });
}

/** Service types the client's office provides (authorization tier). */
export function useOfficeServices(officeId: string | null | undefined) {
  return useQuery({
    queryKey: ["cp-office-services", officeId],
    enabled: !!officeId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from("office_service_types").select("service_type").eq("virtual_office_id", officeId as string).eq("is_active", true);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.service_type))].sort();
    },
  });
}

type RowTable = "care_plan_attendees" | "care_plan_needs" | "care_plan_treatment_needs" | "care_plan_dsm_recommendations" | "care_plan_natural_supports"
  | "care_plan_external_services" | "care_plan_reviews";
export function usePlanRows(clientId: string, planId: string | null, table: string) {
  return useQuery({
    queryKey: cpKey(clientId, "rows", planId, table),
    enabled: !!planId,
    queryFn: async (): Promise<PlanRow[]> => {
      const { data, error } = await supabase.from(table as RowTable).select("*").eq("care_plan_id", planId as string);
      if (error) throw error;
      return ((data ?? []) as PlanRow[]).map(({ care_plan_id: _p, ...r }) => r);
    },
  });
}

export interface DocumentRow { id: string; doc_type: string; version: number; status: string; not_applicable_reason: string | null; effective_date: string | null;
  expiration_date: string | null; created_at: string }
export function useDocuments(clientId: string) {
  return useQuery({
    queryKey: cpKey(clientId, "documents"),
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase.from("client_documents").select("id, doc_type, version, status, not_applicable_reason, effective_date, expiration_date, created_at")
        .eq("client_id", clientId).eq("is_current", true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface MeasureRow { id: string; objective_id: string; measure_type_id: string; seq: number; prompt_text: string; options: string[] | null; trial_count: number | null; is_active: boolean }
export interface GoalTree { goals: (GoalRow & { id: string })[]; measures: MeasureRow[] }
export function useGoals(clientId: string, planId: string | null) {
  return useQuery({
    queryKey: cpKey(clientId, "goals", planId),
    enabled: !!planId,
    queryFn: async (): Promise<GoalTree> => {
      const g = await supabase.from("care_plan_goals").select("id, seq, goal_text, target_start, target_end, care_plan_objectives(id, letter, seq, objective_text, staff_instructions, service_type, responsible_party, target_start, target_end)")
        .eq("care_plan_id", planId as string).order("seq");
      if (g.error) throw g.error;
      const goals = (g.data ?? []).map(({ care_plan_objectives, ...goal }) => ({ ...goal, objectives: [...(care_plan_objectives ?? [])].sort((a, b) => a.seq - b.seq) }));
      const objIds = goals.flatMap((x) => x.objectives.map((o) => o.id));
      let measures: MeasureRow[] = [];
      if (objIds.length) {
        const m = await supabase.from("objective_measures").select("id, objective_id, measure_type_id, seq, prompt_text, options, trial_count, is_active").in("objective_id", objIds).order("seq");
        if (m.error) throw m.error;
        measures = (m.data ?? []).map((r) => ({ ...r, options: Array.isArray(r.options) ? (r.options as string[]) : null }));
      }
      return { goals: goals as GoalTree["goals"], measures };
    },
  });
}

export interface MeasureTypeRow { id: string; kind: MeasureKind; label: string; default_options: string[] | null; is_active: boolean }
export function useMeasureTypes() {
  return useQuery({
    queryKey: ["measure-types-active"],
    queryFn: async (): Promise<MeasureTypeRow[]> => {
      const { data, error } = await supabase.from("measure_types").select("id, kind, label, default_options, is_active").order("label");
      if (error) throw error;
      return (data ?? []).map((t) => ({ ...t, default_options: Array.isArray(t.default_options) ? (t.default_options as string[]) : null }));
    },
  });
}

/** Has an in-service or training form been recorded at this plan version (training tier read)? */
export function useTrainedAt(clientId: string, planId: string | null, trainingVersion: number | null) {
  return useQuery({
    queryKey: cpKey(clientId, "trained", planId, trainingVersion),
    enabled: !!planId && !!trainingVersion,
    queryFn: async () => {
      const [a, b] = await Promise.all([
        supabase.from("plan_inservice_forms").select("id", { count: "exact", head: true }).eq("care_plan_id", planId as string).eq("training_version", trainingVersion as number),
        supabase.from("plan_training_forms").select("id", { count: "exact", head: true }).eq("care_plan_id", planId as string).eq("training_version", trainingVersion as number),
      ]);
      return (a.count ?? 0) + (b.count ?? 0) > 0;
    },
  });
}
