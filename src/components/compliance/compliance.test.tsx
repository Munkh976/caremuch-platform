import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { expiryBand } from "./expiry";
import { UnitsBar } from "./UnitsBar";
import { daysUntil } from "@/lib/dateOnly";

// Fixed "today" (local noon) so the bands don't depend on the clock or the time zone.
const today = new Date(2026, 9, 4, 12, 0, 0);

describe("expiryBand (Q16: yellow <= 60, red <= 30, overdue before today)", () => {
  it.each([
    ["2026-12-04", 61, "ok"],
    ["2026-12-03", 60, "yellow"],
    ["2026-12-02", 59, "yellow"],
    ["2026-11-03", 30, "red"],
    ["2026-11-02", 29, "red"],
    ["2026-10-04", 0, "red"],
    ["2026-10-03", -1, "overdue"],
  ])("%s is %i days away -> %s", (date, days, band) => {
    expect(daysUntil(date, today)).toBe(days);
    expect(expiryBand(date, today)).toBe(band);
  });
  it("no date -> none", () => expect(expiryBand(null, today)).toBe("none"));
});

describe("UnitsBar", () => {
  it("authorized / used / pending / left with hours, and the weekly cap", () => {
    const html = renderToStaticMarkup(<UnitsBar authorized={40} used={10} pending={8} periodCap={{ period: "week", cap: 20, usedInPeriod: 16 }} />);
    expect(html).toContain("10 used · 8 pending of 40");
    expect(html).toContain("22 units left (5.50 h)");
    expect(html).toContain("4 left this week (cap 20)");
    expect(html).not.toContain("$");
  });
  it("over-drawn shows 'Over by'", () => {
    expect(renderToStaticMarkup(<UnitsBar authorized={6} used={0} pending={8} />)).toContain("Over by 2 units");
  });
});
