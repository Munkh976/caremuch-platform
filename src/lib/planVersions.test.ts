import { describe, expect, it } from "vitest";
import { diffSnapshots, expiryText, pendingNeeds, type IposExpiry, type PlanSnapshot } from "./planVersions";

const base: PlanSnapshot = {
  header: { effective_date: "2026-01-01", recorder_name: "A" }, field_values: { strengths: "Kind" },
  goals: [{ seq: 1, goal_text: "Goal one", objectives: [{ letter: "A", objective_text: "Obj A", staff_instructions: "Do A" }] }],
  measures: [{ letter: "A", seq: 1, prompt_text: "Did A?" }], rows: { care_plan_attendees: [{ name: "X" }] },
};

describe("S17 What changed", () => {
  it("lists header, field, goal, objective, instruction, data question and row changes", () => {
    const after: PlanSnapshot = {
      header: { effective_date: "2026-01-01", recorder_name: "B" }, field_values: { strengths: "Kind and curious" },
      goals: [{ seq: 1, goal_text: "Goal one", objectives: [{ letter: "A", objective_text: "Obj A", staff_instructions: "Do A slowly" }, { letter: "B", objective_text: "Obj B" }] }],
      measures: [{ letter: "A", seq: 1, prompt_text: "Did A today?" }], rows: { care_plan_attendees: [{ name: "X" }, { name: "Y" }] },
    };
    expect(diffSnapshots(base, after)).toEqual([
      "Recorder: A → B", "strengths: Kind → Kind and curious", "Objective A Instructions for Staff: Do A → Do A slowly",
      "Objective B added: Obj B", "Data question A.1: Did A? → Did A today?", "Attendees: 1 → 2 rows (changed)",
    ]);
  });
  it("says so when nothing visible changed, and for the first revision", () => {
    expect(diffSnapshots(base, base)).toEqual(["No visible change."]);
    expect(diffSnapshots(null, base)).toEqual(["First recorded revision."]);
  });
});

describe("S17 expiry warning", () => {
  const e = (days: number, pending: IposExpiry["pending"]): IposExpiry => ({ client_id: "c", client_name: "Zoe", care_plan_id: "p", version: 1, expiration_date: "2026-11-01",
    days_left: days, band: days <= 14 ? "red" : "amber", pending, shifts_after_count: 0, shifts_after: [] });
  it("reads like the owner's wording", () => {
    expect(expiryText(e(20, { care_plan_id: "q", version: 2, effective_date: null, inservice_signed: false, sessions: 0 }))).toBe("IPOS v1 expires in 20 days; v2 is waiting for its in-service / training");
    expect(expiryText(e(5, { care_plan_id: "q", version: 2, effective_date: null, inservice_signed: true, sessions: 0 }))).toBe("IPOS v1 expires in 5 days; v2 is waiting for its training");
    expect(expiryText(e(-3, null))).toBe("IPOS v1 expired 3 days ago; no new version has been started");
    expect(expiryText(e(0, null))).toBe("IPOS v1 expires today; no new version has been started");
  });
  it("pending badge", () => {
    expect(pendingNeeds(false, 0)).toBe("Pending: in-service / training");
    expect(pendingNeeds(true, 1)).toBe("Pending: ready");
  });
});
