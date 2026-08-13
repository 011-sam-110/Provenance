"use client";
// The Terminal's cross-widget selection: one row, anywhere on the board, is
// "the thing we are looking at". Clicking it names it in the footer, flies the
// stage to it, and makes every OTHER row that shares its country code render as
// "linked" — so picking an anomaly in one widget silently answers "what else do
// we hold on this country?" without the user typing a filter.
//
// Deliberately NOT the overlay store. `overlay` holds a full WorldObject and
// opens the dossier panel over the map; this holds a thin, widget-agnostic
// pointer that any widget can produce from a table row it already renders,
// without owning a WorldObject or a SignalFeature. The two are complementary:
// a widget may do both (fly + dossier) or only this (fly + footer + linking).
//
// Deliberately NOT persisted either. A selection restored from localStorage
// would fly the camera on first paint, and it would name a row belonging to a
// widget the user may since have removed from the board — a stale caption on a
// live map. Selection dies with the tab; that is the honest lifetime for it.
//
// Framework-light, matching lib/overlay.ts and lib/shell/viewMode.ts: a Set of
// listeners + useSyncExternalStore, no new dependency.

import { useSyncExternalStore } from "react";

export interface TerminalSelection {
  /** Stable id, unique across every widget: "${widgetInstanceId}:${rowKey}". */
  id: string;
  title: string;
  lat?: number;
  lon?: number;
  /** ISO-3166 alpha-2, when the row knows one. Drives the "linked row" highlight. */
  cc?: string;
  /** Right-hand detail line, e.g. "GDACS/EONET · 13h ago". */
  meta?: string;
}

/** How a single row should paint itself. Named so widgets can type their props. */
export type RowState = "selected" | "linked" | "idle";

/**
 * Fly-to zoom for a selection.
 *
 * Two constraints pin this, and they pin it from both ends:
 *  - Low end: WorldMap's calm idle globe spin runs whenever zoom < SPIN_MAX_ZOOM
 *    (4) and nothing is in the OVERLAY store. A Terminal selection is not an
 *    overlay object, so the spin resumes ~800 ms after the fly settles
 *    (flyToPoint suppresses input for 2400 ms against a 1600 ms flight). Land
 *    below 4 and the globe quietly drifts off the thing the user just clicked.
 *  - High end: the point of the fly is CONTEXT — the neighbouring quakes, the
 *    rest of the border, the other cameras in the city — not a rooftop. 5 is the
 *    same zoom openSignalFeature() already uses for a signal row click, so a row
 *    click lands identically whichever surface issued it.
 * (flyToPoint clamps to 2..15 regardless, so this can never be out of range.)
 */
export const SELECT_ZOOM = 5;

/** Empty-state footer copy. Uppercase because it IS the string, not a CSS effect. */
const EMPTY_TITLE = "NOTHING SELECTED";
const EMPTY_META = "CLICK ANY ROW — THE STAGE FLIES TO IT AND LINKED ROWS HIGHLIGHT";
/** The one-glyph stand-in for a field this row genuinely does not have. */
const DASH = "—";

let state: TerminalSelection | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Trim + upper a country code, treating blank/absent as "this row has no cc". */
function normCc(cc?: string): string | null {
  const t = (cc ?? "").trim().toUpperCase();
  return t.length > 0 ? t : null;
}

function isCoord(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Move the stage to a selection.
 *
 * The import is lazy ON PURPOSE. lib/mapView reaches the basemap registry and
 * React, and this module has to stay importable from the node-only vitest
 * environment (no jsdom, no window) where all its pure functions are tested.
 * Nobody awaits a camera move, so paying a microtask of module-load latency for
 * it costs nothing user-visible.
 *
 * Note the field name: PointView is { lat, lon, zoom } — `lon`, NOT `lng`.
 * RegionView (mapViewStore.flyTo) is the one with `lng`; passing `lng` here
 * type-errors if you are lucky and silently flies to longitude undefined if a
 * future refactor loosens the type.
 */
function flyToSelection(lat: number, lon: number): void {
  void import("@/lib/mapView")
    .then((m) => {
      m.mapViewStore.flyToPoint({ lat, lon, zoom: SELECT_ZOOM });
    })
    .catch(() => {
      // No map module available (a unit test, SSR, a chunk that failed to load).
      // The selection itself still stands — only the camera move is lost, and a
      // dead camera move must never take the footer and the row linking with it.
    });
}

export const selectionStore = {
  get(): TerminalSelection | null {
    return state;
  },
  /**
   * Select, and (when lat/lon are present) fly the stage to it.
   *
   * No "already selected" early return: re-clicking the selected row is the
   * user's "take me back there" gesture after they have panned the map away, so
   * it must re-fly. The stored value is a shallow copy so a widget reusing one
   * row object across renders cannot mutate the store out from under the footer.
   */
  select(s: TerminalSelection): void {
    state = { ...s };
    emit();
    if (isCoord(s.lat) && isCoord(s.lon)) flyToSelection(s.lat, s.lon);
  },
  /**
   * Deselect. Does NOT move the camera: flying "home" on a deselect would be a
   * second, unasked-for animation away from the place the user is reading.
   */
  clear(): void {
    if (state === null) return;
    state = null;
    emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** React hook: re-renders the caller whenever the selection changes. */
export function useTerminalSelection(): TerminalSelection | null {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.get, selectionStore.get);
}

/**
 * PURE. How one row should render given the current selection.
 *
 * "linked" needs a cc on BOTH sides. A row that does not know its country is
 * never linked — guessing one from a title would be exactly the kind of quiet
 * fabrication the rest of this codebase refuses.
 */
export function rowState(
  sel: TerminalSelection | null,
  rowId: string,
  cc?: string,
): RowState {
  if (!sel) return "idle";
  if (sel.id === rowId) return "selected";
  const a = normCc(sel.cc);
  const b = normCc(cc);
  return a !== null && a === b ? "linked" : "idle";
}

/**
 * PURE. "51.50N 0.12W" — 2dp, N/S then E/W, or "—" when either is missing.
 * Both halves or neither: a lone latitude is not a location, and half a
 * coordinate in a footer reads as a whole one.
 */
export function formatCoord(lat?: number, lon?: number): string {
  if (!isCoord(lat) || !isCoord(lon)) return DASH;
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}${ns} ${Math.abs(lon).toFixed(2)}${ew}`;
}

/**
 * PURE. The footer's three strings for a selection (or the empty state).
 *
 * Always three non-empty strings, so the footer's three slots never collapse
 * and reflow the bar. A row that carries no meta gets the same "—" a missing
 * coordinate gets: an explicit "we don't have this", never a blank that reads
 * as a rendering bug. `title` is passed through unchanged — uppercasing is the
 * stylesheet's job, and force-uppering it here would mangle names like "M 5.4
 * — 22 km SSE of Puerto Madero".
 */
export function footerLine(sel: TerminalSelection | null): {
  title: string;
  coord: string;
  meta: string;
} {
  if (!sel) return { title: EMPTY_TITLE, coord: DASH, meta: EMPTY_META };
  const title = sel.title.trim();
  return {
    title: title.length > 0 ? title : DASH,
    coord: formatCoord(sel.lat, sel.lon),
    meta: (sel.meta ?? "").trim() || DASH,
  };
}
