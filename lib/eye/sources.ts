// The God's eye view's Sources, the pure half: which rows the tray offers, the state that
// is remembered about them, and the rules for changing it. components/eye/EyeSources.tsx
// draws the tray and the pins; components/eye/EyeApp.tsx holds the state and puts it on
// the map. Pinned by tests/unit/eye-sources.test.ts.
//
// CLIENT-SAFE ON PURPOSE. /eye loads this file in the browser, so it imports no catalogue,
// no registry and no widget module (tests/unit/eye-sources-bundle.test.ts holds the line).
// The rows themselves are built on the server (lib/eye/sourceRows.ts, called from
// app/(console)/eye/page.tsx) and arrive as a prop; the section type below is imported as
// a TYPE only.
//
// WHAT THE STATE IS. Two kinds of row:
//   - this view's OWN seven (cameras of both kinds, vessels, aircraft, TfL's works,
//     incidents and closures) are ON by default, so the state records the ones switched OFF;
//   - every other row is a console layer, OFF by default, so the state records the ones
//     switched ON. They draw through WorldMap (components/eye/EyeApp.tsx).
// Pins are a list of row ids, in bar order.

import { RETIRED_SIGNAL_IDS } from "@/lib/layerAliases";
import type { SignalPrecision } from "@/lib/signals/types";
import type { SourceRowModel, SourceSectionModel } from "@/lib/console/sources/sections";
import { movePin } from "@/lib/eye/pins";
import { SECTION_SHORT, THIS_VIEW } from "@/lib/eye/wording";

/** localStorage key and version of what is remembered. Never in lib/account/syncKeys.ts. */
export const EYE_SOURCES_KEY = "tn.eye.sources.v1";
export const EYE_SOURCES_VERSION = 1;

/** The ids of this view's own seven, in the order the tray lists them. */
export const EYE_OWN_IDS = [
  "livecams",
  "staticcams",
  "ais",
  "planes",
  "road-works",
  "road-incidents",
  "road-closures",
] as const;
export type EyeOwnId = (typeof EYE_OWN_IDS)[number];

/** What the scene draws, by the name the scene uses: a row of the tray maps onto one of these. */
export type EyeKind = "livecams" | "staticcams" | "ships" | "planes" | "works" | "incidents" | "closures";

const KIND_OF: Readonly<Record<EyeOwnId, EyeKind>> = {
  livecams: "livecams",
  staticcams: "staticcams",
  ais: "ships",
  planes: "planes",
  "road-works": "works",
  "road-incidents": "incidents",
  "road-closures": "closures",
};

/** The scene kind of a row id, or null for a console layer. */
export function ownKind(id: string): EyeKind | null {
  return Object.prototype.hasOwnProperty.call(KIND_OF, id) ? KIND_OF[id as EyeOwnId] : null;
}

/** TfL's notices: London only, so outside London their switch has nothing to do. */
export const ROAD_KINDS: readonly EyeKind[] = ["works", "incidents", "closures"];
export function isRoadRow(id: string): boolean {
  const k = ownKind(id);
  return k != null && ROAD_KINDS.includes(k);
}

/** One row of the tray. Built on the server (lib/eye/sourceRows.ts), passed down as a prop. */
export interface EyeSourceRow {
  id: string;
  label: string;
  color: string;
  /** The rail's section id, or "view" for this view's own seven. */
  section: string;
  /** The rail's full title for that section ("Conflict & security"), or "This view". */
  sectionTitle: string;
  /** One of this view's own seven: the scene draws it itself. */
  own: boolean;
  /**
   * The id is a map LAYER key (lib/layers.ts) rather than a signal's. Of the console's rows
   * that is the satellites and the borders; this view's own cameras and aircraft are layer
   * keys too, but the scene draws those itself and never writes them to the layers store.
   */
  layer: boolean;
  /** Who it comes from, in the rail's words. */
  credit: string;
  /** How precisely it places what it shows; null where that does not apply (the borders). */
  precision: SignalPrecision | null;
}

