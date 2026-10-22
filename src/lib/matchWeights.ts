/**
 * Per-office Smart match weights (owner decision 4b): the factors, today's defaults, and the same validity rule as the
 * database (cp_valid_match_weights: all 6 factors, whole numbers 0-100, adding up to 100).
 */
export const FACTORS = [
  { key: "skills", label: "Skills", hint: "Care services the caregiver is qualified for" },
  { key: "service_area", label: "Service area", hint: "Client's zip in the caregiver's service zips" },
  { key: "availability", label: "Availability", hint: "Declared weekly availability covers the visit" },
  { key: "reliability", label: "Reliability", hint: "Reliability score" },
  { key: "performance", label: "Performance", hint: "Ratings, completion and on-time rates" },
  { key: "continuity", label: "Continuity", hint: "Served this client in the last 60 days; preferred caregiver" },
] as const;
export type FactorKey = (typeof FACTORS)[number]["key"];
export type Weights = Record<FactorKey, number>;
export const DEFAULT_WEIGHTS: Weights = { skills: 40, service_area: 25, availability: 15, reliability: 10, performance: 10, continuity: 0 };

export function isValidWeights(w: unknown): w is Weights {
  if (!w || typeof w !== "object") return false;
  const keys = Object.keys(w).sort();
  if (keys.join(",") !== FACTORS.map((f) => f.key).sort().join(",")) return false;
  const vals = Object.values(w as Record<string, unknown>);
  return vals.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100) && vals.reduce((a: number, v) => a + (v as number), 0) === 100;
}
/** The weights in effect: the office's, else the agency's, else today's defaults (as cp_office_match_weights). */
export const effectiveWeights = (office: unknown, agency: unknown): Weights =>
  isValidWeights(office) ? office : isValidWeights(agency) ? agency : DEFAULT_WEIGHTS;
export const sumWeights = (w: Partial<Weights>) => FACTORS.reduce((a, f) => a + (Number(w[f.key]) || 0), 0);
