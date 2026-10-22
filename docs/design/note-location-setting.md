# Progress note "Location" as an office setting: approach (for approval)

Status: **PLAN ONLY** (Oct 22). Owner item 5 (Oct 21 night): report the approach before building.

## What exists
- **Location** is a column of the note (`progress_notes.location`, text ≤ 200), written by the caregiver through
  `save_progress_note_draft` (header key `location`) while the note is draft or returned; shown on the review page, the
  staff note detail and the print. It is **not** a template field.
- **`note_layout`** (progress-note shell versions) is a free JSON object with only `billing_footer`, `notes_prompt` and
  `narrative` in use; a published shell may change only `billing_footer` / `notes_prompt` without a new version
  (`cp_check_constrained_edit`). It has **no** defaults or visibility for header fields, and `form_template_fields
  .default_value` applies to template fields, not to the note's own columns. So the template can't carry this without
  changing the constrained-edit rule and the note shells per service; an office setting is simpler and matches the ask.

## Proposal
1. **Office setting** (additive columns on `virtual_office`): `note_location_mode text NOT NULL DEFAULT 'free'`
   (`free` = today: empty, typed by the caregiver; `default` = prefilled with the office's value, editable; `hidden` =
   not shown, stays empty) and `note_location_default text` (≤ 200).
2. **Set it:** `set_office_note_location(_office_id, _mode, _default)` (new, SECURITY DEFINER, agency admin of the office,
   REVOKE / GRANT + aclexplode), audited `office_note_location_changed` (events CHECK: approval). UI: Virtual Offices →
   **Scheduling** (next to the match weights) or the office's **Compliance** tab — owner's choice.
3. **Prefill at creation (server):** `create_progress_note_for_shift` sets `location` to the office default when the mode
   is `default` (existing function: approval; one line, NB1 not affected — notes aren't in the assign path). Existing
   notes are not touched (no backfill); a draft created before the setting keeps its value.
4. **Hidden:** the caregiver note page doesn't show the field (the server still accepts it, so turning it back on loses
   nothing); review, detail and print omit the Location row when the office hides it and the note has none.
5. **Caregiver read:** the caregiver needs the mode on the note page → returned by `get_progress_note_for_caregiver`
   (existing reader: approval) as `location_mode`.
6. **Demo office:** mode `default`, "Ripple Effects Community Inclusion Center" (seed-demo, through the RPC).

## Tests
PGlite (mode / default validation, agency admin only, audit; creation prefills only in `default`; existing notes
unchanged; hidden → caregiver payload says hidden; rollback proof), DEV before / after with NB1, browser (caregiver note
prefilled and editable, hidden at another office, review / print), 1440 / 390; rehearse step for Ana's live note.

## Needs approval
New columns, the new RPC, the event type, and the two existing-function changes (`create_progress_note_for_shift`
prefill; `get_progress_note_for_caregiver` returns the mode). Where the setting lives in the UI.
