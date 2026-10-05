/**
 * User-facing text for a failed RPC. A refusal (42501, "Not found or not allowed", RLS) never echoes
 * ids or server detail; it gets one generic line. Validation messages (22023/23505) are written for
 * users by the server (no ids, no PHI) and are shown as they are.
 */
export function rpcErrorText(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  const msg = error.message ?? "";
  if (error.code === "42501" || /not found or not allowed|permission denied|row-level security/i.test(msg)) {
    return "You can't do that here, or the record wasn't found.";
  }
  if ((error.code === "22023" || error.code === "23505") && msg && msg.length <= 300) return msg;
  return "Something went wrong. Please try again.";
}
