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
// Nothing here touches window/document at module scope — `loadPersisted` is only
// reached from `hydrate()`, which callers run inside an effect. Importing this on
// the server, or in the node vitest environment, is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type TerminalSkin = "dark" | "light";

/** Dark stays the default: the Terminal was designed as dark OSINT chrome, and a
 *  skin flip on upgrade would be a change nobody asked for. The choice persists,
 *  so anyone who wants light picks it once. */
export const DEFAULT_TERMINAL_SKIN: TerminalSkin = "dark";

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

function emit() {
  for (const l of listeners) l();
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
   */
  hydrate() {
    state = coerceTerminalSkin(loadPersisted<TerminalSkin>(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
};

export function useTerminalSkin(): TerminalSkin {
  return useSyncExternalStore(terminalSkinStore.subscribe, terminalSkinStore.get, terminalSkinStore.get);
}
