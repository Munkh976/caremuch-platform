import { describe, expect, it } from "vitest";
import { cleanFieldValues, goalsPayload, groupGoals, measuresPayload, onboardedCount, onboardingDetail, renumber, resolveShell, validateFieldValues,
  validateGoals, validateHeader, validateMeasures, validateRows, ROW_SECTIONS, type GoalRow, type ShellRow } from "./carePlan";
import type { TemplateField } from "./formTemplates";

const shell = (o: Partial<ShellRow>): ShellRow => ({ id: "x", name: "S", kind: "ipos", virtual_office_id: null, intake_doc_type: null, is_active: true,
  created_at: "2026-10-01T00:00:00Z", current_version_id: "v", current_version: 1, ...o });

describe("resolveShell (mirrors cp_resolve_template)", () => {
  it("prefers the office's own shell, then the newest agency-wide one; skips inactive and unpublished", () => {
    const shells = [shell({ id: "agency-old" }), shell({ id: "agency-new", created_at: "2026-10-03T00:00:00Z" }), shell({ id: "office", virtual_office_id: "X" }),
      shell({ id: "other-office", virtual_office_id: "Y", created_at: "2026-10-09T00:00:00Z" }), shell({ id: "off", virtual_office_id: "X", is_active: false, created_at: "2026-10-09T00:00:00Z" }),
      shell({ id: "draft", virtual_office_id: "X", current_version_id: null, created_at: "2026-10-09T00:00:00Z" })];
    expect(resolveShell(shells, "ipos", "X")?.id).toBe("office");
    expect(resolveShell(shells, "ipos", "Z")?.id).toBe("agency-new");
    expect(resolveShell(shells, "authorization", "X")).toBeNull();
  });
});

describe("validateFieldValues (mirrors cp_validate_field_values)", () => {
  const f = (o: Partial<TemplateField>): TemplateField => ({ field_key: "k", label: "K", field_type: "text", storage: "field_value", ...o });
  const fields = [f({ field_key: "hopes", label: "Hopes", field_type: "longtext", required: true }), f({ field_key: "lvl", label: "Level", field_type: "select", options: ["a", "b"] }),
    f({ field_key: "n", label: "N", field_type: "number" }), f({ field_key: "d", label: "D", field_type: "date" }), f({ field_key: "eff", label: "Eff", storage: "spine_column" })];
  it("required, select options, types, dates, unknown keys", () => {
    expect(validateFieldValues(fields, {})).toBe("Hopes is required");
    expect(validateFieldValues(fields, { hopes: "x", lvl: "c" })).toMatch(/one of its options/);
    expect(validateFieldValues(fields, { hopes: "x", n: "3" as unknown as number })).toMatch(/number/);
    expect(validateFieldValues(fields, { hopes: "x", d: "2026-13-45" })).toMatch(/valid date/);
    expect(validateFieldValues(fields, { hopes: "x", eff: "2026-01-01" })).toMatch(/Unknown field "eff"/);
    expect(validateFieldValues(fields, { hopes: "x", lvl: "a", n: 2, d: "2026-01-02" })).toBeNull();
  });
  it("cleanFieldValues drops blanks and non-field_value keys", () => {
    expect(cleanFieldValues(fields, { hopes: " ", lvl: "a", n: null, eff: "2026-01-01" })).toEqual({ lvl: "a" });
  });
});

describe("header + rows", () => {
  it("validateHeader needs both dates and keeps them in order", () => {
    expect(validateHeader({ effective_date: "2026-01-01" }, true)).toMatch(/effective and an expiration/);
    expect(validateHeader({ effective_date: "2026-02-01", expiration_date: "2026-01-01" }, true)).toMatch(/before the effective/);
    expect(validateHeader({ effective_date: "2026-01-01", expiration_date: "2026-12-31" }, true)).toBeNull();
  });
  it("validateRows: required columns and enum values", () => {
    const needs = ROW_SECTIONS.find((s) => s.entity === "care_plan_need")!;
    expect(validateRows(needs, [{ domain: "x" }])).toMatch(/Source is required/);
    expect(validateRows(needs, [{ source: "elsewhere" }])).toMatch(/invalid value/);
    expect(validateRows(needs, [{ source: "michicans" }])).toBeNull();
  });
});

describe("onboarding", () => {
  it("counts complete + not applicable; expired training says redo at version N", () => {
    const items = [{ key: "ipos", status: "complete" as const }, { key: "client_forms", status: "not_applicable" as const }, { key: "training", status: "expired" as const }];
    expect(onboardedCount({ items })).toBe(2);
    expect(onboardingDetail(items[2], 2)).toBe("Redo at version 2");
  });
});

describe("goals", () => {
  const goals: GoalRow[] = [
    { id: "g2", seq: 2, goal_text: "Rest", objectives: [{ id: "o3", seq: 1, objective_text: "Transport", responsible_party: "case_management" }] },
    { id: "g1", seq: 1, goal_text: "Skills", objectives: [
      { id: "o2", seq: 2, objective_text: "Second", responsible_party: "this_agency", service_type: "cls" },
      { id: "o1", seq: 1, objective_text: "First", responsible_party: "this_agency", service_type: "cls" },
      { id: "o4", seq: 3, objective_text: "Evaluate", responsible_party: "evaluator" }] }];
  it("groups by service, keeps seq order, shows an offered service with no goals, and others as reference", () => {
    const g = groupGoals(goals, ["cls", "respite"]);
    expect(g.map((x) => x.title)).toEqual(["CLS — goals", "Respite — no goals", "Other providers — reference"]);
    expect(g[0].items[0].objectives.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(g[2].items.map((i) => i.goal.id)).toEqual(["g1", "g2"]);
    expect(g[2].items[0].objectives.map((o) => o.id)).toEqual(["o4"]);
  });
  it("payload drops blanks; renumber keeps the order given; validation needs an offered service", () => {
    const p = goalsPayload([{ seq: 1, goal_text: " G ", objectives: [{ seq: 1, objective_text: "O", responsible_party: "this_agency", service_type: "cls", letter: "", staff_instructions: null }] }]);
    expect(p).toEqual([{ seq: 1, goal_text: "G", objectives: [{ seq: 1, objective_text: "O", responsible_party: "this_agency", service_type: "cls" }] }]);
    expect(renumber([goals[0], goals[1]]).map((g) => g.seq)).toEqual([1, 2]);
    expect(validateGoals([{ seq: 1, goal_text: "G", objectives: [{ seq: 1, objective_text: "O", responsible_party: "this_agency", service_type: "respite" }] }], ["cls"])).toMatch(/service this office provides/);
  });
});

describe("measures", () => {
  it("trials need a count; options only for list kinds", () => {
    expect(validateMeasures([{ measure_type_id: "t", kind: "trials", prompt_text: "Q", options: [], trial_count: null }])).toMatch(/1-20 trials/);
    expect(measuresPayload([{ measure_type_id: "t", kind: "prompt_level", prompt_text: " Q ", options: ["Ind", "Verbal"], trial_count: null },
      { measure_type_id: "u", kind: "tally", prompt_text: "Count", options: ["x"], trial_count: 3 }])).toEqual([
      { measure_type_id: "t", seq: 0, prompt_text: "Q", options: ["Ind", "Verbal"] }, { measure_type_id: "u", seq: 1, prompt_text: "Count" }]);
  });
});
