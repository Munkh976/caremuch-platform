import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TemplateField } from "@/lib/formTemplates";

/** Fields of one version, read-only (form_template_fields: all-staff read tier). */
export function useVersionFields(versionId: string | null) {
  return useQuery({
    queryKey: ["template-fields", versionId],
    enabled: !!versionId,
    queryFn: async (): Promise<TemplateField[]> => {
      const { data, error } = await supabase
        .from("form_template_fields")
        .select("field_key, section, label, field_type, storage, writes_to_entity, writes_to_column, shown_on_progress_note, default_value, required, sort_order, options")
        .eq("template_version_id", versionId as string)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []).map((f) => ({ ...f, options: Array.isArray(f.options) ? (f.options as string[]) : null })) as TemplateField[];
    },
  });
}
