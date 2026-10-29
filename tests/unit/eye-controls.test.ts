import { describe, expect, it } from "vitest";
import {
  FADE_AFTER_MS,
  TOUCH_ON_DESKTOP_LINE,
  TOUCH_QUERY,
  hintCopy,
  hintReducer,
  initialHint,
  type HintCopy,
  type HintKind,
  type HintState,
} from "@/lib/eye/controls";

const KINDS: HintKind[] = ["mouse", "touch", "touch-desktop"];

/** Every string a plate can print for a kind, in one list. */
function words(copy: HintCopy): string[] {
  const out: string[] = [];
  if (copy.lead) out.push(copy.lead);
  for (const r of copy.rows) {
    out.push(r.does, r.how);
    if (r.keysText) out.push(r.keysText);
    out.push(...(r.keys ?? []));
  }
  if (copy.note) out.push(copy.note.before, copy.note.key, copy.note.after);
  return out;
}

describe("the starting plate", () => {
  it("asks the browser for a finger and nothing else", () => {
    expect(TOUCH_QUERY).toBe("(hover: none) and (pointer: coarse)");
    expect(FADE_AFTER_MS).toBe(5000);
  });

  it("is the touch plate on a touch device and the mouse plate otherwise, shown either way", () => {
    expect(initialHint(true)).toEqual({ kind: "touch", shown: true, armed: false, switched: false });
    expect(initialHint(false)).toEqual({ kind: "mouse", shown: true, armed: false, switched: false });
  });
});

describe("the first touch on a mouse desktop", () => {
  it("swaps the mouse plate for Leon's line and the finger gestures", () => {
    const s = hintReducer(initialHint(false), { type: "press", pointerType: "touch" });
    expect(s).toEqual({ kind: "touch-desktop", shown: true, armed: false, switched: true });
  });

  it("is not triggered by a mouse or a pen", () => {
    const s = initialHint(false);
    expect(hintReducer(s, { type: "press", pointerType: "mouse" })).toBe(s);
    expect(hintReducer(s, { type: "press", pointerType: "pen" })).toBe(s);
  });

  it("never reaches a touch device, which already has the finger words", () => {
    const s = initialHint(true);
    expect(hintReducer(s, { type: "press", pointerType: "touch" })).toBe(s);
  });

  it("comes once per visit: after it has gone, another touch leaves it hidden", () => {
    let s = hintReducer(initialHint(false), { type: "press", pointerType: "touch" });
    s = hintReducer(s, { type: "timeout" });
    expect(s.shown).toBe(false);
    expect(hintReducer(s, { type: "press", pointerType: "touch" })).toBe(s);
  });

  it("comes even after the mouse plate was closed or had faded", () => {
    const closed = hintReducer(initialHint(false), { type: "close" });
    expect(closed.shown).toBe(false);
    const s = hintReducer(closed, { type: "press", pointerType: "touch" });
    expect(s.kind).toBe("touch-desktop");
    expect(s.shown).toBe(true);
    expect(s.armed).toBe(false);
  });
});

describe("the wait before it fades", () => {
  it("starts at the first move the person makes, and only while the plate shows", () => {
    const armed = hintReducer(initialHint(false), { type: "move-end" });
    expect(armed).toEqual({ kind: "mouse", shown: true, armed: true, switched: false });
    // A second move changes nothing, so React skips the render.
    expect(hintReducer(armed, { type: "move-end" })).toBe(armed);
    // A move after the plate has gone changes nothing either.
    const gone = hintReducer(initialHint(false), { type: "close" });
    expect(hintReducer(gone, { type: "move-end" })).toBe(gone);
  });

  it("starts for the touch that swapped it when that touch lifts, and for no other kind", () => {
    const swapped = hintReducer(initialHint(false), { type: "press", pointerType: "touch" });
    const lifted = hintReducer(swapped, { type: "touches-lifted" });
    expect(lifted.armed).toBe(true);
    expect(hintReducer(lifted, { type: "touches-lifted" })).toBe(lifted);
    for (const s of [initialHint(false), initialHint(true)]) {
      expect(hintReducer(s, { type: "touches-lifted" })).toBe(s);
    }
  });

  it("is ended by a timeout, a close or a panel opening", () => {
    const armed: HintState = { kind: "mouse", shown: true, armed: true, switched: false };
    for (const type of ["timeout", "close", "panel-open"] as const) {
      expect(hintReducer(armed, { type })).toEqual({ kind: "mouse", shown: false, armed: false, switched: false });
      expect(hintReducer(initialHint(true), { type }).shown).toBe(false);
    }
  });

  it("returns the same object when it is already gone", () => {
    const gone = hintReducer(initialHint(false), { type: "close" });
    expect(hintReducer(gone, { type: "timeout" })).toBe(gone);
    expect(hintReducer(gone, { type: "panel-open" })).toBe(gone);
  });
});

describe("the words", () => {
  it("keep Leon's line exactly, with a straight apostrophe", () => {
    expect(TOUCH_ON_DESKTOP_LINE).toBe("It appears you're using touch controls.");
    expect(hintCopy("touch-desktop").lead).toBe(TOUCH_ON_DESKTOP_LINE);
    expect(hintCopy("mouse").lead).toBeUndefined();
    expect(hintCopy("touch").lead).toBeUndefined();
  });

  it("say Ctrl and never the Command key on the mouse plate", () => {
    const mouse = words(hintCopy("mouse")).join(" ");
    expect(mouse).toContain("Ctrl");
    expect(hintCopy("mouse").note?.key).toBe("Ctrl");
    for (const banned of ["⌘", "Cmd", "Command"]) expect(mouse).not.toContain(banned);
  });

  it("give the touch plates the same four finger rows", () => {
    expect(hintCopy("touch").rows).toEqual(hintCopy("touch-desktop").rows);
    const touch = words(hintCopy("touch-desktop")).join(" ");
    expect(touch).toContain("Pinch");
    expect(touch).toContain("Twist with two fingers");
    expect(touch).not.toContain("Ctrl");
  });

  it("list Move, Zoom, Turn, Tilt in that order for every kind", () => {
    for (const kind of KINDS) {
      expect(hintCopy(kind).rows.map((r) => r.does)).toEqual(["Move", "Zoom", "Turn", "Tilt"]);
    }
  });

  it("use no dash", () => {
    for (const kind of KINDS) {
      for (const w of words(hintCopy(kind))) {
        expect(w).not.toContain("—");
        expect(w).not.toContain("–");
      }
    }
  });
});
