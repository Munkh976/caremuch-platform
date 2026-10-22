import { describe, expect, it } from "vitest";
import { leftEarly, notBilledReason, unitsToBill, unitsUnderRule } from "./units";

const at = (hhmm: string) => `2026-10-01T${hhmm}:00-04:00`;
const v = (a: string | null, e: string | null) => unitsToBill({ scheduledStart: at("09:00"), scheduledEnd: at("10:00"), arrival: a && at(a), end: e && at(e) });

describe("units to bill: full 15-minute blocks only (Ripple, Oct 6)", () => {
  it("every case Ripple listed for a 9:00–10:00 visit (4 units)", () => {
    const cases: [string, string, number][] = [["09:00", "10:00", 4], ["09:01", "10:00", 3], ["09:15", "10:00", 3], ["09:20", "10:00", 2], ["09:35", "10:00", 1],
      ["09:50", "10:00", 0], ["09:00", "09:50", 3], ["09:00", "09:44", 2], ["09:20", "09:50", 1]];
    expect(cases.map(([a, e]) => v(a, e).units)).toEqual(cases.map(([, , n]) => n));
  });
  it("early arrival and a late end count as the start / end; never more than scheduled; seconds don't count", () => {
    expect(v("08:40", "10:30")).toEqual({ units: 4, scheduled: 4, late: false, early: false });
    expect(unitsToBill({ scheduledStart: at("09:00"), scheduledEnd: at("10:00"), arrival: "2026-10-01T09:00:59-04:00", end: at("10:00") }).units).toBe(4);
    expect(v(null, null).units).toBe(4);
  });
  it("reasons: late arrival, left early, or both", () => {
    expect(v("09:20", "09:50")).toMatchObject({ late: true, early: true });
    expect(notBilledReason(true, true)).toBe("late arrival and left early");
    expect(notBilledReason(false, true, " / ")).toBe("left early");
    expect(leftEarly(at("09:44"), at("10:00"))).toBe(true);
    expect(leftEarly("2026-10-01T09:59:59-04:00", at("10:00"))).toBe(true);
    expect(leftEarly(at("10:00"), at("10:00"))).toBe(false);
  });
});

// S18: the same cases as the PGlite suite (s18.cjs R1 / R2) on a 9:00-11:00 visit (8 units), and full blocks = S12
describe("units rules (S18): mirrors cp_units_for", () => {
  const r = (a: string, e: string, rule: "full_blocks" | "nearest" | "grace", grace = 0) =>
    unitsUnderRule({ scheduledStart: at("09:00"), scheduledEnd: at("11:00"), arrival: at(a), end: at(e), rule, grace });
  it("full blocks equal the S12 rule", () => {
    for (const [a, e] of [["09:00", "10:00"], ["09:01", "10:00"], ["09:15", "09:44"], ["08:40", "10:30"], ["09:20", "09:50"]])
      expect(unitsUnderRule({ scheduledStart: at("09:00"), scheduledEnd: at("10:00"), arrival: at(a), end: at(e), rule: "full_blocks" })).toBe(v(a, e).units);
  });
  it("grace 7: up to 7 minutes late / early is on time", () => {
    expect([r("09:07", "11:00", "grace", 7), r("09:08", "11:00", "grace", 7), r("09:00", "10:53", "grace", 7), r("09:00", "10:52", "grace", 7), r("09:07", "10:53", "grace", 7)]).toEqual([8, 7, 8, 7, 8]);
  });
  it("nearest: served minutes / 15 rounded half up, never above scheduled", () => {
    expect([r("09:07", "11:00", "nearest"), r("09:08", "11:00", "nearest"), r("09:25", "10:59", "nearest"), r("09:00", "11:10", "nearest")]).toEqual([8, 7, 6, 8]);
  });
});
