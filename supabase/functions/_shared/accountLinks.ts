// Account creation / linking helpers for Issue 2 Mode B and the 🟠 fixes
// (docs/security-fixes-2026-10-plan.md §2.2, §8.4, §15).
//
// Mode B: no password is ever generated, stored, logged or returned. New accounts get a one-time
// Supabase *invite* link; resets get a one-time *recovery* link. Both come from
// auth.admin.generateLink, which creates the link WITHOUT sending any email, so the caller can show
// it once to the admin to hand over. The link is returned in the HTTP response only.

// The callers pin different supabase-js versions (2.7.1 / 2.38.4), so the client is typed loosely.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const LEGACY_SYSTEM_AGENCY_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The app's own origins (owner point E: redirectTo may only point at the app itself). A request's
 * Origin header is used ONLY if it is exactly one of these; otherwise no redirect_to is sent and
 * Supabase uses the project's Site URL. Supabase additionally enforces its own Auth "Redirect URLs"
 * allow-list. Keep in sync with the dashboard list in docs/security-fixes-2026-10-plan.md §15.6.
 */
export const APP_ORIGINS: readonly string[] = [
  "http://localhost:8080",                // vite dev server (vite.config.ts)
  "https://caremuch-platform.fly.dev",    // fly.toml app "caremuch-platform"
];

export function setPasswordRedirect(req: Request): string | undefined {
  const origin = req.headers.get("origin") ?? "";
  return APP_ORIGINS.includes(origin) ? `${origin}/auth/set-password` : undefined;
}

/**
 * Owner point A: every generated invite/recovery link writes an audit event — actor, target user,
 * link type, time (occurred_at). NEVER the link or any token. Inserted directly (not via
 * log_event(), which swallows errors) and FAIL-CLOSED: if the audit row can't be written, the
 * caller must not hand out the link.
 */
export async function auditLinkIssued(
  admin: SupabaseClient,
  a: { agencyId: string | null; actorId: string; targetUserId: string; linkType: "invite" | "recovery"; fn: string },
): Promise<void> {
  if (!a.agencyId) throw new Error("Cannot record the audit event (no agency for this account)");
  const { error } = await admin.from("events").insert({
    agency_id: a.agencyId,
    event_type: "account_link_issued",
    actor_type: "staff",
    actor_id: a.actorId,
    subject_type: "user",
    subject_id: a.targetUserId,
    payload: { link_type: a.linkType, function: a.fn },
  });
  if (error) throw new Error("Could not record the audit event; no link was issued");
}

/** Exact, case-insensitive email match across all auth users (paginated; no wildcard semantics). */
export async function findAuthUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u: { email?: string }) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id as string;
    if (users.length < 1000) return null;
  }
  return null;
}

/**
 * 🟠 fix — may this EXISTING auth user be linked to a record in `recordAgencyId`?
 *  - profile already in that agency           -> yes
 *  - profile with NULL / legacy agency (or none) -> only a system_admin may claim it
 *  - profile in another agency                 -> no
 * Never moves an existing account between agencies (callers must not overwrite agency_id).
 */
export async function checkExistingAccount(
  admin: SupabaseClient, userId: string, recordAgencyId: string, callerIsSystemAdmin: boolean,
): Promise<{ ok: true; profileAgencyId: string | null } | { ok: false; status: number; error: string }> {
  const { data: profile } = await admin.from("profiles").select("agency_id").eq("id", userId).maybeSingle();
  const pa: string | null = profile?.agency_id ?? null;
  if (pa === recordAgencyId) return { ok: true, profileAgencyId: pa };
  if (!pa || pa === LEGACY_SYSTEM_AGENCY_ID) {
    return callerIsSystemAdmin
      ? { ok: true, profileAgencyId: pa }
      : { ok: false, status: 409, error: "An account with this email exists but has no agency. Ask a system administrator to link it." };
  }
  return { ok: false, status: 409, error: "An account with this email is already linked to another agency" };
}

/**
 * Create the auth user via a one-time INVITE link (no password) and record the audit event.
 * If the audit row can't be written, the just-created account is deleted again and nothing is
 * returned (fail-closed). Returns the new id and the link.
 */
export async function inviteNewUser(
  admin: SupabaseClient,
  args: { email: string; fullName: string; agencyId: string; redirectTo?: string; actorId: string; fn: string },
): Promise<{ userId: string; link: string }> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: args.email,
    options: { data: { full_name: args.fullName, agency_id: args.agencyId }, redirectTo: args.redirectTo },
  });
  if (error || !data?.user?.id || !data?.properties?.action_link) throw new Error(error?.message ?? "Could not create the invite link");
  const userId = data.user.id as string;
  try {
    await auditLinkIssued(admin, { agencyId: args.agencyId, actorId: args.actorId, targetUserId: userId, linkType: "invite", fn: args.fn });
  } catch (e) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw e;
  }
  return { userId, link: data.properties.action_link as string };
}

/**
 * One-time RECOVERY (set a new password) link for an existing user, plus its audit event.
 * Sends no email. If the audit row can't be written, the link is discarded (fail-closed).
 */
export async function recoveryLink(
  admin: SupabaseClient,
  args: { email: string; redirectTo?: string; agencyId: string | null; actorId: string; targetUserId: string; fn: string },
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: args.email, options: { redirectTo: args.redirectTo } });
  if (error || !data?.properties?.action_link) throw new Error(error?.message ?? "Could not create the reset link");
  await auditLinkIssued(admin, { agencyId: args.agencyId, actorId: args.actorId, targetUserId: args.targetUserId, linkType: "recovery", fn: args.fn });
  return data.properties.action_link as string;
}

/** Audit-only outbox text: never contains a password or a link. */
export const linkHandedOverNote = (firstName: string, kind: "invite" | "existing") =>
  kind === "invite"
    ? `Hi ${firstName}, an account was created for you. Your office has given you a one-time link to set your password. (The link is not stored here.)`
    : `Hi ${firstName}, your existing CareMuch login is now connected. Sign in with your current password, or use "Forgot password?".`;
