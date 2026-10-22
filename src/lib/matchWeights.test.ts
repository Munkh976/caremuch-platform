import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, effectiveWeights, isValidWeights, sumWeights } from "./matchWeights";

const ripple = { skills: 0, service_area: 0, availability: 30, reliability: 20, performance: 20, continuity: 30 };
describe("Smart match weights (owner 4b)", () => {
  it("accepts the 6 factors as whole numbers adding up to 100", () => {
    expect(isValidWeights(DEFAULT_WEIGHTS)).toBe(true);
    expect(isValidWeights(ripple)).toBe(true);
  });
  it("refuses a wrong sum, missing factors, decimals, negatives", () => {
    expect(isValidWeights({ ...ripple, continuity: 29 })).toBe(false);
    expect(isValidWeights({ skills: 100 })).toBe(false);
    expect(isValidWeights({ ...ripple, availability: 30.5, reliability: 19.5 })).toBe(false);
    expect(isValidWeights({ ...ripple, skills: -10, continuity: 40 })).toBe(false);
  });
  it("office, then agency, then today's defaults", () => {
    expect(effectiveWeights(ripple, null)).toEqual(ripple);
    expect(effectiveWeights(null, ripple)).toEqual(ripple);
    expect(effectiveWeights({ bad: 1 }, null)).toEqual(DEFAULT_WEIGHTS);
    expect(sumWeights(ripple)).toBe(100);
  });
});
