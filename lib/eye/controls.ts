// The God's eye view's control hint: a small plate that says how to move the view,
// in the person's own input. Pure: no React, no DOM, so the rules are tested in
// tests/unit/eye-controls.test.ts and ControlHint.tsx only wires them to the page.
//
// THE WORDS LIVE HERE. components/eye/EyeHud.tsx says every word comes from
// lib/eye/wording.ts; the hint is the one exception, because it is its own small piece
// with its own tests. Nothing else in the frame reads these strings.
//
// TWO RULES THAT ARE NOT STYLE:
//   1. The key is Ctrl, never the Command key. On a Mac a Command + drag only pans;
//      MapLibre turns the view with Ctrl + drag or the right button. So these words
//      must NEVER go through formatChord in lib/shell/keymap.ts, which prints "ctrl"
//      as the Command sign on a Mac.
//   2. TOUCH_QUERY picks the WORDS, by input: a phone or a tablet has only a finger.
//      The phone LAYOUT is a different question (the screen's shape, PORTRAIT_QUERY in
//      EyeApp.tsx), and the two are allowed to disagree: a tablet is wide and touch.

export type HintKind = "mouse" | "touch" | "touch-desktop";

/** Only a finger: phones and tablets. GEV's phone LAYOUT is screen shape (PORTRAIT_QUERY
 *  in EyeApp.tsx); this picks the WORDS, by input. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
/** How long the plate stays after the first move of the view (or the touch that swapped it). */
export const FADE_AFTER_MS = 5000;
/** How long the plate takes to fade out before it leaves the page. */
export const FADE_OUT_MS = 300;

/** Leon's line, verbatim. A straight apostrophe (U+0027). Do not "fix" it. */
export const TOUCH_ON_DESKTOP_LINE = "It appears you're using touch controls.";
/** The plate's aria-label. */
export const HINT_NAME = "How to move the view";
/** The x button's aria-label. */
export const CLOSE_NAME = "Close this hint";

export interface HintRow {
  does: "Move" | "Zoom" | "Turn" | "Tilt";
  how: string;
  /** Each one is drawn as a <kbd>. */
  keys?: readonly string[];
  /** Plain words instead of keys. */
  keysText?: string;
}

export interface HintCopy {
  lead?: string;
  rows: readonly HintRow[];
  /** "No right button? Hold [Ctrl] and drag." */
  note?: { before: string; key: string; after: string };
}

const MOUSE: HintCopy = {
  rows: [
    { does: "Move", how: "Drag", keysText: "Arrow keys" },
    { does: "Zoom", how: "Scroll", keys: ["+", "−"] },
    { does: "Turn", how: "Right-click and drag sideways", keys: ["Shift", "←", "→"] },
    { does: "Tilt", how: "Right-click and drag up or down", keys: ["Shift", "↑", "↓"] },
  ],
  note: { before: "No right button? Hold ", key: "Ctrl", after: " and drag." },
};

const TOUCH_ROWS: readonly HintRow[] = [
  { does: "Move", how: "Drag with one finger" },
  { does: "Zoom", how: "Pinch" },
  { does: "Turn", how: "Twist with two fingers" },
  { does: "Tilt", how: "Slide two fingers up or down" },
];

const TOUCH: HintCopy = { rows: TOUCH_ROWS };
const TOUCH_DESKTOP: HintCopy = { lead: TOUCH_ON_DESKTOP_LINE, rows: TOUCH_ROWS };

export function hintCopy(kind: HintKind): HintCopy {
  if (kind === "mouse") return MOUSE;
  if (kind === "touch") return TOUCH;
  return TOUCH_DESKTOP;
}

export interface HintState {
  kind: HintKind;
  /** The plate is wanted on the page. */
  shown: boolean;
  /** The 5 s wait has begun: the person has moved the view (or lifted the swapping touch). */
  armed: boolean;
  /** The touch-on-a-desktop line has been given once this visit. */
  switched: boolean;
}

export type HintEvent =
  /** A move the PERSON made ended (a drag, inertia, the wheel, keys, a tap). */
  | { type: "move-end" }
  /** Any pointerdown on the page. */
  | { type: "press"; pointerType: string }
  /** The last touch pointer went up or was cancelled. */
  | { type: "touches-lifted" }
  | { type: "timeout" }
  | { type: "close" }
  | { type: "panel-open" };

export function initialHint(onlyTouch: boolean): HintState {
  return { kind: onlyTouch ? "touch" : "mouse", shown: true, armed: false, switched: false };
}

const HIDDEN = { shown: false, armed: false } as const;

/** Returns the SAME object when nothing changes, so React skips the render. */
export function hintReducer(s: HintState, e: HintEvent): HintState {
  switch (e.type) {
    case "move-end":
      return s.shown && !s.armed ? { ...s, armed: true } : s;
    case "press":
      // The first touch on a mouse desktop, even if the mouse plate was closed or had
      // faded. Pen and mouse never switch, a touch device never gets the line, and a
      // second touch never brings it back.
      if (s.kind === "mouse" && e.pointerType === "touch" && !s.switched) {
        return { kind: "touch-desktop", shown: true, armed: false, switched: true };
      }
      return s;
    case "touches-lifted":
      return s.kind === "touch-desktop" && s.shown && !s.armed ? { ...s, armed: true } : s;
    case "timeout":
    case "close":
    case "panel-open":
      return s.shown || s.armed ? { ...s, ...HIDDEN } : s;
  }
}
