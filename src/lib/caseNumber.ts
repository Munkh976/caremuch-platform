/**
 * clients.case_number (the ISK case number): nullable, trimmed, 1..32 characters — the same rule as the
 * DB CHECK clients_case_number_chk. Empty input clears it (null).
 */
export const CASE_NUMBER_MAX = 32;

export function normalizeCaseNumber(input: string | null | undefined): { value: string | null } | { error: string } {
  const v = (input ?? "").trim();
  if (v === "") return { value: null };
  if (v.length > CASE_NUMBER_MAX) return { error: `A case number is at most ${CASE_NUMBER_MAX} characters` };
  return { value: v };
}
