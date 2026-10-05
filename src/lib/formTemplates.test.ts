import { describe, expect, it } from "vitest";
import { diffFields, fieldKeyFor, groupShells, isLockedField, shellGroup, type Shell, type TemplateField } from "./formTemplates";
import { rpcErrorText } from "./rpcError";

const f = (key: string, extra: Partial<TemplateField> = {}): TemplateField => ({ field_key: key, label: key, field_type: "text", storage: "field_value", ...extra });
const shell = (name: string, kind: string, extra: Partial<Shell> = {}): Shell => ({
  template_id: name, name, kind, intake_doc_type: null, service_type: null, is_required_for_client: false, office_id: null, scope: "agency",
  can_edit: false, current_version: 1, draft_version: null, versions: [], ...extra,
});

describe("shell grouping", () => {
  it("groups progress notes per service and intake per document type, IPOS first", () => {
    const g = groupShells([
      shell("Intake consent", "intake", { intake_doc_type: "consent" }),
      shell("Respite note", "progress_note", { service_type: "respite" }),
      shell("Any note", "progress_note"),
      shell("CLS note", "progress_note", { service_type: "cls" }),
      shell("IPOS", "ipos"),
    ]).map((x) => x.group);
    expect(g).toEqual(["IPOS", "Progress notes · Any service", "Progress notes · CLS", "Progress notes · Respite", "Intake documents · Consent"]);
    expect(shellGroup({ kind: "training", service_type: null, intake_doc_type: null })).toBe("Training forms");
  });
});

describe("locked fields and keys", () => {
  it("spine and child-row fields are locked, field values and static text are not", () => {
    expect(isLockedField({ storage: "spine_column" })).toBe(true);
    expect(isLockedField({ storage: "child_rows" })).toBe(true);
    expect(isLockedField({ storage: "field_value" })).toBe(false);
    expect(isLockedField({ storage: "static_text" })).toBe(false);
  });
  it("new field keys are snake case and unique", () => {
    expect(fieldKeyFor("Strengths & interests", [])).toBe("strengths_interests");
    expect(fieldKeyFor("Strengths & interests", ["strengths_interests"])).toBe("strengths_interests_2");
    expect(fieldKeyFor("2nd contact", [])).toBe("f_2nd_contact");
  });
});

describe("diffFields", () => {
  it("reports added, removed, changed, reordered and layout changes", () => {
    const cur = [f("a"), f("b", { required: false }), f("c", { options: ["x"] })];
    const nxt = [f("b", { label: "B!", required: true }), f("a"), f("c", { options: ["x", "y"] }), f("d")];
    const d = diffFields(cur, nxt, { billing_footer: { enabled: true } }, { billing_footer: { enabled: true, fields: ["Units billed"] }, notes_prompt: "Include reinforcers" });
    expect(d).toContainEqual({ type: "added", key: "d", label: "d" });
    expect(d).toContainEqual({ type: "changed", key: "b", label: "B!", what: ['label "b" → "B!"', "now required"] });
    expect(d).toContainEqual({ type: "changed", key: "c", label: "c", what: ["options"] });
    expect(d).toContainEqual({ type: "reordered" });
    expect(d).toContainEqual({ type: "layout", what: "billing footer" });
    expect(d).toContainEqual({ type: "layout", what: "notes prompt" });
    expect(diffFields(cur, cur)).toEqual([]);
    expect(diffFields([f("a"), f("z")], [f("a")])).toEqual([{ type: "removed", key: "z", label: "z" }]);
  });
});

describe("rpcErrorText", () => {
  it("refusals are generic; validation messages pass through", () => {
    expect(rpcErrorText({ code: "42501", message: "Not found or not allowed" })).toBe("You can't do that here, or the record wasn't found.");
    expect(rpcErrorText({ message: "new row violates row-level security policy for table x" })).toBe("You can't do that here, or the record wasn't found.");
    expect(rpcErrorText({ code: "22023", message: "This measure type is in use; deactivate it instead" })).toBe("This measure type is in use; deactivate it instead");
    expect(rpcErrorText({ code: "XX000", message: "internal detail id=123" })).toBe("Something went wrong. Please try again.");
  });
});
