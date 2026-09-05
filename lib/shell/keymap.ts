"use client";
// THE CONSOLE'S KEYBOARD SHORTCUTS, AND THE FACT THAT THEY ARE THE USER'S.
//
// Three actions, four default bindings, all rebindable and all persisted. Same store
// shape as every other shell store here — module state, a listener set, and
// useSyncExternalStore — so it reads like lib/shell/scope.ts rather than introducing
// a fourth way to hold shell state. Nothing touches window/document at module scope:
// `hydrate()` is called from an effect, so importing this on the server or in the
// node vitest environment is inert.
//
// WHY A CHORD IS A STRING AND NOT AN OBJECT. Every binding normalises to one lowercase
// token — "ctrl+k", "ctrl+space", ";" — which makes the whole system comparable with
// `===`, storable as JSON, printable in the UI with no formatter, and testable without
// a DOM. The alternative, a {key, ctrl, meta, alt, shift} record, needs an equality
// function that four call sites would each get subtly wrong.
//
// META IS FOLDED INTO CTRL, DELIBERATELY. `chordOf` reports ⌘K on a Mac and Ctrl+K on
// Windows as the same "ctrl+k". A keymap that made those two different bindings would
// mean a Mac user's stored config broke when they opened the same console on a PC, and
// nobody in this product ever wants Ctrl and ⌘ to do different things. The UI prints
// the right symbol for the platform; the STORED value is one string.
//
// SPACE COMES FROM `e.code`, NOT `e.key`. `e.key` for that chord is a literal " ", so a
// map keyed on it contains an entry that looks like a typo and compares equal to an
// accidental blank. `e.code === "Space"` is unambiguous and is also layout-independent.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const PERSIST_KEY = "tn.keymap.v1";
const PERSIST_VERSION = 1;

/** What a shortcut can do. Adding one here is the only edit a new shortcut needs. */
export type KeyAction = "search" | "sources" | "draw";

export type Keymap = Record<KeyAction, string[]>;

/**
 * What each action is called, and what it says it does.
 *
 * Held HERE rather than in the settings component so the label the user rebinds is
 * the same string the palette and any future hint bar print. Two copies of "Search
 * the map" is how a rename becomes a lie in one of the two places.
 */
export const KEY_ACTIONS: { id: KeyAction; label: string; hint: string }[] = [
  { id: "search", label: "Search the map", hint: "Opens the rail's Search group, focused" },
  { id: "sources", label: "Sources rail", hint: "Opens or closes the sources panel" },
  { id: "draw", label: "Draw an area", hint: "Arms the polygon tool on the map" },
];

/**
 * The defaults.
 *
 * SEARCH HAS TWO, and that is not indecision. Ctrl+Space is an IME switch on some
 * systems and is swallowed before the page ever sees it, so it can never be the only
 * way to reach an action; ";" is the single-key door that always works. The same
 * reasoning is why "/" is NOT here any more — it was the previous search key and it
 * shadows Firefox's quick-find, which is a browser default worth leaving alone now
 * that a plain ";" does the job.
 */
export const DEFAULT_KEYMAP: Keymap = {
  search: ["ctrl+space", ";"],
  sources: ["ctrl+k"],
  draw: ["ctrl+q"],
};

/**
 * Chords the console will not let you bind, whatever you type.
 *
 * Escape is not on this list because it is not in the keymap at all: it is a
 * close/cancel gesture sequenced by hand in ConsoleShell (picking mode, then the
 * selection) and by every dialog, and making it rebindable would let a user lock
 * themselves inside a panel. These are the ones a user CAN type into the field and
 * must be refused.
 */
export const RESERVED_CHORDS: readonly string[] = [
  "ctrl+c",
  "ctrl+v",
  "ctrl+x",
  "ctrl+a",
  "ctrl+z",
  "ctrl+r",
  "ctrl+t",
  "ctrl+w",
  "ctrl+n",
  "ctrl+p",
  "ctrl+s",
  "ctrl+f",
  "f5",
  "tab",
  "escape",
  "enter",
];

/**
 * Pure: a keyboard event → its canonical chord, or null if it is only a modifier.
 *
 * Order is fixed (ctrl, alt, shift) so "shift+ctrl+k" and "ctrl+shift+k" can never be
 * two different strings for one gesture. A bare modifier press returns null rather
 * than "ctrl+", which is what stops the rebind field committing the instant a user
 * reaches for a chord.
 */
