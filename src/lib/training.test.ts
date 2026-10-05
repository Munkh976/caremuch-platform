import { describe, expect, it } from "vitest";
import { caregiverStatus, docTypeFor, filterCaregivers, retrainingFor, unitsByService, type TrainingCaregiver } from "./training";

const cg = (name: string, o: Partial<TrainingCaregiver>): TrainingCaregiver => ({ caregiver_id: name, name, trained_version: null, trained_current: false, credentials_current: true, ...o });
const list = [cg("Ann", { trained_version: 2, trained_current: true }), cg("Bo", { trained_version: 2, trained_current: true, credentials_current: false }),
  cg("Cy", { trained_version: 1 }), cg("Di", {})];

describe("caregivers who can deliver", () => {
  it("trained = current version + credentials; retrain = earlier version only; all = everyone", () => {
    expect(filterCaregivers(list, "trained").map((c) => c.name)).toEqual(["Ann"]);
    expect(filterCaregivers(list, "retrain").map((c) => c.name)).toEqual(["Cy"]);
    expect(filterCaregivers(list, "all")).toHaveLength(4);
  });
  it("status words", () => {
    expect(caregiverStatus(list[2], 2)).toEqual(["Needs retraining (trained v1)", "Credentials current"]);
    expect(caregiverStatus(list[1], 2)).toEqual(["Trained v2", "Credentials not current"]);
  });
});

describe("retraining + units", () => {
  it("one row per caregiver with the next shift, this client only", () => {
    const rows = [{ shift_id: "s2", shift_date: "2026-11-03", caregiver_id: "g1", client_id: "c", care_plan_id: "p", training_version: 2 },
      { shift_id: "s1", shift_date: "2026-11-01", caregiver_id: "g1", client_id: "c", care_plan_id: "p", training_version: 2 },
      { shift_id: "s3", shift_date: "2026-11-02", caregiver_id: "g2", client_id: "other", care_plan_id: "q", training_version: 1 }];
    expect(retrainingFor(rows, "c", new Map([["g1", "Ann"]]))).toEqual([{ caregiver_id: "g1", name: "Ann", next: "2026-11-01", shifts: 2, training_version: 2 }]);
  });
  it("units summed per service over active authorizations", () => {
    const u = unitsByService([{ service_type: "cls", status: "active", units_authorized: 40, units_used: 10, units_pending: 4, unit_minutes: 15 },
      { service_type: "cls", status: "expired", units_authorized: 99, units_used: 0, units_pending: 0, unit_minutes: 15 },
      { service_type: "cls", status: "active", units_authorized: 20, units_used: 0, units_pending: 8, unit_minutes: 15 }]);
    expect(u).toEqual([{ service_type: "cls", authorized: 60, used: 10, pending: 12, unit_minutes: 15, count: 2 }]);
  });
  it("document type follows the plan type", () => { expect(docTypeFor("initial")).toBe("ipos_initial"); expect(docTypeFor("annual")).toBe("ipos_annual"); });
});
