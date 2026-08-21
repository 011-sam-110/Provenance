"use client";
// DARK vs LIGHT — the Terminal's skin.
//
// Same shape as lib/terminal/mode.ts (module state + listener set +
// useSyncExternalStore), and for the same reasons: the shell already reasons
// about stores this way, and the two are read side by side in the chrome.
//
// WHY THIS IS NOT A THEME. The app has a theme already — `uiStore.setTheme` and
// `[data-theme]` — and this deliberately does not touch it:
//
//   * app/layout.tsx hard-codes `data-theme="light"` so the SSR markup matches
//     first paint, and
//   * lib/variants/store.ts calls `uiStore.setTheme(v.theme)` on EVERY variant
//     switch, and applyPreset() (i.e. every board tab) marks the variant edited.
//
// So a Terminal skin expressed as a theme would be yanked back to the variant's
// theme by the first board change, which is exactly the trap the dark palette's
// own comment in globals.css documents. The skin is a scoped attribute on the
// `.tn-terminal` element instead: `data-tnx-skin`, read only by the scoped block.
//
// LIGHT IS THE DEFAULT, AND THE OS IS NO LONGER ASKED.
//
// Both halves of that changed together, and the second is a consequence of the
// first rather than a separate decision. The previous default was dark with a
// one-time `prefers-color-scheme` read for visitors who had never touched the
// toggle — added because a working OSINT analyst reviewed the console, wanted the
// light theme that already shipped, and never found the switch. Making light the
// default answers that complaint directly and completely, which leaves the media
// read doing only one thing: sending anyone whose OS is dark back to the skin the
// product no longer opens in. So it is gone.
//
// What is deliberately NOT gone is the persistence. A stored choice still wins
// forever and is still the only value ever written, so "light is standard" is a
// statement about the FIRST visit, not an override of anybody's second one.
//
// Nothing here touches window/document at module scope — `loadPersisted` is only
// reached from `hydrate()`, which callers run inside an effect. Importing this on
// the server, or in the node vitest environment, is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type TerminalSkin = "dark" | "light";

/** Light is the default. The Terminal was designed as dark OSINT chrome and shipped
 *  that way, but the skin is a reading surface people sit in front of for hours and
 *  the review feedback ran one direction only. The choice persists, so anyone who
 *  wants the dark chrome picks it once. */
export const DEFAULT_TERMINAL_SKIN: TerminalSkin = "light";

/** Narrow an untrusted value (persisted JSON, a URL param) to a TerminalSkin. */
export function coerceTerminalSkin(v: unknown): TerminalSkin {
  return v === "light" || v === "dark" ? v : DEFAULT_TERMINAL_SKIN;
}

/**
 * The basemap a skin implies.
 *
 * Not cosmetic: the Terminal pins CARTO Dark Matter, and a near-white console
 * wrapped around a near-black map is the single most obviously wrong thing a
 * light skin could ship with. `positron` already exists in lib/basemaps.ts and is
 * described there as "the calm light default", so light has a real target rather
 * than a tinted dark one. Exported as a pure function so the mapping is testable
 * without a map instance.
 */
export function basemapForSkin(skin: TerminalSkin): "dark" | "positron" {
  return skin === "light" ? "positron" : "dark";
}

const PERSIST_KEY = "tn.terminal.skin.v1";
const PERSIST_VERSION = 1;

let state: TerminalSkin = DEFAULT_TERMINAL_SKIN;
const listeners = new Set<() => void>();

/** Notify subscribers WITHOUT writing. Split out of `emit` so that seeding a skin
 *  nobody has chosen does not masquerade as a choice — see `hydrate`. */
function notify() {
  for (const l of listeners) l();
}

function emit() {
  notify();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const terminalSkinStore = {
  get(): TerminalSkin {
    return state;
  },
  /** No-op when unchanged, so a re-render cannot loop through a setter. */
  set(s: TerminalSkin) {
    if (state === s) return;
    state = s;
    emit();
  },
  toggle() {
    state = state === "dark" ? "light" : "dark";
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * Read the persisted skin. Call from an effect, never during render: the server
   * snapshot is always DEFAULT_TERMINAL_SKIN, so hydrating mid-render would make
   * React's first client pass disagree with the server HTML.
   *
   * A stored value ALWAYS wins. With none — nobody has ever touched the toggle —
   * the state is already DEFAULT_TERMINAL_SKIN and this only has to say so, via
   * `notify` rather than `emit`: seeding must not WRITE, or a visitor who never
   * expressed a preference would be recorded as having expressed one, and a later
   * change to the default could never reach them.
   */
  hydrate() {
    const saved = loadPersisted<TerminalSkin>(PERSIST_KEY, PERSIST_VERSION);
    if (saved != null) {
      state = coerceTerminalSkin(saved);
      emit();
      return;
    }
    // Assign rather than leave it alone. In the app `state` is still the module's
    // initial value here so this is a no-op — but "no stored choice means the
    // default" is the rule, and a rule that only holds because nothing has run yet
    // is not a rule. Written this way it also survives a second hydrate() after a
    // toggle, which is exactly the case a test can reach and a user cannot.
    state = DEFAULT_TERMINAL_SKIN;
    notify();
  },
};

export function useTerminalSkin(): TerminalSkin {
  return useSyncExternalStore(terminalSkinStore.subscribe, terminalSkinStore.get, terminalSkinStore.get);
}
