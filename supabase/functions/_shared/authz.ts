// Shared caller/target authorization for the admin Edge Functions (M-SEC-2b,
// docs/security-fixes-2026-10-plan.md §8.4/§10). All callers use the service-role client,
// which bypasses RLS — so these checks ARE the tenant/role boundary for these functions.
// The callers pin different supabase-js versions (2.7.1 / 2.38.4), so the client is typed loosely.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Higher = more privileged. scheduler and hr_staff are peers.
export const ROLE_RANK: Record<string, number> = {
  system_admin: 100,
  agency_admin: 80,
  manager: 60,
  scheduler: 40,
  hr_staff: 40,
  caregiver: 20,
  client: 10,
};

export const STAFF_ROLES = ["system_admin", "agency_admin", "manager", "scheduler", "hr_staff"] as const;

// Owner rule A: only these roles may call create-user / admin-reset-password / admin-delete-user
// (each function may narrow further). scheduler, hr_staff, caregiver, client always get 403.
export const MANAGER_OR_ABOVE = ["system_admin", "agency_admin", "manager"] as const;

// Owner rule D: one body for "unknown user", "other agency" and "not lower rank", so a caller
// cannot probe whether a user id exists or where it lives.
export const GENERIC_DENY = "You do not have permission to manage this user";

export function hasCallerRole(p: Principal | null, allowed: readonly string[]): p is Principal {
  return !!p && !!p.role && allowed.includes(p.role);
}

// Roles each caller role may grant when creating a user (owner decision, plan §8.4).
export const CREATABLE_ROLES: Record<string, string[]> = {
  system_admin: ["system_admin", "agency_admin", "manager", "scheduler", "hr_staff", "caregiver", "client"],
  agency_admin: ["agency_admin", "manager", "scheduler", "hr_staff", "caregiver", "client"],
  manager: ["scheduler", "hr_staff", "caregiver", "client"],
};

export interface Principal {
  id: string;
  role: string | null; // highest role held, from ALL user_roles rows (not get_user_role, which omits 'client')
  rank: number;
  agencyId: string | null;
}

export async function loadPrincipal(admin: SupabaseClient, userId: string): Promise<Principal | null> {
  // A malformed id must not error out differently from an unknown one (owner rule D).
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [{ data: roles }, { data: profile }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("profiles").select("agency_id").eq("id", userId).maybeSingle(),
  ]);
  // Owner rule C: a target with roles but no profile gets agencyId = null, which canActOn refuses
  // for everyone except system_admin. No profile AND no roles => unknown (null) => generic 403.
  if (!profile && (!roles || roles.length === 0)) return null;
  let role: string | null = null;
  let rank = 0;
  for (const r of roles ?? []) {
    const k = ROLE_RANK[r.role as string] ?? 0;
    if (k > rank) { rank = k; role = r.role as string; }
  }
  return { id: userId, role, rank, agencyId: profile?.agency_id ?? null };
}

/**
 * May `caller` act on `target` (reset password, delete)? Rules (plan §8.4/§10, owner A–E):
 *  - acting on yourself is refused unless `allowSelf` (specific message: it's your own id);
 *  - the target must exist, have a profile and a non-NULL agency, unless the caller is system_admin (C);
 *  - unless the caller is system_admin, the target must be in the caller's agency;
 *  - the target's highest role must rank strictly below the caller's (C) — an agency_admin never
 *    acts on a system_admin or another agency_admin, a manager never on an agency_admin, nobody
 *    on a peer;
 *  - every refusal other than "self" returns the same generic 403 (D).
 */
export function canActOn(caller: Principal, target: Principal | null, targetId: string, opts: { allowSelf?: boolean } = {}):
  { ok: true } | { ok: false; status: number; error: string } {
  const deny = { ok: false as const, status: 403, error: GENERIC_DENY };
  if (targetId === caller.id) {
    return opts.allowSelf ? { ok: true } : { ok: false, status: 403, error: "You cannot perform this action on your own account" };
  }
  if (!target) return deny;
  if (caller.role !== "system_admin") {
    if (!caller.agencyId || !target.agencyId || target.agencyId !== caller.agencyId) return deny;
  }
  if (target.rank >= caller.rank) return deny;
  return { ok: true };
}

/** Keep only allow-listed keys of a caller-supplied object. */
export function pick(obj: unknown, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of allowed) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
