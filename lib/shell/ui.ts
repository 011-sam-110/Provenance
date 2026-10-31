"use client";
// Shell chrome state: theme only, and theme is now a constant.
//
// `Theme` IS A SINGLE-MEMBER UNION ON PURPOSE. Dark was an optional toggle and is
// gone from the product — the `[data-theme="dark"]` token block, the Settings
// segment and the palette command all went together. Narrowing the type rather than
// deleting the field is what stops it creeping back: every built-in variant declares
// `theme: "light"`, lib/variants/diff.ts still compares it, and a stored custom
// variant may carry the old value, so the FIELD has to survive. What must not
// survive is any way to ask for the other one.
//
// The store stays because the shell still hydrates it and still stamps the attribute
// before paint. It persists to localStorage, which now round-trips one value.
//
// THE CONSOLE'S DARK MODE, ITS DEFAULT, IS NOT THIS FIELD. It is lib/terminal/skin.ts: an
// attribute of its own on <html> (`data-tnx-skin`), its own key, its own store. It cannot
// be a second member of `Theme`, because lib/variants/store.ts calls `setTheme(v.theme)`
// on EVERY board switch and every variant declares "light", so a theme-based dark would be
// reset by the first tab click. Do not widen `Theme` to add it.
//
// Rail collapse is now local component state in LayerRail.tsx.
// News-ticker visibility is variant-driven via PanelHost (Task 9).

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type Theme = "light";

export interface UIState {
  theme: Theme;
}

const PERSIST_KEY = "tn.ui.v1";
const PERSIST_VERSION = 1;

let state: UIState = { theme: "light" };
const listeners = new Set<() => void>();

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
}

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const uiStore = {
  setTheme(theme: Theme) {
    if (state.theme === theme) return;
    state = { ...state, theme };
    applyTheme(theme);
    emit();
  },
  get(): UIState {
    return state;
  },
  /** Pull persisted UI back in + apply the theme. Call once, client-side. */
  hydrate() {
    const saved = loadPersisted<Partial<UIState>>(PERSIST_KEY, PERSIST_VERSION);
    // A stored "dark" from before the toggle was removed is DISCARDED rather than
    // applied: `saved.theme` is typed but localStorage is not, and honouring it would
    // stamp data-theme="dark" against a stylesheet that no longer defines those
    // tokens — an unreadable console for exactly the people who used the old toggle.
    if (saved?.theme === "light") state = { ...state, theme: saved.theme };
    applyTheme(state.theme);
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useUI(): UIState {
  return useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.get);
}
