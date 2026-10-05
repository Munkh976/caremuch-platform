import { describe, expect, it } from "vitest";
import { draftAnswer, entryData, isoToHhmm, missingAnswers, shiftTimeToIso, sortNotes, zonedToIso, type NoteDueItem, type NoteMeasure } from "./caregiverNotes";

const M = (kind: NoteMeasure["kind"], extra: Partial<NoteMeasure> = {}): NoteMeasure => ({ measure_id: kind, kind, prompt_text: kind, options: null, trial_count: null, ...extra });

describe("draft answers mirror the server's draft validation", () => {
  it("leaves a partial trials list and an unknown prompt level out", () => {
    const trials = M("trials", { trial_count: 3 });
    expect(draftAnswer(trials, { trials: [{ value: "Yes" }, {}, { value: "No" }] })).toBeUndefined();
    expect(draftAnswer(trials, { trials: [{ value: "Yes", text: " ok " }, { value: "N/A" }, { value: "No", text: "" }] }))
      .toEqual({ trials: [{ value: "Yes", text: " ok " }, { value: "N/A" }, { value: "No" }] });
    const pl = M("prompt_level", { options: ["Independent", "Verbal"] });
    expect(draftAnswer(pl, { value: "Physical" })).toBeUndefined();
    expect(draftAnswer(pl, { value: "Verbal" })).toEqual({ value: "Verbal" });
  });
  it("tally and graded steps always have a value; staff notes never", () => {
    expect(draftAnswer(M("tally"), undefined)).toEqual({ count: 0 });
    expect(draftAnswer(M("tally"), { count: 1200 })).toEqual({ count: 1000 });
    expect(draftAnswer(M("graded_steps", { options: ["a", "b", "c"] }), { steps: [2, 0, 2] })).toEqual({ steps: [0, 2] });
    expect(draftAnswer(M("staff_note"), { value: "x" })).toBeUndefined();
  });
  it("entry data has only answered measures; missing lists what submit would refuse", () => {
    const ms = [M("yes_no_na"), M("short_answer"), M("staff_note"), M("tally")];
    expect(entryData(ms, { yes_no_na: { value: "Yes" }, short_answer: { value: "" } })).toEqual({ yes_no_na: { value: "Yes" }, tally: { count: 0 } });
    expect(missingAnswers(ms, { yes_no_na: { value: "Yes" }, short_answer: { value: "  " } }).map((m) => m.kind)).toEqual(["short_answer"]);
  });
});

describe("office time zone", () => {
  it("converts wall time in the office zone both ways, across DST", () => {
    expect(zonedToIso("2026-10-06", "13:00", "America/New_York")).toBe("2026-10-06T17:00:00.000Z");
    expect(zonedToIso("2026-12-06", "13:00", "America/New_York")).toBe("2026-12-06T18:00:00.000Z");
    expect(isoToHhmm("2026-10-06T17:05:00Z", "America/New_York")).toBe("13:05");
  });
  it("puts a time before the allowed window of an overnight shift on the next day", () => {
    const start = zonedToIso("2026-10-06", "22:00", "America/Chicago");
    expect(shiftTimeToIso("2026-10-06", "21:30", "America/Chicago", start, 60)).toBe(zonedToIso("2026-10-06", "21:30", "America/Chicago"));
    expect(shiftTimeToIso("2026-10-06", "02:00", "America/Chicago", start, 0)).toBe(zonedToIso("2026-10-07", "02:00", "America/Chicago"));
  });
});

describe("notes list order", () => {
  const item = (id: string, s: NoteDueItem["note_status"], overdue: boolean, due: string): NoteDueItem => ({ shift_id: id, shift_date: "2026-10-01", start_time: "09:00", end_time: "10:00",
    scheduled_start: due, scheduled_end: due, service_type: "cls", client_first_name: "A", client_last_initial: "B", note_status: s, due_at: due, overdue, returned_reason: null });
  it("returned first, then overdue, then by due; history apart, newest first", () => {
    const r = sortNotes([item("d", "draft", false, "2026-10-05"), item("h1", "submitted", false, "2026-10-01"), item("o", "not_started", true, "2026-10-03"),
      item("r", "returned", false, "2026-10-09"), item("h2", "reviewed", false, "2026-10-02")]);
    expect(r.todo.map((x) => x.shift_id)).toEqual(["r", "o", "d"]);
    expect(r.history.map((x) => x.shift_id)).toEqual(["h2", "h1"]);
  });
});
