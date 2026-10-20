/**
 * Clickable list rows (demo UX, Oct 19): the whole row opens the record, like its "Open ›" button.
 * A click on a control inside the row (link, button, switch, checkbox, input, print / pencil icon) does only
 * that control's job, and so does a click inside a dialog opened from the row (React bubbles portal events
 * through the row, but the dialog is not inside the row in the DOM).
 */
const CONTROLS = 'a,button,input,select,textarea,label,[role="button"],[role="checkbox"],[role="switch"],[role="menuitem"],[data-row-ignore]';

interface ElLike { closest(sel: string): ElLike | null; contains(other: unknown): boolean }

/** Does a click on `target` inside `row` open the row? */
export function rowClickOpens(target: unknown, row: ElLike): boolean {
  const t = target as ElLike | null;
  if (!t || typeof t.closest !== "function" || !row.contains(t)) return false;
  const control = t.closest(CONTROLS);
  return !control || control === row || !row.contains(control);
}

/** Enter on the focused row itself (not on a button inside it) opens it. */
export const rowKeyOpens = (key: string, target: unknown, row: unknown) => key === "Enter" && target === row;

export const ROW_OPEN_CLASS = "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** Props for a row or card that opens `open()`: pointer, hover background, focusable, Enter. */
export function rowOpenProps(open: () => void) {
  return {
    tabIndex: 0,
    "data-row-open": "",
    className: ROW_OPEN_CLASS,
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (rowClickOpens(e.target, e.currentTarget as ElLike)) open(); },
    onKeyDown: (e: { key: string; target: unknown; currentTarget: unknown; preventDefault(): void }) => {
      if (rowKeyOpens(e.key, e.target, e.currentTarget)) { e.preventDefault(); open(); }
    },
  };
}