export function chordOf(e: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string | null {
  const key = e.code === "Space" ? "space" : e.key.toLowerCase();
  if (key === "control" || key === "meta" || key === "alt" || key === "shift" || key === "") {
    return null;
  }
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  // Shift is only a modifier when it is not already expressed by the character. On a
  // UK layout Shift+; produces ":", and recording that as "shift+:" would never match
  // again, because the next press reports the same ":" with shiftKey true and the
  // character already shifted.
  if (e.shiftKey && key.length > 1) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/**
 * Is this a Mac? Read at CALL TIME, never at module scope.
 *
 * `navigator` does not exist on the server or under the node vitest environment, and
 * this module is imported by both. Kept here rather than re-derived at each call site
 * so the two places that print a chord cannot disagree about what a Mac is.
 */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
}

/** Pure: how a chord is printed. ⌘ on a Mac, Ctrl everywhere else. */
export function formatChord(chord: string, mac = false): string {
  return chord
    .split("+")
    .map((p) => {
      if (p === "ctrl") return mac ? "⌘" : "Ctrl";
      if (p === "alt") return mac ? "⌥" : "Alt";
      if (p === "shift") return mac ? "⇧" : "Shift";
      if (p === "space") return "Space";
      return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
    })
    .join(mac ? "" : "+");
}

/** Pure: which action a chord runs, or null. */
export function actionFor(chord: string | null, map: Keymap): KeyAction | null {
  if (!chord) return null;
  for (const a of KEY_ACTIONS) if (map[a.id].includes(chord)) return a.id;
  return null;
}

export type BindResult =
  | { ok: true; map: Keymap }
  | { ok: false; reason: string };

/**
 * Pure: bind `chord` to `action`, replacing the binding at `slot`.
 *
 * REBINDING IS A MOVE, NOT A COPY. Taking a chord that another action holds removes it
 * from that action, because two actions on one key means the second is dead and
 * nothing on screen says which one won. If that would leave the other action with NO
 * binding, the move is refused instead — an action you cannot reach and cannot see is
 * worse than a rejected keystroke, and the refusal names the action so the user can go
 * and rebind that one first.
 */
export function bindChord(
  map: Keymap,
  action: KeyAction,
  slot: number,
  chord: string,
): BindResult {
  if (RESERVED_CHORDS.includes(chord)) {
    return { ok: false, reason: `${formatChord(chord)} is reserved by the browser.` };
  }
  const next: Keymap = { search: [...map.search], sources: [...map.sources], draw: [...map.draw] };

  for (const a of KEY_ACTIONS) {
    const at = next[a.id].indexOf(chord);
    if (at === -1) continue;
    if (a.id === action && at === slot) return { ok: true, map }; // no change
    if (a.id !== action && next[a.id].length === 1) {
      const label = KEY_ACTIONS.find((k) => k.id === a.id)!.label;
      return {
        ok: false,
        reason: `${formatChord(chord)} is the only shortcut for “${label}”. Give that one another key first.`,
      };
    }
    next[a.id] = next[a.id].filter((_, i) => i !== at);
  }

  const slots = next[action];
  if (slot < slots.length) slots[slot] = chord;
  else slots.push(chord);
  return { ok: true, map: next };
}

/** Pure: a persisted value → a keymap we are willing to run. */
export function coerceKeymap(saved: unknown): Keymap {
  const s = saved as Partial<Record<KeyAction, unknown>> | null;
  if (!s || typeof s !== "object") return DEFAULT_KEYMAP;
  const out: Keymap = { search: [], sources: [], draw: [] };
  for (const a of KEY_ACTIONS) {
    const raw = s[a.id];
    const list = Array.isArray(raw)
      ? raw.filter((c): c is string => typeof c === "string" && c.length > 0 && !RESERVED_CHORDS.includes(c))
      : [];
    // AN ACTION WITH NO BINDING FALLS BACK TO ITS DEFAULT rather than staying empty.
    // localStorage is user-writable and this drives whether a control is reachable at
    // all; the safe direction is a shortcut the user did not ask for, not a console
    // where Sources cannot be opened from the keyboard and nothing explains why.
    out[a.id] = list.length > 0 ? list : [...DEFAULT_KEYMAP[a.id]];
  }
  return out;
}

let state: Keymap = DEFAULT_KEYMAP;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const keymapStore = {
  get: (): Keymap => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  hydrate(): void {
    state = coerceKeymap(loadPersisted(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
  bind(action: KeyAction, slot: number, chord: string): BindResult {
    const r = bindChord(state, action, slot, chord);
    if (!r.ok) return r;
    state = r.map;
    savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
    emit();
    return r;
  },
  reset(): void {
    state = { search: [...DEFAULT_KEYMAP.search], sources: [...DEFAULT_KEYMAP.sources], draw: [...DEFAULT_KEYMAP.draw] };
    savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
    emit();
  },
};

export function useKeymap(): Keymap {
  return useSyncExternalStore(keymapStore.subscribe, keymapStore.get, () => DEFAULT_KEYMAP);
}
