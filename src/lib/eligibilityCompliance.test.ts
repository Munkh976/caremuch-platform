import { describe, expect, it } from "vitest";
import { complianceLabel, complianceLines, dedupeIssues, fixLinkFor } from "./eligibilityCompliance";
import { mapServerResult } from "./shiftEligibility";

const issue = (code: string, detail = "server text") => ({ code, label: `label ${code}`, detail });

describe("care-plan checks in an eligibility result (S10)", () => {
  it("enforcement off: the server sends them as advisory -> amber lines, nothing blocked, Confirm stays enabled", () => {
    const r = mapServerResult({ hard: [], soft: [], advisory: [issue("training_missing"), issue("travel_buffer"), issue("units_short")], weekly_hours: 0, projected_weekly_hours: 1 });
    const lines = complianceLines(r, { caregiverId: "g1", clientId: "c1" });
    expect(r.eligible).toBe(true);
    expect(lines.map((l) => [l.issue.code, l.blocked])).toEqual([["training_missing", false], ["units_short", false]]);
  });
  it("enforcement on: the same checks come back hard -> Blocked lines with the server text; other blockers aren't care-plan lines", () => {
    const r = mapServerResult({ hard: [issue("credential_missing"), issue("double_booked")], soft: [issue("availability")], advisory: [], weekly_hours: 0, projected_weekly_hours: 1 });
    const lines = complianceLines(r, { caregiverId: "g1", clientId: "c1" });
    expect(r.eligible).toBe(false);
    expect(lines.map((l) => [l.issue.code, l.blocked, l.issue.detail])).toEqual([["credential_missing", true, "server text"]]);
  });
  it("Fix links: caregiver Credentials tab, client training page, client IPOS / Authorizations; none without the id", () => {
    expect(fixLinkFor("credential_missing", { caregiverId: "g1" })?.href).toBe("/caregivers?caregiver=g1&tab=credentials");
    expect(fixLinkFor("certification_expired", { caregiverId: "g1" })?.href).toBe("/caregivers?caregiver=g1&tab=credentials");
    expect(fixLinkFor("training_missing", { clientId: "c1" })?.href).toBe("/training/c1");
    expect(fixLinkFor("units_short_period", { clientId: "c1" })?.href).toBe("/care-plans/c1?tab=ipos");
    expect(fixLinkFor("authorization_expired", { clientId: "c1" })?.href).toBe("/care-plans/c1?tab=ipos");
    expect(fixLinkFor("training_missing", {})).toBeNull();
    expect(fixLinkFor("group_full", { clientId: "c1" })).toBeNull();
  });
  it("group_full reads 'Group is full (1:N)' from the server's max", () => {
    expect(complianceLabel(issue("group_full", "This caregiver already has 3 of 3 clients in this group session."))).toBe("Group is full (1:3)");
    expect(complianceLabel(issue("group_full", "This caregiver already has 4 of 4 clients in this group session."))).toBe("Group is full (1:4)");
    expect(complianceLabel(issue("units_short"))).toBe("label units_short");
  });
  it("caregiver view: two generic 'not_bookable' issues show once", () => {
    const nb = { code: "not_bookable", label: "Not bookable yet", detail: "This shift can't be booked yet. Your office will contact you." };
    expect(dedupeIssues([nb, { ...nb }, issue("double_booked")]).map((i) => i.code)).toEqual(["not_bookable", "double_booked"]);
  });
});