/** What is remembered and what the tray shows on. */
export interface SourcesState {
  /** Own rows switched OFF (they are on by default). */
  ownOff: string[];
  /** Console rows switched ON, in the order they were switched on (they are off by default). */
  consoleOn: string[];
  /** Row ids on the bar, in order. */
  pins: string[];
}

/** The state holds at most this many pins; the bar shows the first `pinCap(portrait)`. */
export const PIN_STATE_MAX = 6;

/** How many pins the bar holds: five on a wide screen, six on a phone's strip. */
export function pinCap(portrait: boolean): number {
  return portrait ? 6 : 5;
}

export function defaultSources(): SourcesState {
  return { ownOff: [], consoleOn: [], pins: [] };
}

export type SourcesAction =
  | { type: "toggle"; id: string }
  | { type: "pin"; id: string; at?: number }
  | { type: "unpin"; id: string }
  | { type: "move"; id: string; delta: number }
  | { type: "load"; saved: unknown; rowIds: readonly string[] };

function flip(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** A pure reducer. A change that changes nothing gives the same object back. */
export function sourcesReducer(state: SourcesState, action: SourcesAction): SourcesState {
  switch (action.type) {
    case "toggle":
      return ownKind(action.id)
        ? { ...state, ownOff: flip(state.ownOff, action.id) }
        : { ...state, consoleOn: flip(state.consoleOn, action.id) };
    case "pin": {
      if (state.pins.includes(action.id)) {
        if (action.at == null) return state;
        const moved = movePin(state.pins, action.id, action.at);
        return moved === state.pins ? state : { ...state, pins: [...moved] };
      }
      if (state.pins.length >= PIN_STATE_MAX) return state;
      const at = action.at == null ? state.pins.length : Math.max(0, Math.min(state.pins.length, Math.trunc(action.at)));
      return { ...state, pins: [...state.pins.slice(0, at), action.id, ...state.pins.slice(at)] };
    }
    case "unpin":
      return state.pins.includes(action.id) ? { ...state, pins: state.pins.filter((p) => p !== action.id) } : state;
    case "move": {
      const from = state.pins.indexOf(action.id);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(state.pins.length - 1, from + Math.trunc(action.delta)));
      const moved = movePin(state.pins, action.id, to);
      return moved === state.pins ? state : { ...state, pins: [...moved] };
    }
    case "load":
      return coerceSaved(action.saved, action.rowIds);
  }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Saved ids with retired ones replaced (none, when a layer was removed outright), each once. */
function current(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const next = Object.prototype.hasOwnProperty.call(RETIRED_SIGNAL_IDS, id) ? RETIRED_SIGNAL_IDS[id] : [id];
    for (const n of next) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * What was saved, made safe: `raw` is the value inside the storage envelope
 * (lib/shell/persist.ts), which may be anything. Unknown ids, duplicates and the wrong
 * shapes are dropped, a retired layer's id becomes the layer that replaced it
 * (lib/layerAliases.ts), pins are capped at PIN_STATE_MAX, and anything unreadable gives
 * the defaults. `rowIds` are the rows this deployment offers.
 */
export function coerceSaved(raw: unknown, rowIds: readonly string[]): SourcesState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultSources();
  const r = raw as Record<string, unknown>;
  const known = new Set<string>([...rowIds, ...EYE_OWN_IDS]);
  const own = new Set<string>(EYE_OWN_IDS);
  return {
    ownOff: current(strings(r.ownOff)).filter((id) => own.has(id)),
    consoleOn: current(strings(r.consoleOn)).filter((id) => known.has(id) && !own.has(id)),
    pins: current(strings(r.pins)).filter((id) => known.has(id)).slice(0, PIN_STATE_MAX),
  };
}

/** The scene kinds switched off. */
export function hiddenKinds(state: SourcesState): ReadonlySet<EyeKind> {
  const out = new Set<EyeKind>();
  for (const id of state.ownOff) {
    const k = ownKind(id);
    if (k) out.add(k);
  }
  return out;
}

/** The console rows switched on, in the order they were. */
export function consoleOn(state: SourcesState): string[] {
  return [...state.consoleOn];
}

/** Is this row on in this view? */
export function rowIsOn(state: SourcesState, id: string): boolean {
  return ownKind(id) ? !state.ownOff.includes(id) : state.consoleOn.includes(id);
}

// ── Sections ────────────────────────────────────────────────────────────────────────

/** One section of the tray: this view's own rows, or one of the rail's. */
export interface EyeSection {
  id: string;
  /** The rail's full title, for Show all. */
  title: string;
  /** The short name, for the strip in Sections. */
  short: string;
  rows: EyeSourceRow[];
}

/** The rows grouped by section, in the order they first appear (this view first). */
export function sectionsOf(rows: readonly EyeSourceRow[]): EyeSection[] {
  const out: EyeSection[] = [];
  for (const row of rows) {
    let sec = out.find((s) => s.id === row.section);
    if (!sec) {
      const own = row.section === "view";
      sec = {
        id: row.section,
        title: own ? THIS_VIEW : row.sectionTitle,
        short: own ? THIS_VIEW : SECTION_SHORT[row.section] ?? row.sectionTitle,
        rows: [],
      };
      out.push(sec);
    }
    sec.rows.push(row);
  }
  return out;
}

/** A section in the shape the console's SourceSection draws. */
export function toSectionModel(sec: EyeSection): SourceSectionModel {
  return {
    id: sec.id,
    title: sec.title,
    rows: sec.rows.map(
      (r): SourceRowModel => ({
        id: r.id,
        kind: r.layer ? "core" : "signal",
        label: r.label,
        group: sec.title,
        color: r.color,
        attribution: r.credit,
      }),
    ),
  };
}

/** Show all's search: rows whose label holds the query, any case; sections left empty are dropped. */
export function filterSections(sections: readonly EyeSection[], query: string): EyeSection[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...sections];
  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => r.label.toLowerCase().includes(q)) }))
    .filter((s) => s.rows.length > 0);
}

