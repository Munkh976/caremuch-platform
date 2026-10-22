import { describe, expect, it } from "vitest";
import { actionRequest, canUseVisitActions, formProblem } from "./visitActions";
import { passesAutoAssignGate } from "./autoAssignGate";

const f = (p: Partial<{ reason: "" | "caregiver_unavailable" | "schedule_change" | "client_request" | "other"; text: string; requestedBy: "" | "client" | "agency" }>) =>
  ({ reason: "" as const, text: "", requestedBy: "" as const, ...p });

describe("visit actions (owner, Oct 22, B)", () => {
  it("only manager, scheduler and agency admin get the menu", () => {
    expect(canUseVisitActions(["scheduler"])).toBe(true);
    expect(canUseVisitActions(["agency_admin", "hr_staff"])).toBe(true);
    expect(canUseVisitActions(["hr_staff"])).toBe(false);
    expect(canUseVisitActions(["caregiver"])).toBe(false);
    expect(canUseVisitActions(null)).toBe(false);
  });
  it("reasons: a code for unassign / cancel, text for 'other' and a no-show, who asked for a cancel", () => {
    expect(formProblem("unassign", f({}))).toBe("Choose a reason");
    expect(formProblem("unassign", f({ reason: "schedule_change" }))).toBeNull();
    expect(formProblem("unassign", f({ reason: "other", text: "x" }))).toBe("Describe the reason");
    expect(formProblem("cancel", f({ reason: "client_request" }))).toBe("Say who asked for the cancellation");
    expect(formProblem("cancel", f({ reason: "client_request", requestedBy: "client" }))).toBeNull();
    expect(formProblem("no_show", f({}))).toBe("Describe the reason");
    expect(formProblem("no_show", f({ text: "Nobody home" }))).toBeNull();
  });
  it("each action calls its own function with the scope flags", () => {
    const base = { reason: "schedule_change" as const, text: "  ", requestedBy: "agency" as const, following: true, wholeGroup: false };
    expect(actionRequest("unassign", "s1", base)).toEqual({ fn: "unassign_visit", args: { _shift_id: "s1", _reason_code: "schedule_change", _reason_text: null, _following: true, _whole_group: false } });
    expect(actionRequest("cancel", "s1", base).args).toMatchObject({ _requested_by: "agency", _following: true });
    expect(actionRequest("no_show", "s1", { ...base, text: "Nobody home", wholeGroup: true })).toEqual({ fn: "record_client_no_show", args: { _shift_id: "s1", _reason_text: "Nobody home", _whole_group: true } });
  });
  it("the Auto-assign gate on a caregiver's eligibility: hard, soft or a care-plan advisory fails it; other advisories don't", () => {
    const r = (p: object) => ({ eligible: true, blockers: [], overridable: [], flags: [], ...p }) as never;
    expect(passesAutoAssignGate(r({}))).toBe(true);
    expect(passesAutoAssignGate(r({ eligible: false }))).toBe(false);
    expect(passesAutoAssignGate(r({ overridable: [{ code: "availability", label: "x" }] }))).toBe(false);
    expect(passesAutoAssignGate(r({ flags: [{ code: "training_missing", label: "x" }] }))).toBe(false);
    expect(passesAutoAssignGate(r({ flags: [{ code: "no_shows", label: "x" }] }))).toBe(true);
    expect(passesAutoAssignGate(r({ flags: [{ code: "not_bookable", label: "x" }] }))).toBe(false);   // caregiver-safe form
    expect(passesAutoAssignGate(undefined)).toBe(false);
  });
});
