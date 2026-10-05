import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";

/**
 * Route guard for the Ripple care-plan module screens (Q3): renders only when the user can see at
 * least one office with `care_plan_module_enabled`. Used INSIDE RequireRole, which has already
 * checked the role. Anyone else (e.g. a manager of an office without the module) goes to the
 * dashboard with a generic message. UX only: RLS and the RPC checks remain the enforcement.
 */
export function RequireModuleOffice({ children }: { children: ReactNode }) {
  const { hasModuleOffice, loading, isError } = useComplianceOffices();
  const denied = !loading && (isError || !hasModuleOffice);
  useEffect(() => {
    if (denied) toast.error("You don't have access to that page");
  }, [denied]);
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }
  if (denied) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
