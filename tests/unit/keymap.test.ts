import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYMAP,
  KEY_ACTIONS,
  RESERVED_CHORDS,
  actionFor,
  bindChord,
  chordOf,
  coerceKeymap,
  formatChord,
  type Keymap,
} from "@/lib/shell/keymap";

// The console's shortcuts are the user's, so the interesting behaviour is not "does
// Ctrl+K open Sources" — the e2e suite watches that — it is what happens when someone
// rebinds. Every rule below is pure and testable with no DOM, which is the reason the
// chord is a normalised string rather than a {key, ctrl, meta} record.

/** A keyboard event, minus everything `chordOf` does not read. */
const ev = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}, code?: string) =>
  ({ key, code, ...mods });

describe("reading a chord off a key event", () => {
  it("normalises case, so K and k are one binding", () => {
    expect(chordOf(ev("K", { ctrlKey: true }))).toBe("ctrl+k");
    expect(chordOf(ev("k", { ctrlKey: true }))).toBe("ctrl+k");
  });

  it("FOLDS ⌘ INTO CTRL — a Mac config must survive being opened on a PC", () => {
    // The whole reason the stored value is "ctrl+k" and not "meta+k". If these two ever
    // diverge, a user's keymap breaks when they change machine and nothing explains it.
    expect(chordOf(ev("k", { metaKey: true }))).toBe("ctrl+k");
    expect(chordOf(ev("k", { ctrlKey: true }))).toBe(chordOf(ev("k", { metaKey: true })));
  });

  it("reads Space from e.code, never from the literal \" \" in e.key", () => {
    expect(chordOf(ev(" ", { ctrlKey: true }, "Space"))).toBe("ctrl+space");
  });

  it("orders modifiers, so one gesture cannot become two strings", () => {
    expect(chordOf(ev("F1", { ctrlKey: true, altKey: true, shiftKey: true }))).toBe("ctrl+alt+shift+f1");
  });

  it("does not add shift to a character that already carries it", () => {
    // UK layout: Shift+; produces ":". Recording "shift+:" would never match again,
    // because the next press reports ":" with shiftKey true and the shift consumed.
    expect(chordOf(ev(":", { shiftKey: true }))).toBe(":");
  });

  it("a bare modifier is NOT a chord — this is what stops a rebind committing early", () => {
    for (const k of ["Control", "Meta", "Alt", "Shift", ""]) {
      expect(chordOf(ev(k, { ctrlKey: true })), k).toBeNull();
    }
  });
});

describe("printing a chord", () => {
  it("prints the platform's own modifier, from one stored string", () => {
    expect(formatChord("ctrl+k")).toBe("Ctrl+K");
    expect(formatChord("ctrl+k", true)).toBe("⌘K");
    expect(formatChord("ctrl+space")).toBe("Ctrl+Space");
    expect(formatChord(";")).toBe(";");
  });
});

describe("dispatch", () => {
  it("finds the action a chord runs, and answers null for one nothing holds", () => {
    expect(actionFor("ctrl+k", DEFAULT_KEYMAP)).toBe("sources");
    expect(actionFor(";", DEFAULT_KEYMAP)).toBe("search");
    expect(actionFor("ctrl+q", DEFAULT_KEYMAP)).toBe("draw");
    expect(actionFor("ctrl+j", DEFAULT_KEYMAP)).toBeNull();
    expect(actionFor(null, DEFAULT_KEYMAP)).toBeNull();
  });

  it("every default binding reaches the action it was written for", () => {
    // Cheap guard against a default being added to the map and never dispatching —
    // the failure mode is a shortcut documented in Settings that does nothing.
    for (const a of KEY_ACTIONS) {
      for (const c of DEFAULT_KEYMAP[a.id]) expect(actionFor(c, DEFAULT_KEYMAP), c).toBe(a.id);
    }
  });

  it("no chord is claimed by two actions in the defaults", () => {
    const all = KEY_ACTIONS.flatMap((a) => DEFAULT_KEYMAP[a.id]);
    expect(new Set(all).size).toBe(all.length);
  });
});

