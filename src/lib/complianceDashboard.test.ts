import { describe, expect, it } from "vitest";
import { credentialRows, distinctCaregivers, pendingOnboarding, reasonList, retrainingRows, type CredRow, type Readiness } from "./complianceDashboard";
import type { Onboarding } from "./carePlan";

const ob = (id: string, statuses: string[]): Onboarding => ({ client_id: id, as_of: "2026-10-06", onboarded: statuses.every((s) => s === "complete" || s === "not_applicable"),
  items: ["ipos", "assessment", "inservice", "client_forms", "safety_behavior_plan", "training", "authorization", "cls_note_setup"].map((key, i) => ({ key, status: statuses[i] as never })) });

describe("dashboard compliance section (S11)", () => {
  it("pending onboarding: only clients not onboarded, 'N of 8', the missing / expired items by name, link to the Onboarding tab", () => {
    const rows = pendingOnboarding([
      ob("c1", ["complete", "complete", "missing", "complete", "not_applicable", "expired", "complete", "complete"]),
      ob("c2", Array(8).fill("complete")),
      ob("c3", ["missing", "missing", "missing", "missing", "missing", "missing", "complete", "missing"]),
    ], new Map([["c1", "Lily Park"], ["c2", "Zoe Nguyen"], ["c3", "Ray Cole"]]));
    expect(rows.map((r) => [r.name, r.done])).toEqual([["Ray Cole", 1], ["Lily Park", 6]]);
    expect(rows[1].missing).toEqual(["In-service signed", "Caregiver training"]);
    expect(rows[1].href).toBe("/care-plans/c1?tab=onboarding");
  });
  it("credentials: overdue first, then red, yellow, missing; counts per band; link to the Credentials tab", () => {
    const r = (id: string, band: CredRow["band"], days: number | null): CredRow => ({ caregiver_id: id, caregiver_name: id, credential_type_id: band, credential_type: "CPR", expiry_date: null, days, band });
    const { rows, counts } = credentialRows([r("b", "yellow", 50), r("m", "overdue", -3), r("b", "red", 20), r("a", "missing", null)]);
    expect(rows.map((x) => x.band)).toEqual(["overdue", "red", "yellow", "missing"]);
    expect(counts).toEqual({ overdue: 1, red: 1, yellow: 1, missing: 1 });
    expect(rows[0].href).toBe("/caregivers?caregiver=m&tab=credentials");
  });
  it("retraining: one row per caregiver x client with the next shift and the shift count; caregivers counted once", () => {
    const rows = retrainingRows([
      { shift_id: "s2", shift_date: "2026-10-09", caregiver_id: "g1", client_id: "c1", training_version: 2 },
      { shift_id: "s1", shift_date: "2026-10-08", caregiver_id: "g1", client_id: "c1", training_version: 2 },
      { shift_id: "s3", shift_date: "2026-10-10", caregiver_id: "g1", client_id: "c2", training_version: 1 },
    ], new Map([["g1", "Mia Lopez"]]), new Map([["c1", "Zoe N."], ["c2", "Max O."]]));
    expect(rows.map((r) => [r.caregiver_name, r.client_name, r.next_shift, r.shifts])).toEqual([["Mia Lopez", "Zoe N.", "2026-10-08", 2], ["Mia Lopez", "Max O.", "2026-10-10", 1]]);
    expect(distinctCaregivers(rows)).toBe(1);
    expect(rows[0].href).toBe("/training/c1");
  });
  it("readiness reasons: labelled and sorted by count", () => {
    const r = { by_reason: { units_short: 1, training_missing: 3, credential_missing: 3 } } as unknown as Readiness;
    expect(reasonList(r).map((x) => `${x.label}:${x.n}`)).toEqual(["Not trained on the current plan:3", "Required credential missing:3", "Not enough authorized units:1"]);
  });
});
