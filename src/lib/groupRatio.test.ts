import { describe, expect, it } from "vitest";
import { groupClients, groupRatioIssue, GROUP_RATIO_LABEL } from "./groupRatio";

const rows = [
  { shift_id: "s1", client_id: "c1", caregiver_ids: ["ana"] },
  { shift_id: "s2", client_id: "c2", caregiver_ids: ["ana"] },
  { shift_id: "s3", client_id: "c3", caregiver_ids: [] },
  { shift_id: "s4", client_id: "c4", caregiver_ids: ["ben"] },
];

describe("group session ratio advisory (S12)", () => {
  it("counts this caregiver's distinct clients in the session, plus the client being assigned", () => {
    expect(groupClients(rows, "ana")).toBe(2);
    expect(groupClients(rows, "ana", { shiftId: "s3", clientId: "c3" })).toBe(3);
    expect(groupClients(rows, "ana", { shiftId: "s1", clientId: "c1" })).toBe(2);   // re-assigning an existing one
    expect(groupClients(rows, "ben", { shiftId: "s3", clientId: "c3" })).toBe(2);
  });
  it("1:2 is fine; above it an advisory (overridable, never a blocker)", () => {
    expect(groupRatioIssue(2)).toBeNull();
    const i = groupRatioIssue(3);
    expect(i?.label).toBe(GROUP_RATIO_LABEL);
    expect(i?.label).toBe("Above Ripple's preferred ratio (1:2)");
    expect(i?.overridable).toBe(true);
    expect(i?.detail).toMatch(/3 clients .*1:3 is allowed/);
  });
});
