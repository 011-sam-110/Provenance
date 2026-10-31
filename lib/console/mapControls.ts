// The words in the sidebar's Controls popover: how to move the map, and which keys do what.
//
// EVERY ROW IS TRUE OF THIS CONSOLE, because each one has a source. The keys come from the
// visitor's own keymap, since they can rebind them in Settings, so a typed "Ctrl+K" would be
// false for anyone who has. The gestures are MapLibre's defaults, which WorldMap leaves on
// (it only turns box zoom off for the length of a draw), plus the two this console adds: a
// right-click opens "Add pin here" and a click on a mark opens the Inspector.
//
// Pure, so the rows can be read and tested with no DOM. The component is
// components/shell/ConsoleSidebar.tsx.

import { FIXED_KEYS, KEY_ACTIONS, formatChord, type Keymap } from "@/lib/shell/keymap";

export interface ControlRow {
  /** What happens. */
  does: string;
  /** What to press or do. */
  how: string;
}

export interface ControlGroup {
  /** The CSS shows "touch" on a touch screen and the other two where a pointer can hover. */
  id: "mouse" | "touch" | "keys";
  title: string;
  rows: ControlRow[];
}

const MOUSE: ControlRow[] = [
  { does: "Move the map", how: "Drag" },
  { does: "Zoom", how: "Scroll, or double-click" },
  { does: "Turn and tilt", how: "Right-drag, or Ctrl + drag" },
  { does: "Zoom to a box", how: "Shift + drag" },
  { does: "Add a pin", how: "Right-click" },
  { does: "Inspect a mark", how: "Click it" },
];

const TOUCH: ControlRow[] = [
  { does: "Move the map", how: "Drag" },
  { does: "Zoom", how: "Pinch" },
  { does: "Turn", how: "Twist two fingers" },
  { does: "Tilt", how: "Drag two fingers up or down" },
  { does: "Inspect a mark", how: "Tap it" },
];

/** The chords of one action as printed. An action can be left with no key at all. */
function chordsText(chords: readonly string[], mac: boolean): string {
  if (chords.length === 0) return "No key set";
  return chords.map((c) => formatChord(c, mac)).join(" or ");
}

/** Pure: the popover's rows for this visitor's keymap. */
export function mapControlGroups(keymap: Keymap, mac: boolean): ControlGroup[] {
  const esc = FIXED_KEYS.find((k) => k.chords.includes("escape") && k.where === "console");
  return [
    { id: "mouse", title: "Mouse", rows: MOUSE },
    { id: "touch", title: "Touch", rows: TOUCH },
    {
      id: "keys",
      title: "Keys",
      rows: [
        ...KEY_ACTIONS.map((a) => ({ does: a.label, how: chordsText(keymap[a.id], mac) })),
        { does: "Close or step back", how: esc?.keys ?? "Esc" },
      ],
    },
  ];
}
