// components/console/RailGlyph.tsx
//
// A tiny schematic of the console, used inside the placement picker's three
// option cards. It draws the same four regions every time — left rail, map,
// bottom rail, right rail — and fills in the one `rail` names as the accent so
// "Right rail" reads as a picture as well as a word. Purely decorative: the
// button around it carries the real label, so this is `aria-hidden`.

import type { SegmentId } from "@/lib/console/types";

export default function RailGlyph({ rail }: { rail: SegmentId }) {
  const fill = (region: SegmentId) => (region === rail ? "var(--tnx-accent)" : "var(--tnx-panel)");
  const stroke = (region: SegmentId) => (region === rail ? "none" : "var(--tnx-line-strong)");

  return (
    <svg viewBox="0 0 44 30" aria-hidden="true" focusable="false">
      <rect x={2} y={2} width={40} height={26} fill="none" stroke="currentColor" strokeWidth={2.4} />
      <rect x={5} y={5} width={7} height={20} fill={fill("left")} stroke={stroke("left")} strokeWidth={1} />
      <rect x={13} y={5} width={18} height={12} fill="var(--tnx-ink-ghost)" />
      <rect x={13} y={18} width={18} height={7} fill={fill("bottom")} stroke={stroke("bottom")} strokeWidth={1} />
      <rect x={32} y={5} width={7} height={20} fill={fill("right")} stroke={stroke("right")} strokeWidth={1} />
    </svg>
  );
}
