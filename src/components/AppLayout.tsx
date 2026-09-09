import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Calendar,
  Users,
  UserCog,
  Clock,
  Radio,
  Repeat,
  ClipboardList,
  UserPlus,
  UserCheck,
  LogOut,
  Menu,
  X,
  Tag,
  List,
  FileText,
  Settings,
  Shield,
  Building2,
  Inbox,
  Network,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useMenuBadgeCounts } from "@/hooks/useMenuBadgeCounts";

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { permissions, userRole, loading } = usePermissions();
  const { pendingCount } = usePendingApprovals();
  const menuBadgeCounts = useMenuBadgeCounts();

  const isSystemAdmin = userRole === "system_admin";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  const isActive = (path: string) => location.pathname === path;

  // Icon mapping for modules
  const iconMap: Record<string, any> = {
    users: UserCheck,
    user_roles: UserCog,
    system_roles: Shield,
    role_permissions: Settings,
    caregivers: Users,
    clients: UserCog,
    client_inquiries: Inbox,
    shifts: Calendar,
    orders: FileText,
    availability: Clock,
    time_off: Clock,
    shift_trades: Repeat,
    care_types: Tag,
    care_service_categories: Tag,
    care_needs: List,
    agency: Settings,
    agency_settings: Building2,
    virtual_offices: Network,
    knowledge_base: BookOpen,
    auto_schedule: Calendar,
    available_shifts: ClipboardList,
    caregiver_approvals: UserCheck,
    caregiver_registration: UserPlus,
    live_operations: Radio,
    quick_assign: UserCog,
    reports: FileText,
    caregiver_dashboard: LayoutDashboard,
    caregiver_time_off: Clock,
    caregiver_settings: Settings,
    client_dashboard: LayoutDashboard,
    notifications_outbox: FileText,
    admin_utilities: Settings,
    settings: Settings,
    schedule: Calendar,
  };

  // Build menu items from permissions.
  // System admins see the platform portal only; agency/staff roles never see it.
  // Scheduling modules were consolidated into the single Schedule workspace,
  // so they must not appear as separate sidebar entries.
  const MERGED_INTO_SCHEDULE = ["shifts", "quick_assign", "auto_schedule", "live_operations"];

  // UX polish pass (menu structure/labels only -- see AppLayout.tsx's own comments
  // for why these live here rather than as a system_modules data change): menu
  // labels and categories come from the system_modules table, which has no
  // sort_order column at all, and no label-override mechanism existed before this.
  // These two maps are a presentation-only layer -- they change what's RENDERED,
  // never what's stored. system_modules itself, role_permissions, and every route/
  // table/component are untouched.
  //
  // "orders"/"settings" module_codes keep their existing DB module_name
  // ("Order Management"/"Settings") -- only the on-screen label changes here.
  const LABEL_OVERRIDES: Record<string, string> = {
    orders: "Care Plan",
    settings: "Agency Settings",
  };

  // "virtual_offices" is category "configuration" in system_modules today --
  // rendered under Administration here per the requested move, without changing
  // the stored category value.
  const CATEGORY_OVERRIDES: Record<string, string> = {
    virtual_offices: "administration",
  };

  // Explicit within-category display order. Anything in a listed category but NOT
  // named here keeps its natural (DB-return) order, appended after the named items
  // -- this list only needs to cover items whose position was actually requested.
  const CATEGORY_ITEM_ORDER: Record<string, string[]> = {
    operations: [
      "dashboard", "client_inquiries", "clients", "caregiver_approvals", "caregivers",
      "orders", "schedule", "time_off", "shift_trades", "notifications_outbox",
    ],
    administration: ["virtual_offices", "settings", "knowledge_base"],
  };

  const readable = permissions
    .filter(p => p.route && p.can_read)
    .filter(p => (isSystemAdmin ? p.category === "platform" : p.category !== "platform"));

  const hasSchedule = readable.some(p => p.module_code === "schedule");

  // Action-queue "needs attention" badges, extending the exact mechanism the
  // caregiver_approvals badge already used (a lightweight head-count per menu,
  // fired once on mount -- see usePendingApprovals.ts / useMenuBadgeCounts.ts).
  // Deliberately NOT added to browse screens (clients, caregivers, schedule) --
  // a badge there would be clutter, not signal, per the approved batch scope.
  const BADGE_COUNTS: Record<string, number> = {
    caregiver_approvals: pendingCount,
    client_inquiries: menuBadgeCounts.clientInquiries,
    orders: menuBadgeCounts.carePlan,
    time_off: menuBadgeCounts.timeOff,
    shift_trades: menuBadgeCounts.shiftTrades,
    notifications_outbox: menuBadgeCounts.notificationOutbox,
  };

  const dynamicMenuItems = readable
    .filter(p => !(hasSchedule && MERGED_INTO_SCHEDULE.includes(p.module_code)))
    .map(p => ({
      label: p.module_code === "schedule" ? "Schedule" : (LABEL_OVERRIDES[p.module_code] ?? p.module_name),
      icon: iconMap[p.module_code] || FileText,
      path: p.route!,
      category: CATEGORY_OVERRIDES[p.module_code] ?? p.category,
      badge: BADGE_COUNTS[p.module_code] ?? 0,
      sortKey: p.module_code,
    }))
    // de-duplicate any remaining entries that resolve to the same destination
    .filter((item, i, arr) => arr.findIndex(o => o.path === item.path) === i);

  // Add dashboard as first item based on role
  const menuItems = userRole === "system_admin"
    ? [
        {
          label: "Platform Overview",
          icon: Shield,
          path: "/system-admin",
          category: "platform",
          badge: 0,
          sortKey: "platform_overview",
        },
        ...dynamicMenuItems,
      ]
    : userRole === "caregiver"
    ? dynamicMenuItems // Caregivers use their own dashboard from permissions
    : userRole === "client"
    ? dynamicMenuItems // Clients use their own dashboard from permissions
    : [
        // Folded into "operations" (was its own "dashboard" category/section) so it
        // renders as the first item inside Operations, per the requested order --
        // not as a separate section above it.
        {
          label: "Dashboard",
          icon: LayoutDashboard,
          path: "/dashboard",
          category: "operations",
          badge: 0,
          sortKey: "dashboard",
        },
        ...dynamicMenuItems,
      ];

  // Group by category
  const grouped = menuItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof menuItems>);

  // Apply the requested within-category order, where one is specified. Items not
  // named in CATEGORY_ITEM_ORDER for their category keep their existing relative
  // (DB-return) order and sort after every named item.
  for (const [category, order] of Object.entries(CATEGORY_ITEM_ORDER)) {
    const items = grouped[category];
    if (!items) continue;
    grouped[category] = [...items].sort((a, b) => {
      const ai = order.indexOf(a.sortKey);
      const bi = order.indexOf(b.sortKey);
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    });
  }

  const categoryOrder = ["platform", "dashboard", "core", "operations", "caregiver", "configuration", "administration", "analytics"];
  const groupedItems = Object.entries(grouped).sort(
    ([a], [b]) =>
      (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a)) -
      (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b))
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Mobile menu toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 md:hidden"
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
      >
        {isSidebarOpen ? <X /> : <Menu />}
      </Button>

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card transition-transform ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b p-6">
            <h1 className="text-2xl font-bold text-primary">CareMuch</h1>
            <p className="text-xs font-medium text-foreground/80 mt-1">
              {isSystemAdmin ? "System Administration" : "Agency Portal"}
            </p>
            <p className="text-sm text-muted-foreground">
              {userRole?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </p>
          </div>

          <nav className="flex-1 space-y-4 p-4 overflow-y-auto">
            {loading ? (
              <div className="text-center text-muted-foreground text-sm">Loading...</div>
            ) : (
              groupedItems.map(([category, items]) => (
                <div key={category}>
                  <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase">
                    {category}
                  </h3>
                  <div className="space-y-1">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                            isActive(item.path)
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="flex-1">{item.label}</span>
                          {item.badge > 0 && (
                            <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </nav>

          <div className="border-t p-4">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className={`flex-1 transition-all ${isSidebarOpen ? "md:ml-64" : ""}`}>
        <div className="container mx-auto p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
};
