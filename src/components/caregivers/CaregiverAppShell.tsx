import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Briefcase, CalendarDays, ClipboardList, Home, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile-first shell for the caregiver app: a bottom tab bar instead of the staff AppLayout sidebar.
 * Salvaged from archive/caregiver-app-shell-2026-10 (9a83e24) for Ripple S7, plus the Notes tab.
 * Every route that mounts it is behind RequireCaregiverRecord. AppLayout is unchanged; staff pages never
 * mount this. Time Off lives under Profile.
 *
 * `hideNav` lets a page with its own sticky footer (the progress note) give the space back while the
 * on-screen keyboard is open; `bottomPad` reserves room for that footer above the nav.
 */
export const CAREGIVER_TABS = [
  { label: "Today", path: "/caregiver-dashboard", icon: Home },
  { label: "Schedule", path: "/caregiver-schedule", icon: CalendarDays },
  { label: "Notes", path: "/caregiver/notes", icon: ClipboardList },
  { label: "Shifts", path: "/available-shifts", icon: Briefcase },
  { label: "Profile", path: "/caregiver-settings", icon: User },
] as const;

const isActive = (pathname: string, path: string) =>
  path === "/caregiver/notes" ? pathname.startsWith("/caregiver/notes") : path === "/caregiver-settings" ? pathname === path || pathname === "/caregiver-time-off" : pathname === path;

export function CaregiverAppShell({ children, hideNav = false, bottomPad = false }: { children: ReactNode; hideNav?: boolean; bottomPad?: boolean }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen w-full min-w-0 flex-col bg-background">
      <main className={cn("mx-auto w-full min-w-0 max-w-3xl flex-1 px-4 pt-5", bottomPad ? "pb-44" : "pb-24")}>{children}</main>
      {!hideNav && (
        <nav aria-label="Caregiver" data-testid="caregiver-nav" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-3xl">
            {CAREGIVER_TABS.map((t) => {
              const on = isActive(pathname, t.path); const Icon = t.icon;
              return (
                <Link key={t.path} to={t.path} aria-current={on ? "page" : undefined}
                  className={cn("flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold", on ? "text-primary" : "text-muted-foreground")}>
                  <Icon className="h-6 w-6" strokeWidth={on ? 2.5 : 2} aria-hidden="true" />
                  <span>{t.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
