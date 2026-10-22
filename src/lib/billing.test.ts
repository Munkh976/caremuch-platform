import { describe, expect, it } from "vitest";
import { addDays, approveBlockers, batchName, billingCsv, billingDaysCsv, byClient, csvDaysFileName, csvFileName, newestBatch, type BillBatch, type BillingWeek, type BillLine, type DayBatch } from "./billing";

const line = (client: string, first: string, auth: string, s: number, b: number, l: number): BillLine => ({
  client_id: client, client_first_name: first, client_last_initial: "N", case_number: "ISK-1",
  authorization: { id: auth, auth_number: auth, service_type: "cls", service_code: "H2015", effective_date: "2026-09-01", expiration_date: "2026-12-01",
    units_authorized: 40, units_left: 20, period_type: "per_week", units_per_period: 16, period_left: 8 },
  units_scheduled: s, units_billed: b, units_lost_late: l, notes: [] });
const batch = (p: Partial<BillBatch>): BillBatch => ({ id: "b0", supplement: 0, status: "open", approved_at: null, approved_by_name: null, billed_at: null, billed_by_name: null,
  lines: [line("c1", "Zoe", "A-1", 8, 7, 1), line("c1", "Zoe", "A-2", 4, 4, 0), line("c2", "Max", "A-3", 4, 4, 0)],
  totals: { notes: 4, units_scheduled: 16, units_billed: 15, units_lost_late: 1, approved: 0 }, ...p });
const week = (p: Partial<BillingWeek>): BillingWeek => ({
  office: { id: "o", name: "Portage, MI", code: "RE-PORT", timezone: "America/New_York", billing_week_start: 1 },
  today: "2026-10-06", current_week_start: "2026-10-05", last_complete_week_start: "2026-09-28", week_start: "2026-09-28", week_end: "2026-10-04", complete: true,
  next_action: "rebuild", waiting_for_supplement: 0, batches: [batch({})], excluded: [], pending_review: 0, ...p });

describe("weekly billing helpers", () => {
  it("groups lines by client with per-client totals", () => {
    const g = byClient(batch({}).lines);
    expect(g.map((c) => `${c.name}:${c.totals.s}/${c.totals.b}/${c.totals.l}`)).toEqual(["Zoe N.:12/11/1", "Max N.:4/4/0"]);
  });
  it("CSV per bill: one row per client x authorization plus a total that equals the bill totals; units only; quoted commas", () => {
    const w = week({}); const csv = billingCsv(w, w.batches[0]);
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("Units not billed (late / early)");
    expect(rows[1]).toContain('"Portage, MI"');
    expect(rows[4].split(",").slice(-4)).toEqual(["4", "16", "15", "1"]);
    expect(csv).not.toMatch(/\$|dollar|rate/i);
  });
  it("file name carries the office code, the week and the supplement number, never a client", () => {
    const w = week({});
    expect(csvFileName(w, batch({}))).toBe("ripple-billing-re-port-2026-09-28.csv");
    expect(csvFileName(w, batch({ supplement: 1 }))).toBe("ripple-billing-re-port-2026-09-28-s1.csv");
    expect(csvFileName(week({ office: { id: "o", name: "x", code: null, timezone: "t", billing_week_start: 1 } }), batch({ supplement: 2 }))).toBe("ripple-billing-office-2026-09-28-s2.csv");
  });
  it("Approve is blocked until the bill is complete and nothing waits for review", () => {
    const w = week({});
    expect(approveBlockers(w, w.batches[0])).toEqual([]);
    expect(approveBlockers(week({ batches: [] }), null)[0]).toMatch(/Build the week/);
    expect(approveBlockers(week({ pending_review: 2 }), w.batches[0])[0]).toMatch(/2 notes are submitted/);
    expect(approveBlockers(week({ excluded: [{ reason: "not_in_bill_yet" } as never] }), w.batches[0])[0]).toMatch(/build the week again/);
    expect(approveBlockers(w, batch({ status: "billed" }))).toEqual([]);
  });
  it("the newest bill and the bill names (main, supplements)", () => {
    const w = week({ batches: [batch({ status: "billed" }), batch({ id: "b1", supplement: 1 })] });
    expect(newestBatch(w)?.id).toBe("b1");
    expect(w.batches.map(batchName)).toEqual(["Main bill", "Supplement 1"]);
    expect(newestBatch(week({ batches: [] }))).toBeNull();
  });
  it("weeks step by 7 days across a month boundary", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-10-05", -7)).toBe("2026-09-28");
  });
});

describe("bill by day of service (S18)", () => {
  const dl = (date: string, s: number, b: number, adjusted = false, late = false) => ({ client_id: "c1", client_first_name: "Zoe", client_last_initial: "N", case_number: "ISK-1", service_date: date,
    authorization: { id: "A-1", auth_number: "A-1", service_type: "cls", service_code: "H2015" }, units_scheduled: s, units_billed: b, late, left_early: false, adjusted, notes: [] });
  const days: DayBatch = { id: "b0", supplement: 0, status: "approved", lines: [dl("2026-09-28", 4, 4), dl("2026-09-29", 4, 3, false, true), dl("2026-09-30", 4, 4, true)], totals: { notes: 3, units_scheduled: 12, units_billed: 11 } };
  it("one row per day, a total row; adjusted and late marked; units only", () => {
    const rows = billingDaysCsv(week({}), days).trim().split("\r\n");
    expect(rows).toHaveLength(5);
    expect(rows[2]).toContain("2026-09-29"); expect(rows[2]).toMatch(/,late$/);
    expect(rows[3]).toMatch(/,4,4,yes,$/);
    expect(rows[4]).toContain("TOTAL"); expect(rows[4]).toContain(",3,12,11,");
    expect(rows.join()).not.toMatch(/\$|Nguyen/);
  });
  it("file name says by day", () => {
    expect(csvDaysFileName(week({}), { supplement: 1 })).toBe("ripple-billing-re-port-2026-09-28-s1-by-day.csv");
  });
});
