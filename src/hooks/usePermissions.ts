import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Permission {
  module_code: string;
  module_name: string;
  category: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
  route?: string;
}

export const usePermissions = () => {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPermissions();
  }, []);

  const fetchPermissions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      // Get user's role
      const { data: roleData } = await supabase.rpc("get_user_role", {
        _user_id: user.id,
      });

      setUserRole(roleData);

      // Get permissions for this role
      const { data: permissionsData, error } = await supabase
        .from("role_permissions")
        .select(`
          module_code,
          can_create,
          can_read,
          can_update,
          can_delete,
          system_modules!inner(
            module_name,
            category,
            is_active
          )
        `)
        .eq("role_code", roleData)
        .eq("system_modules.is_active", true);

      if (error) throw error;

      // Map module codes to routes
      const moduleRouteMap: Record<string, string> = {
        users: "/users",
        user_roles: "/user-roles",
        system_roles: "/system-roles",
        role_permissions: "/role-permissions",
        admin_utilities: "/admin-utilities",
        notifications_outbox: "/notifications-outbox",
        settings: "/agency-settings",
        schedule: "/schedule",
        caregivers: "/caregivers",
        clients: "/clients",
        client_inquiries: "/client-inquiries",
        shifts: "/schedule",
        orders: "/order-management",
        availability: "/time-off",
        time_off: "/time-off",
        shift_trades: "/shift-trades",
        care_types: "/care-types",
        care_service_categories: "/care-service-categories",
        conversation_builder: "/flow-builder",
        care_needs: "/care-needs",
        agency: "/agency-settings",
        agency_settings: "/agency-settings",
        virtual_offices: "/virtual-offices",
        knowledge_base: "/knowledge-base",
        auto_schedule: "/schedule?tab=unassigned",
        available_shifts: "/available-shifts",
        caregiver_approvals: "/caregiver-approvals",
        caregiver_registration: "/caregiver-registration",
        live_operations: "/schedule?tab=today",
        quick_assign: "/schedule?tab=unassigned",
        reports: "/reports",
        caregiver_dashboard: "/caregiver-dashboard",
        caregiver_time_off: "/caregiver-time-off",
        caregiver_settings: "/caregiver-settings",
        client_dashboard: "/client-dashboard",
      };

      const formattedPermissions: Permission[] = (permissionsData || []).map((p: any) => ({
        module_code: p.module_code,
        module_name: p.system_modules.module_name,
        category: p.system_modules.category,
        can_create: p.can_create,
        can_read: p.can_read,
        can_update: p.can_update,
        can_delete: p.can_delete,
        route: moduleRouteMap[p.module_code],
      }));

      setPermissions(formattedPermissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (moduleCode: string, permissionType: "create" | "read" | "update" | "delete"): boolean => {
    const permission = permissions.find(p => p.module_code === moduleCode);
    if (!permission) return false;

    switch (permissionType) {
      case "create":
        return permission.can_create;
      case "read":
        return permission.can_read;
      case "update":
        return permission.can_update;
      case "delete":
        return permission.can_delete;
      default:
        return false;
    }
  };

  const getModulesByCategory = (category: string) => {
    return permissions.filter(p => p.category === category && p.can_read);
  };

  return {
    permissions,
    userRole,
    loading,
    hasPermission,
    getModulesByCategory,
  };
};
