// The shared vocabulary for area-owned notification rules.
//
// EVERYTHING HERE IS A TYPE OR A CONSTANT. No behaviour, so it can be imported by
// the pure engine, the impure stores and the React composer without any of them
// dragging the others in.
//
// A rule is owned by an AREA, not by a widget and not by a preset. That is the whole
// design: `lib/shell/notifications.ts` keys its rules by widget TYPE, globally, which
// cannot express "in Soho" and cannot survive a board swap. This is a second, area-
// scoped rule set that reuses that file's channels and its `dispatch`.

import type { NotifyChannels } from "@/lib/shell/notifications";

/** The nine things a source can be asked to do. M1 implements four of them. */
export type TriggerKind =
  | "appears" | "disappears" | "enters" | "leaves"
  | "crosses" | "count" | "state" | "due" | "quiet";

/** Which side of a level fires. Both are EDGE-triggered — see engine.ts. */
export type Direction = "atOrAbove" | "below";

/**
 * A trigger and its settings in one value, so a rule carrying settings that do not
 * match its trigger cannot be constructed. The engine and the composer's parameter
 * row branch on the same discriminant.
 */
export type TriggerParams =
  | { kind: "appears" | "disappears" | "enters" | "leaves" }
  | { kind: "crosses"; field: string; dir: Direction; level: number }
  | { kind: "count"; dir: Direction; level: number }
  | { kind: "state"; field: string; to: string }
  | { kind: "due"; leadMs: number }
  | { kind: "quiet"; silentMs: number };

export interface AreaRule {
  /** "rule:<epoch ms>" — stable, and sorts by age without a second field. */
  id: string;
  /** An `inspectorStore` area id, or the literal "world". */
  areaId: string;
  /** A signal id, a core LayerKey, or a widget type id. */
  sourceId: string;
  params: TriggerParams;
  channels: NotifyChannels;
  enabled: boolean;
  createdAt: number;
}

/** The area id meaning "everywhere" — no ring, every row is inside. */
export const WORLD_AREA_ID = "world";

/**
 * One row as the engine sees it. A per-family adapter flattens a SignalFeature, a
 * WorldObject or a widget's own rows into this; the engine knows nothing else.
 */
export interface ObservedRow {
  id: string;
  lat: number;
  lon: number;
  /** Numeric fields named by the source's `scalars` declaration. */
  scalars: Record<string, number>;
  /** Value of the field named by the source's `state` declaration. */
  state?: string;
  /** Future ISO timestamp named by the source's `due` declaration. */
  dueAt?: string;
  /** Rendered into the message. */
  title: string;
}

/** What we knew about one `(area, source)` pair at the last poll. */
export interface Observation {
  /** row id → what we last knew about it. */
  rows: Record<string, { inside: boolean; scalars: Record<string, number>; state?: string }>;
  /** How many rows were inside the ring. */
  count: number;
  /** Last successful poll, epoch ms. 0 when never. */
  lastOk: number;
  /** Row ids already announced by a `due` rule, so a lead time fires once. */
  dueFired: string[];
  /** True once `quiet` has fired for the current silence, so it fires once per silence. */
  quietFired: boolean;
}

/** One thing that happened, before the budget decides whether it is sent. */
export interface NotifyEvent {
  ruleId: string;
  areaId: string;
  sourceId: string;
  kind: TriggerKind;
  /** The row that caused it. Absent for `count` and `quiet`, which are about the set. */
  rowId?: string;
  /** The finished sentence, already worded by wording.ts. */
  text: string;
  at: number;
}

/** What a source says about its own fields. Layer 3 of the resolution. */
export interface TriggerCapability {
  /** Field holding a stable per-row id. Defaults to the row's own `id`. */
  identity?: string;
  /** Numeric fields offerable to `crosses`, with their REAL domains. */
  scalars?: { field: string; label: string; unit?: string; domain: [number, number] }[];
  /** Categorical field offerable to `state`, and its known values. */
  state?: { field: string; values: string[] };
  /** Field holding a future ISO timestamp, offerable to `due`. */
  due?: { field: string };
  /** Kinds this source adds to its group default. */
  add?: TriggerKind[];
  /** Kinds this source removes. Wins over everything, including an implied kind. */
  remove?: TriggerKind[];
}
