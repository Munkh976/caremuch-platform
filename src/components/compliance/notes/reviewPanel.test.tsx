import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StaffNote } from "@/lib/staffNotes";
import { REVIEW_ACK, undoReviewBlocked, undoneReviews, type StaffHistory } from "@/lib/staffNotes";
import { rowClickOpens, rowKeyOpens } from "@/lib/rowOpen";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
const { ReviewPanel } = await import("./ReviewPanel");

const note = (status: StaffNote["note"]["status"], extra: Partial<StaffNote["note"]> = {}) => ({
  note: {
    id: "n1", status, reviewed_at: status === "reviewed" || status === "billed" ? "2026-10-19T14:05:00Z" : null,
    reviewed_by_name: status === "reviewed" || status === "billed" ? "Pat Morgan" : null, ...extra,
  },
  office: { id: "o1", name: "Office", timezone: "America/New_York" },
}) as unknown as StaffNote;
const html = (d: StaffNote) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ReviewPanel d={d} onDone={() => {}} /></MemoryRouter></QueryClientProvider>);
// the order of the testids in the markup = the order on screen
const order = (h: string, ids: string[]) => ids.map((id) => h.indexOf(`data-testid="${id}"`));

describe("ReviewPanel (demo UX, Oct 19)", () => {
  it("submitted: the statement, then Print, Return, Mark reviewed (disabled until ticked)", () => {
    const h = html(note("submitted"));
    expect(h).toContain(REVIEW_ACK.replace("'", "&#x27;"));
    const [ack, p, r, m] = order(h, ["review-ack", "print-link", "open-return", "mark-reviewed"]);
    expect(ack).toBeGreaterThan(-1);
    expect(ack < p && p < r && r < m).toBe(true);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-testid="mark-reviewed"/);
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="open-return"/);
    expect(h).toContain('href="/progress-notes/n1/print"');
    expect(h).not.toContain('data-testid="reviewed-by"');
  });
  it("reviewed: 'Reviewed by <name> · <date/time>', Print and Undo review (disabled until the bill status is read)", () => {
    const h = html(note("reviewed"));
    expect(h).toMatch(/data-testid="reviewed-by"[^>]*>Reviewed by <span[^>]*>Pat Morgan<\/span> · Mon, Oct 19, 10:05\s?AM/);
    expect(h).toContain('data-testid="print-link"');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*data-testid="undo-review"/);
    expect(h.indexOf('data-testid="print-link"')).toBeLessThan(h.indexOf('data-testid="undo-review"'));
    for (const id of ["review-ack", "mark-reviewed", "open-return", "note-locked"]) expect(h).not.toContain(`data-testid="${id}"`);
  });
  it("billed: reviewed by, locked, Print only", () => {
    const h = html(note("billed"));
    expect(h).toContain('data-testid="reviewed-by"');
    expect(h).toContain('data-testid="note-locked"');
    for (const id of ["review-ack", "mark-reviewed", "open-return", "undo-review"]) expect(h).not.toContain(`data-testid="${id}"`);
  });
  it.each(["draft", "returned"] as const)("%s: no review buttons, Print", (s) => {
    const h = html(note(s));
    expect(h).toContain('data-testid="print-link"');
    for (const id of ["review-ack", "mark-reviewed", "open-return", "reviewed-by", "undo-review"]) expect(h).not.toContain(`data-testid="${id}"`);
  });
});

// Minimal DOM stand-ins: an element knows its ancestors; closest() walks them with a tag/attribute test.
type El = { tag: string; attrs?: Record<string, string>; parent?: El; closest(sel: string): El | null; contains(o: unknown): boolean };
const el = (tag: string, parent?: El, attrs: Record<string, string> = {}): El => {
  const e: El = {
    tag, attrs, parent,
    closest(sel) {
      const tags = ["a", "button", "input", "select", "textarea", "label"];
      for (let x: El | undefined = e; x; x = x.parent) {
        if (tags.includes(x.tag) && sel.split(",").includes(x.tag)) return x;
        if (x.attrs?.role && sel.includes(`[role="${x.attrs.role}"]`)) return x;
        if (x.attrs && "data-row-ignore" in x.attrs) return x;
      }
      return null;
    },
    contains(o) { for (let x = o as El | undefined; x; x = x.parent) if (x === e) return true; return false; },
  };
  return e;
};

