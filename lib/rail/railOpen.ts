"use client";
// The shared sidebar's open state, and the rules the sidebar and its neighbours read.
// components/rail/SideRail.tsx is the one component that draws it, on God's eye view and
// on the console.
//
// TWO STATES PER SURFACE, BECAUSE A PHONE AND A LAPTOP MEAN DIFFERENT THINGS BY "OPEN".
// `open` is the column on a wide screen: a choice the visitor keeps, so it is saved per
// browser under `tn.rail.open.v1`. `sheet` is the phone's sheet: it covers the map and has
// a scrim, so it lasts until it is closed and is never written down. A saved "open" from
// a laptop must not cover a phone's map at load, and a reload on a phone must show the map.
//
// IT READS AFTER MOUNT. The server has no storage, so the server's HTML and the first
// client render are closed, and `hydrate()` runs from the component's first effect. The
// server snapshot is `false`, a primitive, so `useSyncExternalStore` has no identity to
// trip over.
//
// A WRITE READS THE SAVED VALUE FIRST and changes only its own surface. God's eye view and
// the console often run in two tabs, and each tab holds its own copy of this module. A
// write of the whole object from memory would put back what the other tab just changed.
//
// Nothing here touches window or document outside a function, so importing this on the
// server or under the node vitest environment is inert.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export type RailSurface = "eye" | "console";
export type RailOpenState = Readonly<Record<RailSurface, boolean>>;
export type RailWidth = "64px" | "232px" | "0px";

const KEY = "tn.rail.open.v1";
const VERSION = 1;

/** The custom property the sidebar publishes on <html>. Neighbours read it with a 64px fallback. */
export const RAIL_WIDTH_PROP = "--rail-w";
/** The repo's existing narrow pass. rail.module.css repeats it: a CSS media query cannot import. */
export const RAIL_NARROW_QUERY = "(max-width: 900px)";

const CLOSED: RailOpenState = Object.freeze({ eye: false, console: false });

/** Pure: a saved value, whatever it holds, as a state. Only a literal `true` opens a surface. */
export function coerceRailOpen(raw: unknown): RailOpenState {
  if (!raw || typeof raw !== "object") return CLOSED;
  const r = raw as Record<string, unknown>;
  return { eye: r.eye === true, console: r.console === true };
}

/** Pure: is the column showing its labels? A phone reads its sheet and ignores the saved choice. */
export function railExpanded(s: { open: boolean; sheet: boolean; narrow: boolean }): boolean {
  return s.narrow ? s.sheet : s.open;
}

/** Pure: the width the neighbours make room for. A phone's sheet covers them, so it is always 0. */
export function railWidth(s: { expanded: boolean; narrow: boolean }): RailWidth {
  if (s.narrow) return "0px";
  return s.expanded ? "232px" : "64px";
}

/**
 * Pure: the menu button's accessible name.
 *
 * The word beside the bars is usually the product's name, and "Provenance, button,
 * collapsed" does not say what the button does. The visible word stays inside the name
 * (WCAG 2.5.3, label in name), so voice control can still say what it sees.
 */
export function railMenuName(menuLabel: string): string {
  return /\bmenu\b/i.test(menuLabel) ? menuLabel : `${menuLabel} menu`;
}

/**
 * Pure: is this key press the sheet's to act on?
 *
 * It stands down when something else has already taken the press (`defaultPrevented`), and
 * when the press lands inside `[data-owns-escape]`, the attribute that
 * components/shell/ConsoleSidebar.tsx describes: an inline field or a picker that
 * must get Escape for itself.
 */
export function sheetTakesEscape(e: {
  key: string;
  defaultPrevented: boolean;
  target: EventTarget | null;
}): boolean {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  const target = e.target as { closest?: (selector: string) => unknown } | null;
  return !target?.closest?.("[data-owns-escape]");
}

let open: RailOpenState = CLOSED;
let sheet: RailOpenState = CLOSED;
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const railOpenStore = {
  isOpen: (surface: RailSurface): boolean => open[surface],
  isSheet: (surface: RailSurface): boolean => sheet[surface],
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Read the saved choice once. Called after mount, and by a write that gets here first. */
  hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    const saved = coerceRailOpen(loadPersisted<unknown>(KEY, VERSION));
    if (saved.eye === open.eye && saved.console === open.console) return;
    open = saved;
    emit();
  },

  setOpen(surface: RailSurface, value: boolean): void {
    railOpenStore.hydrate();
    if (open[surface] === value) return;
    open = { ...open, [surface]: value };
    const saved = coerceRailOpen(loadPersisted<unknown>(KEY, VERSION));
    savePersisted<RailOpenState>(KEY, VERSION, { ...saved, [surface]: value });
    emit();
  },

  toggle(surface: RailSurface): void {
    railOpenStore.hydrate();
    railOpenStore.setOpen(surface, !open[surface]);
  },

  setSheet(surface: RailSurface, value: boolean): void {
    if (sheet[surface] === value) return;
    sheet = { ...sheet, [surface]: value };
    emit();
  },
};

/**
 * Close the phone's sheet for a host, for example when a row opens a tray the sheet would
 * cover. It leaves the wide column and its saved choice alone, so a host can call it from
 * a row's onClick with no check for the screen size.
 */
export function closeRail(surface: RailSurface): void {
  railOpenStore.setSheet(surface, false);
}

export function useRailOpen(surface: RailSurface): boolean {
  return useSyncExternalStore(
    railOpenStore.subscribe,
    () => railOpenStore.isOpen(surface),
    () => false,
  );
}

export function useRailSheet(surface: RailSurface): boolean {
  return useSyncExternalStore(
    railOpenStore.subscribe,
    () => railOpenStore.isSheet(surface),
    () => false,
  );
}

function subscribeNarrow(l: () => void): () => void {
  const media = window.matchMedia(RAIL_NARROW_QUERY);
  media.addEventListener("change", l);
  return () => media.removeEventListener("change", l);
}

/** Is this the phone pass? False on the server and on the first client render. */
export function useRailNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(RAIL_NARROW_QUERY).matches,
    () => false,
  );
}
