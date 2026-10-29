"use client";
// THE CONSOLE'S DARK SKIN — an opt-in, light by default, remembered per browser.
//
// NOT A THEME, AND THAT IS THE POINT. `lib/shell/ui.ts` still has a `theme` field and
// app/layout.tsx still stamps `data-theme="light"`, so the obvious home for this would
// be a second member of `Theme`. It cannot live there: lib/variants/store.ts calls
// `uiStore.setTheme(v.theme)` on EVERY board switch, and every built-in variant declares
// `theme: "light"`, so a theme-based dark would be yanked back to light by the first tab
// click. The skin is its own attribute on <html> — `data-tnx-skin="dark"` — which this
// file, and the before-paint script below, write and nothing else does. No variant knows
// it exists. The palette it switches on is the DARK SKIN block in app/globals.css.
//
// WHY THE KEY IS `v2`. The skin store that PR #162 deleted wrote `tn.terminal.skin.v1`.
// Reviving that key would silently flip every browser that picked dark before September
// the first time this shipped, and the rule here is the opposite: light until the person
// presses the toggle. A new key means a stored v1 "dark" is ignored (tests pin it).
//
// LIGHT IS THE DEFAULT AND THE OS IS NOT ASKED. There is no `prefers-color-scheme` read
// anywhere, here or in the stylesheet, and no palette command. A visitor who has never
// pressed the toggle has nothing stored, and `hydrate()` keeps it that way: it reads, it
// never writes. Only `set` and `toggle` persist.
//
// SAME SHAPE AS lib/terminal/mode.ts (module state + a listener set +
// useSyncExternalStore), persisted through lib/shell/persist.ts. Nothing here touches
// window/document at module scope; `applySkin`'s default root is read when it is CALLED,
// so importing this file on the server or in the node vitest environment is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type TerminalSkin = "light" | "dark";
export const DEFAULT_TERMINAL_SKIN: TerminalSkin = "light";

export const SKIN_PERSIST_KEY = "tn.terminal.skin.v2";
export const SKIN_PERSIST_VERSION = 1;

/** Set on <html> as `data-tnx-skin="dark"`; REMOVED for light, never set to "light". */
export const SKIN_ATTR = "data-tnx-skin";

/**
 * Narrow an untrusted value (persisted JSON) to a TerminalSkin. Anything that is not
 * exactly "dark" is light: a corrupt or foreign value must never turn the console dark.
 */
export function coerceTerminalSkin(v: unknown): TerminalSkin {
  return v === "dark" ? "dark" : DEFAULT_TERMINAL_SKIN;
}

/** Put the skin on <html>. Dark sets the attribute; light removes it. */
export function applySkin(
  skin: TerminalSkin,
  root: Pick<Element, "setAttribute" | "removeAttribute"> = document.documentElement,
): void {
  if (skin === "dark") root.setAttribute(SKIN_ATTR, "dark");
  else root.removeAttribute(SKIN_ATTR);
}

/**
 * Runs inline in <head>-order, before the console paints, so a saved dark choice never
 * flashes light. Built from the constants above so the key, the version and the
 * attribute have ONE source of truth; tests/unit/terminal-skin.test.ts runs it against
 * fakes. Everything is inside try/catch: a storage that throws (private mode, a sandboxed
 * iframe) or garbage JSON leaves the page light and silent.
 */
export const SKIN_BOOT_SCRIPT =
  `try{var r=localStorage.getItem(${JSON.stringify(SKIN_PERSIST_KEY)});var e=r&&JSON.parse(r);` +
  `if(e&&e.v===${SKIN_PERSIST_VERSION}&&e.d==="dark")document.documentElement.setAttribute(${JSON.stringify(SKIN_ATTR)},"dark")}catch(_){}`;

let state: TerminalSkin = DEFAULT_TERMINAL_SKIN;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function commit(next: TerminalSkin) {
  state = next;
  applySkin(next);
  savePersisted(SKIN_PERSIST_KEY, SKIN_PERSIST_VERSION, next);
  notify();
}

export const terminalSkinStore = {
  get(): TerminalSkin {
    return state;
  },
  /** No-op when the skin is unchanged, so a re-render cannot loop through a setter. */
  set(s: TerminalSkin) {
    if (state === s) return;
    commit(s);
  },
  toggle() {
    commit(state === "dark" ? "light" : "dark");
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * Read the persisted skin and apply it. Call from an effect, never during render: the
   * server snapshot is always DEFAULT_TERMINAL_SKIN, so hydrating mid-render would make
   * React's first client pass disagree with the server HTML. It NEVER writes — seeding
   * with the default would turn "never chose" into "chose light" — and it only notifies
   * the subscribers (the header toggle, the Settings row) so they repaint.
   */
  hydrate() {
    state = coerceTerminalSkin(loadPersisted<TerminalSkin>(SKIN_PERSIST_KEY, SKIN_PERSIST_VERSION));
    applySkin(state);
    notify();
  },
};

export function useTerminalSkin(): TerminalSkin {
  return useSyncExternalStore(terminalSkinStore.subscribe, terminalSkinStore.get, terminalSkinStore.get);
}