describe("rowClickOpens / rowKeyOpens", () => {
  const row = el("tr");
  const cell = el("td", row);
  it("a click on the row's text opens it", () => {
    expect(rowClickOpens(cell, row)).toBe(true);
    expect(rowClickOpens(el("span", cell), row)).toBe(true);
  });
  it("a click on a control inside the row does only its own job", () => {
    expect(rowClickOpens(el("svg", el("a", cell)), row)).toBe(false);          // print icon
    expect(rowClickOpens(el("button", cell), row)).toBe(false);                // pencil / Open ›
    expect(rowClickOpens(el("span", el("button", cell, { role: "switch" })), row)).toBe(false);
    expect(rowClickOpens(el("div", cell, { "data-row-ignore": "" }), row)).toBe(false);
  });
  it("a click in a dialog opened from the row (a portal, outside the row in the DOM) does nothing", () => {
    expect(rowClickOpens(el("div", el("body")), row)).toBe(false);
    expect(rowClickOpens(null, row)).toBe(false);
  });
  it("Enter opens only when the row itself has focus", () => {
    expect(rowKeyOpens("Enter", row, row)).toBe(true);
    expect(rowKeyOpens("Enter", cell, row)).toBe(false);
    expect(rowKeyOpens(" ", row, row)).toBe(false);
  });
});

describe("undoReviewBlocked (owner decision, Oct 19: undo while the note is not in an approved or billed bill)", () => {
  const rev = { status: "reviewed", billable: true };
  it("allowed: reviewed, in no bill or in an open (draft) bill", () => {
    expect(undoReviewBlocked(rev, null, false)).toBeNull();
    expect(undoReviewBlocked(rev, "open", false)).toBeNull();
  });
  it("blocked with the reason", () => {
    expect(undoReviewBlocked(rev, "reviewed", true)).toMatch(/week is approved/);
    expect(undoReviewBlocked(rev, "open", true)).toMatch(/week is approved/);
    expect(undoReviewBlocked(rev, "billed", true)).toMatch(/billed/);
    expect(undoReviewBlocked({ status: "billed", billable: true }, "billed", true)).toMatch(/billed/);
    expect(undoReviewBlocked({ status: "submitted", billable: true }, null, false)).toMatch(/Only a reviewed note/);
    expect(undoReviewBlocked({ status: "reviewed", billable: false }, null, false)).toMatch(/not billable/);
  });
});

describe("undoneReviews (the history read has no undo event)", () => {
  const h = (...ev: string[]) => ev.map((e) => ({ event: `progress_note_${e}`, at: "2026-10-19T14:00:00Z", by: null, resubmission: null, billable: null, reason: null })) as StaffHistory[];
  it("a review followed by another review or a return was undone", () => {
    expect([...undoneReviews(h("created", "submitted", "reviewed", "reviewed"), "reviewed")]).toEqual([2]);
    expect([...undoneReviews(h("created", "submitted", "reviewed", "returned", "submitted", "reviewed"), "reviewed")]).toEqual([2]);
  });
  it("the last review of a note that is no longer reviewed was undone; a current review is not", () => {
    expect([...undoneReviews(h("created", "submitted", "reviewed"), "submitted")]).toEqual([2]);
    expect([...undoneReviews(h("created", "submitted", "reviewed"), "reviewed")]).toEqual([]);
    expect([...undoneReviews(h("created", "submitted", "reviewed"), "billed")]).toEqual([]);
    expect([...undoneReviews(h("created", "submitted", "returned", "submitted", "reviewed"), "reviewed")]).toEqual([]);
  });
});