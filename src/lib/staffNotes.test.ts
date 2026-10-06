import { describe, expect, it } from "vitest";
import { answerText, matchesStatus, returnReasonOk, sortQueue, weekOf, type QueueRow } from "./staffNotes";
import type { NoteMeasure } from "./caregiverNotes";

const row = (p: Partial<QueueRow>): QueueRow => ({ note_id: "n", shift_id: "s", client_id: "c", client_first_name: "Zoe", client_last_initial: "N", caregiver_id: "g", caregiver_name: "Ana R",
  service_type: "cls", service_date: "2026-10-04", scheduled_start: "2026-10-04T13:00:00Z", scheduled_end: "2026-10-04T14:00:00Z", arrived_late: false, units_scheduled: 4, units_to_bill: 4,
  status: "submitted", overdue: false, due_at: "2026-10-06T04:00:00Z", submitted_at: null, reviewed_at: null, returned_count: 0, in_batch: false, group_session: false, ...p });

describe("staff note review helpers", () => {
  it("week of a date follows the office's ISO start day", () => {
    expect(weekOf("2026-10-08", 1)).toEqual({ start: "2026-10-05", end: "2026-10-11" });   // Monday weeks
    expect(weekOf("2026-10-08", 7)).toEqual({ start: "2026-10-04", end: "2026-10-10" });   // Sunday weeks
    expect(weekOf("2026-10-05", 1).start).toBe("2026-10-05");
  });
  it("status filters: overdue spans drafts and not-started visits; reviewed includes billed", () => {
    expect(matchesStatus(row({ status: "not_started", overdue: true }), "overdue")).toBe(true);
    expect(matchesStatus(row({ status: "billed" }), "reviewed")).toBe(true);
    expect(matchesStatus(row({ status: "returned" }), "submitted")).toBe(false);
  });
  it("oldest first", () => {
    expect(sortQueue([row({ shift_id: "b", scheduled_start: "2026-10-04T15:00:00Z" }), row({ shift_id: "a", scheduled_start: "2026-10-03T15:00:00Z" })]).map((r) => r.shift_id)).toEqual(["a", "b"]);
  });
  it("return reason: at least 10 characters after trimming (UI-only rule)", () => {
    expect(returnReasonOk("  ten chars! ")).toBe(true);
    expect(returnReasonOk("   short   ")).toBe(false);
  });
  it("answers render as text for every kind", () => {
    const m = (kind: NoteMeasure["kind"], options: string[] | null = null): NoteMeasure => ({ measure_id: "m", kind, prompt_text: "p", options, trial_count: 2 });
    expect(answerText(m("yes_no_na"), { value: "N/A" })).toBe("N/A");
    expect(answerText(m("graded_steps", ["Wash", "Cook"]), { steps: [1] })).toBe("2. Cook");
    expect(answerText(m("tally"), { count: 3 })).toBe("3");
    expect(answerText(m("trials"), { trials: [{ value: "Yes", text: "ok" }, { value: "No" }] })).toBe("1: Yes (ok); 2: No");
    expect(answerText(m("short_answer"), null)).toBe("—");
  });
});
