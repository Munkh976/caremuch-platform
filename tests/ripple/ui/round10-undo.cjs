// Round 10 --undo (demo UX Part 2): Undo review in the Review panel, on round10.cjs's fixtures (its office, users, notes).
// N4 was reviewed by the API and is in no bill: Undo (Cancel first) -> Submitted, units back, history "Reviewed (later
// undone)", the panel offers Mark reviewed again; reviewed again from the panel; week built (draft bill) -> the confirm
// says the note leaves the draft bill -> undo -> out of the bill; reviewed, rebuilt and approved -> Undo disabled with
// the reason; 390.
module.exports = async function undoFlows({ base, F, browser, rec, admin, must, shot, status, openDetail, settle, ctxFor, login, noHScroll }) {
  const row = async (n) => (await admin.from("progress_notes").select("status, authorization_id, billing_batch_id").eq("id", n).single()).data;
  const avail = async () => Number((await admin.from("service_authorizations").select("units_available").eq("id", F.auth).single()).data.units_available);
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
  const panel = page.locator('[data-testid="review-panel"]');

  await openDetail(page, base, F.N4); await page.locator('[data-testid="undo-review"]:not([disabled])').waitFor({ timeout: 15000 });
  const av0 = await avail();
  await panel.scrollIntoViewIfNeeded(); await shot(page, "undo-button-1440");
  await page.locator('[data-testid="undo-review"]').click(); await page.locator('[data-testid="undo-confirm"]').waitFor(); await settle(page, 500);
  const dlg = await page.locator('[data-testid="undo-confirm"]').innerText(); await shot(page, "undo-confirm-1440");
  await page.locator('[data-testid="cancel-undo"]').click(); await settle(page, 600);
  const afterCancel = await status(F.N4);
  await page.locator('[data-testid="undo-review"]').click(); await page.locator('[data-testid="undo-confirm"]').waitFor();
  await page.locator('[data-testid="confirm-undo"]').click(); await page.locator('[data-testid="review-ack"]').waitFor({ timeout: 20000 }); await settle(page);
  const r1 = await row(F.N4), av1 = await avail();
  const hist = await page.locator('[data-testid="note-history"]').innerText();
  await panel.scrollIntoViewIfNeeded(); await shot(page, "undo-done-submitted-1440");
  rec("U1 reviewed note in no bill: 'Undo review' (secondary) → 'Undo this review?' (Cancel keeps it Reviewed) → confirm → Submitted (DB), authorization cleared, units back (+4); the panel offers the statement and Mark reviewed again; the history marks the review '(later undone)'",
    /Undo this review\?/.test(dlg) && !/draft bill/.test(dlg) && afterCancel === "reviewed" && r1.status === "submitted" && r1.authorization_id === null && av1 === av0 + 4
      && /Reviewed \(later undone\)/.test(hist) && (await page.locator('[data-testid="mark-reviewed"]').isDisabled()),
    `cancel → ${afterCancel}; ${r1.status}; units ${av0} → ${av1}; history "${hist.replace(/\s+/g, " ").slice(0, 120)}"`);

  await page.locator('[data-testid="review-ack"]').click(); await page.locator('[data-testid="mark-reviewed"]').click();
  await page.locator('[data-testid="confirm-review"]').click(); await page.locator('[data-testid="undo-review"]').waitFor({ timeout: 20000 }); await settle(page);
  rec("U2 marked reviewed again from the panel (statement + confirm): Reviewed, units charged again", (await status(F.N4)) === "reviewed" && (await avail()) === av0, `${await status(F.N4)}; units ${await avail()}`);

  const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr);
  await openDetail(mp, base, F.N1); await mp.locator('[data-testid="undo-review"]:not([disabled])').waitFor({ timeout: 15000 });
  await mp.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded(); await settle(mp, 400); await shot(mp, "undo-button-390");
  const fit = await noHScroll(mp);
  await mp.locator('[data-testid="undo-review"]').click(); await mp.locator('[data-testid="undo-confirm"]').waitFor(); await settle(mp, 500); await shot(mp, "undo-confirm-390");
  const fit2 = await noHScroll(mp);
  await mp.locator('[data-testid="cancel-undo"]').click(); await settle(mp, 400);
  const n1After = await status(F.N1);
  // a draft bill for the week (built through the API as the manager)
  const b = await must(F.mgr.c, "build_billing_batch", { _office_id: F.RX, _week_start: F.week });
  await openDetail(page, base, F.N4); await page.locator('[data-testid="undo-review"]:not([disabled])').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="undo-review"]').click(); await page.locator('[data-testid="undo-confirm"]').waitFor(); await settle(page, 500);
  const dlg2 = await page.locator('[data-testid="undo-confirm"]').innerText(); await shot(page, "undo-confirm-draft-bill-1440");
  await page.locator('[data-testid="confirm-undo"]').click(); await page.locator('[data-testid="review-ack"]').waitFor({ timeout: 20000 });
  const r2 = await row(F.N4);
  const wk = await must(F.mgr.c, "get_billing_week", { _office_id: F.RX, _week_start: F.week });
  rec("U3 week built, not approved: the confirm says the note leaves this week's draft bill and the week must be built again; after Undo the note is out of the bill (DB) and Weekly Billing shows it 'not reviewed' (Approve blocked)",
    /leaves this week's draft bill/.test(dlg2) && r2.status === "submitted" && r2.billing_batch_id === null && b.included === 2 && Number(wk.batches[0].totals.notes) === 1
      && wk.excluded.find((x) => x.note_id === F.N4)?.reason === "not_reviewed" && wk.pending_review >= 1,
    `bill ${b.included} → ${wk.batches[0].totals.notes}; reason ${wk.excluded.find((x) => x.note_id === F.N4)?.reason}`);

  // reviewed, rebuilt, approved: Undo disabled with the reason
  await must(F.mgr.c, "review_progress_note", { _note_id: F.N4, _billable: true, _non_billable_reason: null });
  await must(F.mgr.c, "build_billing_batch", { _office_id: F.RX, _week_start: F.week });
  const w2 = await must(F.mgr.c, "get_billing_week", { _office_id: F.RX, _week_start: F.week });
  await must(F.mgr.c, "approve_batch_notes", { _batch_id: w2.batches[0].id, _note_ids: w2.batches[0].lines.flatMap((l) => l.notes.map((n) => n.note_id)) });
  await openDetail(page, base, F.N4); await page.locator('[data-testid="undo-blocked"]').waitFor({ timeout: 15000 }); await settle(page, 400);
  const reason = await page.locator('[data-testid="undo-blocked"]').innerText(), dis = await page.locator('[data-testid="undo-review"]').isDisabled();
  await panel.scrollIntoViewIfNeeded(); await shot(page, "undo-blocked-approved-1440");
  rec("U4 once the week is approved: 'Undo review' is disabled and says why ('This note's week is approved, so its review can't be undone.'); the note stays Reviewed",
    dis && /week is approved/.test(reason) && (await status(F.N4)) === "reviewed", `disabled ${dis}; "${reason}"`);
  await ctx.close();

  await openDetail(mp, base, F.N4); await mp.locator('[data-testid="undo-blocked"]').waitFor({ timeout: 15000 });
  await mp.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded(); await settle(mp, 400); await shot(mp, "undo-blocked-approved-390");
  rec("U5 390: Undo review button and its confirm fit (no horizontal scroll); the approved note's reason is shown under the disabled button; Cancel leaves the note Reviewed",
    fit && fit2 && (await noHScroll(mp)) && n1After === "reviewed", `fit ${fit}/${fit2}; N1 after Cancel ${n1After}`);
  await m.close();
};
