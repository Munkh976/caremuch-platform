import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface MenuBadgeCounts {
  clientInquiries: number;
  carePlan: number;
  timeOff: number;
  shiftTrades: number;
  notificationOutbox: number;
}

const EMPTY: MenuBadgeCounts = {
  clientInquiries: 0,
  carePlan: 0,
  timeOff: 0,
  shiftTrades: 0,
  notificationOutbox: 0,
};

/**
 * "Needs attention" counts for the sidebar's action-queue menu items. Reuses the
 * exact mechanism usePendingApprovals.ts already established for the Caregiver
 * Applications badge: one { count: "exact", head: true } query per badge (no rows
 * returned), fired once on mount, no polling.
 */
export const useMenuBadgeCounts = () => {
  const [counts, setCounts] = useState<MenuBadgeCounts>(EMPTY);

  useEffect(() => {
    (async () => {
      const [inquiriesRes, carePlanRes, timeOffRes, shiftTradesRes] = await Promise.all([
        supabase.from("care_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("client_orders").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("time_off_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("shift_trades").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);

      // pending_notifications' own RLS is role-only, NOT agency-scoped (see
      // known-issues.md -- cross-referenced with the M1 tracking in the multi-tenant
      // plan). An explicit agency_id filter is added HERE, at the query level,
      // specifically because the table's RLS cannot be relied on for this one the
      // way it can for the other four. This corrects the BADGE NUMBER only -- it
      // does not close the underlying RLS gap on the Notification Outbox page
      // itself, which is separate, deferred M1 work, not in scope for this batch.
      let notificationOutbox = 0;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from("profiles").select("agency_id").eq("id", user.id).single();
        if (profile?.agency_id) {
          const { count } = await supabase
            .from("pending_notifications")
            .select("id", { count: "exact", head: true })
            .is("sent_at", null)
            .eq("agency_id", profile.agency_id);
          notificationOutbox = count ?? 0;
        }
      }

      setCounts({
        clientInquiries: inquiriesRes.count ?? 0,
        carePlan: carePlanRes.count ?? 0,
        timeOff: timeOffRes.count ?? 0,
        shiftTrades: shiftTradesRes.count ?? 0,
        notificationOutbox,
      });
    })();
  }, []);

  return counts;
};
