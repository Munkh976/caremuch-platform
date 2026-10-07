import { describe, expect, it } from "vitest";
import { leftEarly, notBilledReason, unitsToBill } from "./units";

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
