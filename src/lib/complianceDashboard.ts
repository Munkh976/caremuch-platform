/**
 * Dashboard "Care plan compliance" section (Ripple S11): pure helpers that turn the existing reads into panel rows.
 * Names, counts and reasons only (no clinical text). Every row carries the link to the record / tab where it is fixed.
 */
import { ONBOARDING_LABEL, onboardedCount, type Onboarding } from "./carePlan";

export const TOP = 5;

// 1. Clients pending onboarding (list_clients_onboarding + client names)
export interface PendingClient { client_id: string; name: string; done: number; missing: string[]; href: string }
export function pendingOnboarding(rows: Onboarding[], names: Map<string, string>): PendingClient[] {
  return rows.filter((o) => !o.onboarded && names.has(o.client_id)).map((o) => ({
    client_id: o.client_id, name: names.get(o.client_id) as string, done: onboardedCount(o),
    missing: o.items.filter((i) => i.status === "missing" || i.status === "expired").map((i) => ONBOARDING_LABEL[i.key]?.label ?? i.key),
    href: `/care-plans/${o.client_id}?tab=onboarding`,
  })).sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));
}

// 2. Expiring credentials (list_credential_expirations, 60 days): ★ overdue, red <= 30, yellow <= 60, required missing
export type CredBand = "overdue" | "red" | "yellow" | "missing";
export interface CredRow { caregiver_id: string; caregiver_name: string; credential_type_id: string; credential_type: string; expiry_date: string | null; days: number | null; band: CredBand }
const BAND_ORDER: Record<CredBand, number> = { overdue: 0, red: 1, yellow: 2, missing: 3 };
export function credentialRows(rows: CredRow[]) {
  const sorted = [...rows].sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || (a.days ?? 0) - (b.days ?? 0) || a.caregiver_name.localeCompare(b.caregiver_name));
  const counts = { overdue: 0, red: 0, yellow: 0, missing: 0 } as Record<CredBand, number>;
  for (const r of rows) counts[r.band] += 1;
  return { rows: sorted.map((r) => ({ ...r, href: `/caregivers?caregiver=${r.caregiver_id}&tab=credentials` })), counts };
}

// 4. Caregivers needing retraining (list_caregivers_needing_retraining): one row per caregiver x client with the next shift
export interface RetrainShiftRow { shift_id: string; shift_date: string; caregiver_id: string; client_id: string; training_version: number }
export interface RetrainRow { caregiver_id: string; caregiver_name: string; client_id: string; client_name: string; next_shift: string; shifts: number; training_version: number; href: string }
export function retrainingRows(rows: RetrainShiftRow[], caregivers: Map<string, string>, clients: Map<string, string>): RetrainRow[] {
  const by = new Map<string, RetrainRow>();
  for (const r of [...rows].sort((a, b) => a.shift_date.localeCompare(b.shift_date))) {
    const k = `${r.caregiver_id}|${r.client_id}`; const cur = by.get(k);
    if (cur) { cur.shifts += 1; continue; }
    by.set(k, { caregiver_id: r.caregiver_id, caregiver_name: caregivers.get(r.caregiver_id) ?? "Caregiver", client_id: r.client_id, client_name: clients.get(r.client_id) ?? "Client",
      next_shift: r.shift_date, shifts: 1, training_version: r.training_version, href: `/training/${r.client_id}` });
  }
  return [...by.values()];
}
export const distinctCaregivers = (rows: RetrainRow[]) => new Set(rows.map((r) => r.caregiver_id)).size;

// 7. Enforcement readiness (get_enforcement_readiness)
export interface Readiness {
  office_id: string; module_enabled: boolean; enforcement: boolean; from: string; to: string; days: number; shifts_checked: number; would_block: number;
  by_reason: Record<string, number>;
  shifts: { shift_id: string; shift_date: string; start_time: string; client_id: string; client_first_name: string | null; client_last_initial: string | null; caregiver_id: string | null; caregiver_name: string | null; codes: string[] }[];
}
export const REASON_LABEL: Record<string, string> = {
  training_missing: "Not trained on the current plan",
  credential_missing: "Required credential missing",
  authorization_missing: "No authorization",
  authorization_expired: "No authorization on that date",
  units_short: "Not enough authorized units",
  units_short_period: "Over the weekly cap",
};
export const reasonList = (r: Readiness) => Object.entries(r.by_reason).map(([code, n]) => ({ code, label: REASON_LABEL[code] ?? code, n: Number(n) }))
  .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
