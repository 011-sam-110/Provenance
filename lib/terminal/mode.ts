"use client";
// CONSOLE vs WALL — the terminal layout mode.
//
// CONSOLE is the working layout (chrome, rail, panels, widget grid around the map).
// WALL is the same data with the chrome stripped back for an unattended display.
//
// Why this is its OWN store rather than a third StageId or a new ViewMode:
//
//  * `sanitizeLayout` (lib/console/store) returns null — silently discarding the
//    user's entire saved layout — for any stage outside map3d|map2d|clock. Adding
//    "wall" as a StageId would make every existing persisted layout unreadable the
//    first time someone opened the wall. The mode is orthogonal to the stage: WALL
//    still renders whichever stage the layout asked for.
//  * `tn.console.v1`'s shape and VERSION are pinned, so this cannot ride along in
//    the console layout envelope either. It gets its own key and its own version.
//
// Same shape as lib/shell/viewMode.ts on purpose (module-level state + a listener
// set + useSyncExternalStore): the shell already reasons about stores this way, and
// the two are read side by side in the chrome.
//
// Nothing here touches window/document at module scope — `loadPersisted` is only
// reached from `hydrate()`, which callers run inside an effect. Importing this file
// on the server, or in the node vitest environment, is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type TerminalMode = "console" | "wall";
export const DEFAULT_TERMINAL_MODE: TerminalMode = "console";

/**
 * Narrow an untrusted value (persisted JSON, a URL param, a postMessage) to a
 * TerminalMode. Pure — anything that is not exactly one of the two literals falls
 * back to CONSOLE. Deliberately case-sensitive: the design file writes the modes in
 * capitals as *labels* ("CONSOLE" / "WALL") and those labels are not the wire value,
 * so accepting them here would let a label leak into storage as if it were state.
 */
export function coerceTerminalMode(v: unknown): TerminalMode {
  return v === "wall" || v === "console" ? v : DEFAULT_TERMINAL_MODE;
}

const PERSIST_KEY = "tn.terminal.mode.v1";
const PERSIST_VERSION = 1;

let state: TerminalMode = DEFAULT_TERMINAL_MODE;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const terminalModeStore = {
  get(): TerminalMode {
    return state;
  },
  /** No-op when the mode is unchanged, so a re-render cannot loop through a setter. */
  set(m: TerminalMode) {
    if (state === m) return;
    state = m;
    emit();
  },
  toggle() {
    state = state === "console" ? "wall" : "console";
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * Read the persisted mode. Call from an effect, never during render: the server
   * snapshot is always DEFAULT_TERMINAL_MODE, so hydrating mid-render would make
   * React's first client pass disagree with the server HTML.
   */
  hydrate() {
    state = coerceTerminalMode(loadPersisted<TerminalMode>(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
};

export function useTerminalMode(): TerminalMode {
  return useSyncExternalStore(terminalModeStore.subscribe, terminalModeStore.get, terminalModeStore.get);
}
