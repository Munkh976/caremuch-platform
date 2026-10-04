import { supabase } from "@/integrations/supabase/client";

/**
 * Issue 2 Mode B (security plan §15): staff never type a password for someone else. A reset
 * generates a one-time recovery link (admin-reset-password), which the UI shows once in
 * OneTimeLinkDialog. By default the user's current password is invalidated at the same time.
 */
/** Response shape of enable-client-login / enable-caregiver-login / approve-caregiver-registration. */
export interface AccountLinkResponse { setPasswordLink?: string | null; existingAccount?: boolean; email?: string; error?: string }

export async function requestResetLink(userId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("admin-reset-password", { body: { userId } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  const link = (data as { resetLink?: string })?.resetLink;
  if (!link) throw new Error("No reset link was returned");
  return link;
}