const fresh = (): Keymap => ({
  search: [...DEFAULT_KEYMAP.search],
  sources: [...DEFAULT_KEYMAP.sources],
  draw: [...DEFAULT_KEYMAP.draw],
});

describe("rebinding", () => {
  it("replaces the chord in the slot it was given, and leaves the other slot alone", () => {
    const r = bindChord(fresh(), "search", 1, "ctrl+/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.map.search).toEqual(["ctrl+space", "ctrl+/"]);
    expect(r.map.sources).toEqual(["ctrl+k"]);
  });

  it("appends when the slot is past the end", () => {
    const r = bindChord(fresh(), "sources", 1, "ctrl+b");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.map.sources).toEqual(["ctrl+k", "ctrl+b"]);
  });

  it("TAKING A CHORD MOVES IT — it never leaves two actions on one key", () => {
    // The rule this file exists for. Search has two bindings, so ";" can be taken from
    // it; if the chord stayed in both, the second action would be dead and nothing on
    // screen would say which one won.
    const r = bindChord(fresh(), "draw", 0, ";");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.map.draw).toEqual([";"]);
    expect(r.map.search).toEqual(["ctrl+space"]);
    expect(actionFor(";", r.map)).toBe("draw");
  });

  it("REFUSES a move that would leave the other action unreachable, and names it", () => {
    // Sources holds exactly one chord. Taking it would leave an action with no key and
    // no way to notice, which is worse than a rejected keystroke.
    const r = bindChord(fresh(), "draw", 0, "ctrl+k");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("Sources rail");
    expect(r.reason).toContain("Ctrl+K");
  });

  it("rebinding a chord onto its own slot is a no-op, not a self-orphaning refusal", () => {
    const map = fresh();
    const r = bindChord(map, "sources", 0, "ctrl+k");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.map).toBe(map);
  });

  it("refuses the browser's own keys", () => {
    for (const c of ["ctrl+c", "ctrl+w", "f5", "tab"]) {
      const r = bindChord(fresh(), "draw", 0, c);
      expect(r.ok, c).toBe(false);
      if (!r.ok) expect(r.reason).toContain("reserved");
    }
  });

  it("does not mutate the map it was given", () => {
    const map = fresh();
    bindChord(map, "search", 0, "ctrl+g");
    expect(map.search).toEqual(DEFAULT_KEYMAP.search);
  });
});

describe("reading a persisted keymap", () => {
  it("returns the defaults for nothing, junk, and the wrong shape", () => {
    for (const junk of [null, undefined, 42, "keymap", []]) {
      expect(coerceKeymap(junk), `${JSON.stringify(junk)}`).toEqual(DEFAULT_KEYMAP);
    }
  });

  it("keeps a stored binding", () => {
    const m = coerceKeymap({ search: ["ctrl+g"], sources: ["ctrl+k"], draw: ["ctrl+q"] });
    expect(m.search).toEqual(["ctrl+g"]);
  });

  it("AN EMPTY ACTION FALLS BACK TO ITS DEFAULT rather than staying unreachable", () => {
    // localStorage is user-writable and this decides whether a control can be reached
    // from the keyboard at all. A shortcut nobody asked for is the safe failure; a
    // console where Sources has no key and nothing says why is not.
    const m = coerceKeymap({ search: [], sources: null, draw: ["ctrl+q"] });
    expect(m.search).toEqual(DEFAULT_KEYMAP.search);
    expect(m.sources).toEqual(DEFAULT_KEYMAP.sources);
    expect(m.draw).toEqual(["ctrl+q"]);
  });

  it("drops a reserved chord that was written into storage by hand", () => {
    const m = coerceKeymap({ search: ["ctrl+c", "ctrl+g"], sources: ["ctrl+k"], draw: ["ctrl+q"] });
    expect(m.search).toEqual(["ctrl+g"]);
    expect(RESERVED_CHORDS.some((c) => m.search.includes(c))).toBe(false);
  });

  it("a stored map with every action emptied still runs the whole default set", () => {
    expect(coerceKeymap({ search: [], sources: [], draw: [] })).toEqual(DEFAULT_KEYMAP);
  });
});
