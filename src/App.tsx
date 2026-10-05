import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Schedule from "./pages/Schedule";
import Caregivers from "./pages/Caregivers";
import Clients from "./pages/Clients";
import TimeOffRequests from "./pages/TimeOffRequests";
import ShiftTrades from "./pages/ShiftTrades";
import CaregiverDashboard from "./pages/CaregiverDashboard";
import ClientDashboard from "./pages/ClientDashboard";
import CaregiverRegistration from "./pages/CaregiverRegistration";
import Assistant from "./pages/Assistant";
import FlowBuilder from "./pages/FlowBuilder";
import CaregiverApprovals from "./pages/CaregiverApprovals";
import Users from "./pages/Users";
import AddUser from "./pages/AddUser";
import EditUser from "./pages/EditUser";
import UserRoles from "./pages/UserRoles";
import SystemRoles from "./pages/SystemRoles";
import RolePermissions from "./pages/RolePermissions";
import SystemAdminDashboard from "./pages/SystemAdminDashboard";
import AdminUtilities from "./pages/AdminUtilities";
import AgencySettings from "./pages/AgencySettings";
import VirtualOffices from "./pages/VirtualOffices";
import VirtualOfficeConfig from "./pages/VirtualOfficeConfig";
import CareTypes from "./pages/CareTypes";
import OrderManagement from "./pages/OrderManagement";
import NotFound from "./pages/NotFound";
import AvailableShifts from "./pages/AvailableShifts";
import CaregiverTimeOff from "./pages/CaregiverTimeOff";
import CaregiverSettings from "./pages/CaregiverSettings";
import Reports from "./pages/Reports";
import AdminUserManagement from "./pages/AdminUserManagement";
import OAuthConsent from "./pages/OAuthConsent";
import NotificationsOutbox from "./pages/NotificationsOutbox";
import ClientInquiries from "./pages/ClientInquiries";
import PublicOffice from "./pages/PublicOffice";
import KnowledgeBase from "./pages/KnowledgeBase";
import CarePlans from "./pages/ripple/CarePlans";
import ClientCarePlan from "./pages/ripple/ClientCarePlan";
import WeeklyBilling from "./pages/ripple/WeeklyBilling";
import FormTemplates from "./pages/ripple/FormTemplates";
import { RequireRole } from "./components/auth/RequireRole";
import { RequireModuleOffice } from "./components/auth/RequireModuleOffice";
import { AuthLinkRouter } from "./components/auth/AuthLinkRouter";
import ForgotPassword from "./pages/ForgotPassword";
import SetPassword from "./pages/SetPassword";
import { ADMIN, CARE_PLAN_TIER, MANAGER_OR_ABOVE, STAFF, SYSTEM_ADMIN } from "./lib/roleHome";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthLinkRouter />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          {/* PUBLIC by design (CLAUDE.md rule 15 exception): password reset / one-time-link landing pages */}
          <Route path="/auth/forgot" element={<ForgotPassword />} />
          <Route path="/auth/set-password" element={<SetPassword />} />
          <Route path="/a/:slug" element={<PublicOffice />} />
          <Route path="/a/:slug/apply" element={<PublicOffice initialMode="apply" />} />
          <Route path="/a/:slug/care" element={<PublicOffice initialMode="care" />} />
          <Route path="/dashboard" element={<RequireRole allow={STAFF}><Dashboard /></RequireRole>} />
          <Route path="/schedule" element={<RequireRole allow={STAFF}><Schedule /></RequireRole>} />
          <Route path="/caregivers" element={<RequireRole allow={STAFF}><Caregivers /></RequireRole>} />
          <Route path="/clients" element={<RequireRole allow={STAFF}><Clients /></RequireRole>} />
          <Route path="/client-inquiries" element={<RequireRole allow={STAFF}><ClientInquiries /></RequireRole>} />
          <Route path="/time-off" element={<RequireRole allow={STAFF}><TimeOffRequests /></RequireRole>} />
          <Route path="/live-operations" element={<Navigate to="/schedule?tab=today" replace />} />
          <Route path="/quick-assign" element={<Navigate to="/schedule?tab=unassigned" replace />} />
          <Route path="/shift-trades" element={<RequireRole allow={STAFF}><ShiftTrades /></RequireRole>} />
          <Route path="/caregiver-registration" element={<CaregiverRegistration />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/flow-builder" element={<RequireRole allow={STAFF}><FlowBuilder /></RequireRole>} />
          <Route path="/caregiver-approvals" element={<RequireRole allow={STAFF}><CaregiverApprovals /></RequireRole>} />
          <Route path="/notifications-outbox" element={<RequireRole allow={STAFF}><NotificationsOutbox /></RequireRole>} />
          <Route path="/caregiver-dashboard" element={<CaregiverDashboard />} />
          <Route path="/client-dashboard" element={<ClientDashboard />} />
          <Route path="/users" element={<RequireRole allow={ADMIN}><Users /></RequireRole>} />
          <Route path="/users/add" element={<RequireRole allow={ADMIN}><AddUser /></RequireRole>} />
          <Route path="/users/edit/:id" element={<RequireRole allow={ADMIN}><EditUser /></RequireRole>} />
          <Route path="/user-roles" element={<RequireRole allow={ADMIN}><UserRoles /></RequireRole>} />
          <Route path="/system-roles" element={<RequireRole allow={SYSTEM_ADMIN}><SystemRoles /></RequireRole>} />
          <Route path="/role-permissions" element={<RequireRole allow={SYSTEM_ADMIN}><RolePermissions /></RequireRole>} />
          <Route path="/system-admin-dashboard" element={<RequireRole allow={SYSTEM_ADMIN}><SystemAdminDashboard /></RequireRole>} />
          <Route path="/system-admin" element={<RequireRole allow={SYSTEM_ADMIN}><SystemAdminDashboard /></RequireRole>} />
          <Route path="/care-types" element={<RequireRole allow={STAFF}><CareTypes /></RequireRole>} />
          <Route path="/care-service-categories" element={<RequireRole allow={STAFF}><CareTypes openCategoriesOnLoad /></RequireRole>} />
          <Route path="/order-management" element={<RequireRole allow={STAFF}><OrderManagement /></RequireRole>} />
          <Route path="/available-shifts" element={<AvailableShifts />} />
          <Route path="/caregiver-time-off" element={<CaregiverTimeOff />} />
          <Route path="/caregiver-settings" element={<CaregiverSettings />} />
          <Route path="/admin-utilities" element={<RequireRole allow={SYSTEM_ADMIN}><AdminUtilities /></RequireRole>} />
          <Route path="/agency-settings" element={<RequireRole allow={ADMIN}><AgencySettings /></RequireRole>} />
          <Route path="/virtual-offices" element={<RequireRole allow={STAFF}><VirtualOffices /></RequireRole>} />
          <Route path="/knowledge-base" element={<RequireRole allow={STAFF}><KnowledgeBase /></RequireRole>} />
          <Route path="/virtual-offices/:id" element={<RequireRole allow={STAFF}><VirtualOfficeConfig /></RequireRole>} />
          <Route path="/auto-schedule" element={<Navigate to="/schedule?tab=unassigned" replace />} />
          <Route path="/reports" element={<RequireRole allow={STAFF}><Reports /></RequireRole>} />
          <Route path="/admin-user-management" element={<RequireRole allow={MANAGER_OR_ABOVE}><AdminUserManagement /></RequireRole>} />
          {/* Ripple care-plan module (UI S1): clinical tier + an office with the module on (Q3) */}
          <Route path="/care-plans" element={<RequireRole allow={CARE_PLAN_TIER}><RequireModuleOffice><CarePlans /></RequireModuleOffice></RequireRole>} />
          <Route path="/care-plans/:clientId" element={<RequireRole allow={CARE_PLAN_TIER}><RequireModuleOffice><ClientCarePlan /></RequireModuleOffice></RequireRole>} />
          <Route path="/billing/weekly" element={<RequireRole allow={CARE_PLAN_TIER}><RequireModuleOffice><WeeklyBilling /></RequireModuleOffice></RequireRole>} />
          <Route path="/form-templates" element={<RequireRole allow={CARE_PLAN_TIER}><RequireModuleOffice><FormTemplates /></RequireModuleOffice></RequireRole>} />
          <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
