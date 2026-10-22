import { describe, expect, it } from "vitest";
import { splitByLimits } from "./shiftLimits";

const row = (shift_date: string, care_type_code = "CLS0001") => ({ shift_date, care_type_code });
const limits = { rules: true, ipos: { version: 1, expiration_date: "2027-03-19" },
  services: [{ care_type_code: "CLS0001", service_type: "cls", authorized_until: "2027-02-28" }, { care_type_code: "RESP0001", service_type: "respite", authorized_until: null }] };

describe("S17 recurring series stop at the limits (1a / 1d)", () => {
  it("keeps visits inside the dates and reports the skipped ones with the reason", () => {
    const rows = [row("2027-02-27"), row("2027-02-28"), row("2027-03-01"), row("2027-03-08"), row("2027-03-20"), row("2027-03-01", "RESP0001"), row("2027-03-21", "RESP0001")];
    const { keep, skipped } = splitByLimits(rows, limits);
    expect(keep.map((r) => `${r.shift_date}/${r.care_type_code}`)).toEqual(["2027-02-27/CLS0001", "2027-02-28/CLS0001", "2027-03-01/RESP0001"]);
    expect(skipped).toEqual([
      { reason: "no CLS authorization after Feb 28, 2027", count: 2, first: "2027-03-01" },
      { reason: "after IPOS v1 expires (Mar 19, 2027)", count: 2, first: "2027-03-20" },
    ]);
  });
  it("changes nothing without rules (office not using the module) or without limits", () => {
    const rows = [row("2030-01-01")];
    expect(splitByLimits(rows, { rules: false })).toEqual({ keep: rows, skipped: [] });
    expect(splitByLimits(rows, null)).toEqual({ keep: rows, skipped: [] });
    expect(splitByLimits(rows, { rules: true, ipos: null, services: [] })).toEqual({ keep: rows, skipped: [] });
  });
});