// ── What is on screen, for the ledger, the tags and "N here" ────────────────────────

/** One feature of a console layer that MapLibre drew in the current view. */
export interface RenderedSignal {
  signalId: string;
  /** The feature's own id, which a feature drawn in several tiles shares. */
  id: string;
  label: string;
  /** Where it is, for a point; null for a line or an area. */
  lon: number | null;
  lat: number | null;
}

/** How many marks each layer has in view: each feature id once, however many tiles cut it. */
export function countBySignal(rendered: readonly RenderedSignal[]): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const f of rendered) {
    if (!f.signalId || !f.id) continue;
    let ids = seen.get(f.signalId);
    if (!ids) seen.set(f.signalId, (ids = new Set()));
    ids.add(f.id);
  }
  return new Map([...seen].map(([sig, ids]) => [sig, ids.size] as const));
}

/**
 * The marks that get a tag: points only, at most `max`, taken from each switched-on layer
 * in turn so one busy layer cannot take every tag. `onIds` is the order the layers were
 * switched on.
 */
export function signalTagPicks(rendered: readonly RenderedSignal[], onIds: readonly string[], max: number): RenderedSignal[] {
  const queues = onIds.map((sig) => {
    const seen = new Set<string>();
    return rendered.filter((f) => {
      if (f.signalId !== sig || f.lon == null || f.lat == null || !f.label || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  });
  const out: RenderedSignal[] = [];
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const q of queues) {
      if (round < q.length) {
        any = true;
        if (out.length < max) out.push(q[round]);
      }
    }
    if (!any) break;
  }
  return out;
}
