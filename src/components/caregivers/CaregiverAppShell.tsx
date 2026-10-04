import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, CalendarDays, Briefcase, User } from "lucide-react";

interface CaregiverAppShellProps {
  children: ReactNode;
}

interface TabDef {
  label: string;
  path: string;
  icon: typeof Home;
}

/**
 * Mobile-first shell for the caregiver role ONLY -- a bottom tab bar, not the manager
 * AppLayout sidebar. A caregiver's world is "my" four things (Today / Schedule / Shifts /
 * Profile), not a module list, so this deliberately doesn't reuse AppLayout's
 * permissions-driven menu. AppLayout itself is untouched; managers/admins never mount this
 * component. See docs/caregiver-app-design.md §3.1.
 *
 * Time Off has no top-level tab on purpose -- it lives inside Profile (a secondary,
 * occasional action, not a daily-use surface). Schedule/Shifts/Profile route to their
 * existing pages, which still render inside AppLayout until Phases B/C/D reskin them --
 * that's an expected transitional state, not a bug.
 */
const TABS: TabDef[] = [
  { label: "Today", path: "/caregiver-dashboard", icon: Home },
  { label: "Schedule", path: "/caregiver-schedule", icon: CalendarDays },
  { label: "Shifts", path: "/available-shifts", icon: Briefcase },
  { label: "Profile", path: "/caregiver-settings", icon: User },
];

export const CaregiverAppShell = ({ children }: CaregiverAppShellProps) => {
  const location = useLocation();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const isActive = location.pathname === tab.path;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              // Big, thumb-reachable target: full-height row, generous vertical padding --
              // not a compact desktop icon button.
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-semibold transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
