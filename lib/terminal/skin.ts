"use client";
// THE CONSOLE'S SKIN: DARK BY DEFAULT, LIGHT ON REQUEST, REMEMBERED PER BROWSER.
//
// NOT A THEME, AND THAT IS THE POINT. `lib/shell/ui.ts` still has a `theme` field and
// app/layout.tsx still stamps `data-theme="light"`, so the obvious home for this would
// be a second member of `Theme`. It cannot live there: lib/variants/store.ts calls
// `uiStore.setTheme(v.theme)` on EVERY board switch, and every built-in variant declares
// `theme: "light"`, so a theme-based dark would be yanked back to light by the first tab
// click. The skin is its own attribute on <html> — `data-tnx-skin="dark"` — which on /app
// only this file and its before-paint script (lib/terminal/skinBoot.ts) write. No variant
// knows it exists. The palette it switches on is the DARK SKIN block in app/globals.css.
//
// DARK IS THE DEFAULT AND THE OS IS NOT ASKED. Sam, 2026-10-31: "set dark mode as the new
// default. It can be switched back to light in settings". There is no
// `prefers-color-scheme` read anywhere, here or in the stylesheet, and no palette command.
// A visitor who has never pressed a control has nothing stored, and `hydrate()` keeps it
// that way: it reads, it never writes. Only `set` persists, and the one thing that calls it
// is the Theme row in Settings > Display (components/shell/settings/DisplayTab.tsx). The
// moon button left the navbar the same day.
//
// WHY THE KEY IS STILL `v2`. Light was the default from PR #325 until 2026-10-31, and since
// `hydrate()` never writes, every value under this key is a control somebody pressed. So a
// saved "light" here is a choice, and it stays through the change of default. A browser that
// never pressed anything has nothing here and now opens dark. The skin store that PR #162
// deleted wrote `tn.terminal.skin.v1`; nothing reads that key (tests pin it).
//
// SAME SHAPE AS lib/terminal/mode.ts (module state + a listener set +
// useSyncExternalStore), persisted through lib/shell/persist.ts. Nothing here touches
// window/document at module scope; `applySkin`'s default root is read when it is CALLED,
// so importing this file on the server or in the node vitest environment is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import {
  DEFAULT_TERMINAL_SKIN,
  SKIN_ATTR,
  SKIN_BOOT_SCRIPT,
  SKIN_PERSIST_KEY,
  SKIN_PERSIST_VERSION,
  type TerminalSkin,
} from "@/lib/terminal/skinBoot";

export { DEFAULT_TERMINAL_SKIN, SKIN_ATTR, SKIN_BOOT_SCRIPT, SKIN_PERSIST_KEY, SKIN_PERSIST_VERSION };
export type { TerminalSkin };

/**
 * Narrow an untrusted value (persisted JSON) to a TerminalSkin. Anything that is not exactly
 * one of the two is the default: a corrupt or foreign value must never turn the console light.
 */
export function coerceTerminalSkin(v: unknown): TerminalSkin {
  return v === "light" || v === "dark" ? v : DEFAULT_TERMINAL_SKIN;
}

/** Put the skin on <html>. Dark sets the attribute; light removes it. */
export function applySkin(
  skin: TerminalSkin,
  root: Pick<Element, "setAttribute" | "removeAttribute"> = document.documentElement,
): void {
  if (skin === "dark") root.setAttribute(SKIN_ATTR, "dark");
  else root.removeAttribute(SKIN_ATTR);
}

let state: TerminalSkin = DEFAULT_TERMINAL_SKIN;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export const terminalSkinStore = {
  get(): TerminalSkin {
    return state;
  },
  /** No-op when the skin is unchanged, so a re-render cannot loop through a setter. */
  set(s: TerminalSkin) {
    if (state === s) return;
    state = s;
    applySkin(s);
    savePersisted(SKIN_PERSIST_KEY, SKIN_PERSIST_VERSION, s);
    notify();
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
   * with the default would turn "never chose" into "chose dark" — and it only notifies
   * the subscribers (the Settings row) so they repaint.
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
