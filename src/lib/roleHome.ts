/**
 * Role -> landing page, and the role sets used by RequireRole (security plan §1.2 / §14).
 * One mapping shared by Auth.tsx (post-login routing) and RequireRole (redirect on denial),
 * so both always agree. The role itself still comes from the existing get_user_role() RPC
 * (highest role a user holds) — no second mechanism.
 */
export type AppRole = "system_admin" | "agency_admin" | "manager" | "scheduler" | "hr_staff" | "caregiver" | "client";

export const STAFF: readonly AppRole[] = ["system_admin", "agency_admin", "manager", "scheduler", "hr_staff"];
export const MANAGER_OR_ABOVE: readonly AppRole[] = ["system_admin", "agency_admin", "manager"];
export const ADMIN: readonly AppRole[] = ["system_admin", "agency_admin"];
export const SYSTEM_ADMIN: readonly AppRole[] = ["system_admin"];

/** Where a signed-in user with this role belongs. `null` role = pending approval -> /auth. */
export function roleHome(role: string | null | undefined): string {
  switch (role) {
    case "caregiver": return "/caregiver-dashboard";
    case "client": return "/client-dashboard";
    case "system_admin": return "/system-admin-dashboard";
    case "agency_admin": case "manager": case "scheduler": case "hr_staff": return "/dashboard";
    default: return "/auth";
  }
}

/**
 * A `?next=` value is honoured only if it is a same-origin absolute path (security plan §14, U9):
 *  - checked as received AND after decoding (repeatedly, so "%2F%2F…" / "%252F…" can't sneak through);
 *  - must start with exactly one "/" — not "//", not "/\" (browsers treat both as protocol-relative);
 *  - no backslash and no control characters (tab/newline are stripped by browsers, so "/\t/host"
 *    would become "//host");
 *  - finally it must resolve, against this origin, to this origin (rejects "https://…",
 *    "javascript:…", and anything else that isn't a plain path).
 * The "/\host" form was a live open redirect in Auth.tsx before this check.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const forms = [raw];
  let cur = raw;
  for (let i = 0; i < 3; i++) {
    let dec: string;
    try { dec = decodeURIComponent(cur); } catch { return null; }
    if (dec === cur) break;
    forms.push(dec);
    cur = dec;
  }
  for (const f of forms) {
    if (!f.startsWith("/") || f.startsWith("//") || f.includes("\\")) return null;
    if ([...f].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  }
  try {
    const origin = window.location.origin;
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}
