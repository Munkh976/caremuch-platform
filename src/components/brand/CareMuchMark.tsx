import { useId } from "react";

/** The heart path of the CareMuch mark (variant D, docs/design/website/caremuch-logo.dc.html). */
export const HEART_PATH =
  "M16 28.5C6.5 22 2 16.5 2 10.8 2 6.9 5.1 4 8.8 4c3 0 5.4 1.7 7.2 4.3C17.8 5.7 20.2 4 23.2 4 26.9 4 30 6.9 30 10.8c0 5.7-4.5 11.2-14 17.7z";

/**
 * The CareMuch mark: a heart leaning 21° right, sky-to-care-blue body, sunrise glow in the upper-left, thin blue rim.
 * Gradient ids come from useId() so several marks on one page don't collide. Pass `title` for a labelled image, or
 * nothing for a decorative mark (aria-hidden).
 */
export function CareMuchMark({ size = 36, title, className }: { size?: number; title?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const body = `cmB${id}`, glow = `cmW${id}`;
  return (
    <svg width={size} height={size} viewBox="-3 -3 38 38" className={className}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false })}>
      <defs>
        <linearGradient id={body} x1="0.15" y1="0.1" x2="0.85" y2="1">
          <stop offset="0" stopColor="#4AAEF0" />
          <stop offset="0.55" stopColor="#2E88D6" />
          <stop offset="1" stopColor="#1D6FB8" />
        </linearGradient>
        <radialGradient id={glow} cx="0.25" cy="0.24" r="0.36">
          <stop offset="0" stopColor="#FFC566" />
          <stop offset="0.32" stopColor="#FFA23E" stopOpacity="0.95" />
          <stop offset="0.65" stopColor="#FFA552" stopOpacity="0.42" />
          <stop offset="1" stopColor="#FFB870" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="rotate(21 16 16)">
        <path d={HEART_PATH} fill={`url(#${body})`} />
        <path d={HEART_PATH} fill={`url(#${glow})`} />
        <path d={HEART_PATH} fill="none" stroke={`url(#${body})`} strokeWidth="1.8" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
