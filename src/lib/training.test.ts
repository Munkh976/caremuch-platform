import { describe, expect, it } from "vitest";
import { buildRoster, caregiverStatus, docTypeFor, filterCaregivers, filterRoster, retrainingFor, sessionSummary, trainedCount, unitsByService, type TrainingCaregiver, type TrainingContext } from "./training";

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

describe("S15 Training tab: sessions and roster", () => {
  const rec = (id: string, d: string, trainer: string | null) => ({ caregiver_id: id, caregiver_name: id, training_date: d, training_method: null, primary_clinician_name: null, trainer_name: trainer, signed_date: d });
  const form = (id: string, v: number, records: ReturnType<typeof rec>[]) => ({ id, training_version: v, plan_document_type: "ipos_annual" as const, plan_effective_date: null, location: null,
    field_snapshot: null, field_values: {}, created_at: "2026-10-01T12:00:00Z", records });
  const ctx = {
    plan: { care_plan_id: "p", version: 2, training_version: 2, plan_type: "annual" as const, effective_date: "2026-10-01", expiration_date: null },
    training_forms: [form("f1", 1, [rec("Mia", "2026-08-01", "Pat")]), form("f2", 2, [rec("Ana", "2026-10-20", "Pat Morgan"), rec("Ben", "2026-10-19", "Pat Morgan")])],
    caregivers: [cg("Ana", { trained_version: 2, trained_current: true, credentials_current: true }), cg("Ben", { trained_version: 2, trained_current: true }),
      cg("Mia", { trained_version: 1, credentials_current: true }), cg("Leo", { credentials_current: true }), cg("Ivy", {})],
  } as unknown as TrainingContext;
  it("a session row: earliest attendee date, distinct trainers, attendee count", () => {
    expect(sessionSummary(ctx.training_forms[1])).toMatchObject({ date: "2026-10-19", trainer: "Pat Morgan", attendees: 2, version: 2 });
  });
  it("roster: Trained <date> by <trainer> / Needs retraining / Never trained; next shift; filters; N of M", () => {
    const r = buildRoster(ctx, [{ caregiver_id: "Ivy", next: "2026-10-29" }], new Map([["Ana", "2026-10-23"]]));
    const by = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(by.Ana).toMatchObject({ status: "trained", trained_on: "2026-10-20", trainer: "Pat Morgan", next_shift: "2026-10-23" });
    expect(by.Mia).toMatchObject({ status: "retrain", trained_version: 1 });
    expect(by.Ivy).toMatchObject({ status: "retrain", next_shift: "2026-10-29" });   // on the retraining list without an earlier record
    expect(by.Leo).toMatchObject({ status: "never", next_shift: null });
    expect(filterRoster(r, "trained").map((x) => x.name)).toEqual(["Ana", "Ben"]);
    expect(filterRoster(r, "retrain").map((x) => x.name)).toEqual(["Ivy", "Mia"]);
    expect(filterRoster(r, "all")).toHaveLength(5);
    expect(trainedCount(r)).toEqual({ trained: 2, of: 4 });   // Leo never trained, no shift with the client
  });
});