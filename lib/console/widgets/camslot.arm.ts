"use client";
// Map arming — "fill THIS slot from the map" — plus every rule that decides what a
// map gesture is allowed to add.
//
// WHY THE MODE LIVES HERE AND NOT IN WorldMap. Two functions in WorldMap would
// otherwise own it, and both are mount-once closures: `wireInteractions` is a
// `useCallback(…, [])` invoked once at mount (WorldMap.tsx:1074, closing at :1262),
// and `createThumbnailManager`'s `onPick` is built inside the init effect that
// closes at :1563. Anything either one closes over is frozen at mount. On top of
// that, StageHost.tsx:33,37 unmounts <WorldMap/> entirely when a widget is focused,
// so React state inside it does not survive a focus round trip either. Module state
// read at EVENT time is the only shape that works for both.
//
// WHY IT IS NOT PERSISTED. Arming is a held modifier key, not a preference. A
// persisted mode means you reload tomorrow, click a pin expecting a dossier, and
// silently append to a slot that is scrolled off screen. Contrast camslot.prefs.ts,
// which IS persisted, because a pause is something the user chose about themselves.
// It is not widget config either: store.ts:74 configure() -> emit() -> writeBoardLayout,
// and boards.ts:104 layoutSignature includes `g: w.config`, so an armed flag in there
// would light the board's "customised" dot on the first click.
//
// Everything below the store is PURE and node-tested. WorldMap supplies geometry and
// side effects; it does not decide anything.

import { useSyncExternalStore } from "react";
import { MAX_STREAMS, streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";

// ── The mode ────────────────────────────────────────────────────────────────

let armedId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export const armStore = {
  /** The armed widget instance id, or null. Read at EVENT time, never captured. */
  get(): string | null {
    return armedId;
  },
  /** Arm one slot. Arming a second disarms the first — one target, always. */
  arm(instanceId: string): void {
    if (armedId === instanceId) return;
    armedId = instanceId;
    emit();
  },
  disarm(): void {
    if (armedId === null) return;
    armedId = null;
    emit();
  },
  /** The ⊕ button: same slot turns it off, a different slot moves the arm. */
  toggle(instanceId: string): void {
    if (armedId === instanceId) this.disarm();
    else this.arm(instanceId);
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Server snapshot is null: nothing is armed before hydration, by definition. */
const serverSnapshot = (): string | null => null;

export function useArmedSlot(): string | null {
  return useSyncExternalStore(armStore.subscribe, armStore.get, serverSnapshot);
}

export function useIsArmed(instanceId: string): boolean {
  return useArmedSlot() === instanceId;
}

// ── Geometry ────────────────────────────────────────────────────────────────

export interface LatLonBounds {
  north: number;
  east: number;
  south: number;
  west: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * A drag has two corners in whatever order the user made them. Normalising here
 * means no caller has to care which way the pointer went.
 *
 * Antimeridian boxes are deliberately not handled: WorldMap sets
 * `renderWorldCopies: false`, so there is no way to drag a box across ±180 in the
 * first place. If that option ever changes, this is the function that breaks.
 */
export function normalizeBounds(a: LatLon, b: LatLon): LatLonBounds {
  return {
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lon, b.lon),
    west: Math.min(a.lon, b.lon),
  };
}

/**
 * Rows inside the box, edges included, input order preserved.
 *
 * A row with a non-finite coordinate is DROPPED rather than coerced. `Number(undefined)`
 * is NaN and every comparison against it is false, so a coerced row would silently
 * vanish anyway — but `lat ?? 0` would put it in the Gulf of Guinea, inside a box
 * nobody dragged. Dropping it is the honest version of what the arithmetic already does.
 */
export function camerasInBounds<T extends LatLon>(rows: readonly T[], b: LatLonBounds): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (r.lat > b.north || r.lat < b.south) continue;
    if (r.lon > b.east || r.lon < b.west) continue;
    out.push(r);
  }
  return out;
}

/**
 * Centre-out order. This is the function that stops a cap being a coverage lie:
 * "the 12 nearest the centre of the box you dragged" is a selection the user can
 * reason about and reproduce, whereas "the first 12 in whatever order /api/cameras
 * returned" is a 4% arbitrary sample wearing the costume of a choice.
 *
 * Equirectangular, not haversine. Over a box a person can drag, the error is far
 * below the spacing between cameras, and this stays pure and cheap. The cos(lat)
 * term is not optional though — without it a degree of longitude at lat 60 would
 * count the same as a degree at the equator and the ordering would visibly skew
 * east-west in northern cities, which is most of this dataset.
 */
export function orderByDistanceFrom<T extends LatLon>(rows: readonly T[], centre: LatLon): T[] {
  const kx = Math.cos((centre.lat * Math.PI) / 180);
  const d2 = (r: LatLon) => {
    const dy = r.lat - centre.lat;
    const dx = (r.lon - centre.lon) * kx;
    return dy * dy + dx * dx;
  };
  // Array.prototype.sort is stable (ES2019+), so equidistant rows keep input order.
  return [...rows].sort((a, b) => d2(a) - d2(b));
}

/**
 * A webcam ref, carrying the title visible at the moment it was added.
 *
 * The map's webcam pins come from the cached directory, so today that directory can
 * always resolve them and `t` looks redundant. It is captured anyway because the ids
 * are the volatile part: §3 records that Windy entries exist through upstream
 * ordering and can vanish with no change on our side, while a slot saved today is
 * read back weeks later. When that happens the choice is this title or
 * "Webcam 1606332744". Display-only, escaped by React, never used to fetch.
 *
 * A blank or whitespace title is dropped rather than stored, because an empty `t`
 * would shadow the directory lookup with nothing and render worse than no title
 * at all. `t` is not part of streamKey, so it never affects de-duplication.
 */
export function webcamRef(id: string, title?: string): StreamRef {
  const t = (title ?? "").trim();
  return t ? { k: "webcam", id, t } : { k: "webcam", id };
}

// ── The cap ─────────────────────────────────────────────────────────────────

/** The slowest cadence any source in this repo actually publishes at (TfL,
 *  Digitraffic, Estonia, Iceland). Used when a row does not declare one: guessing
 *  fast would cap the slot for no measured reason. Mirrors camslot.tsx:33-35. */
export const FALLBACK_REFRESH_SECONDS = 300;

const DEFAULT_DWELL_MS = 5000;

/**
 * How many streams this slot may hold, derived from cadence rather than picked.
 *
 * A slot's whole cycle takes `n * intervalMs`. If that exceeds a member's refresh
 * cadence, that member has published a new frame before its turn comes round again
 * — so the slot refetches every member on every pass, and rotation stops being the
 * cheap thing §7.1 measured it as. The FASTEST-refreshing member therefore sets the
 * cap for everyone, which is why mixing one 60s Caltrans camera into a slot of 300s
 * TfL cameras drops the cap from 60 to 12. That is worth saying out loud in the UI,
 * because "drop that one camera" is a fix the user can act on.
 */
export function cadenceCap(
  refreshSeconds: readonly (number | undefined)[],
  intervalMs: number,
): number {
  const known = refreshSeconds.map((s) =>
    typeof s === "number" && Number.isFinite(s) && s > 0 ? s : FALLBACK_REFRESH_SECONDS,
  );
  if (known.length === 0) return MAX_STREAMS;
  const fastest = Math.min(...known);
  const dwellMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_DWELL_MS;
  const raw = Math.floor(fastest / (dwellMs / 1000));
  return Math.max(1, Math.min(MAX_STREAMS, raw));
}

// ── The append ──────────────────────────────────────────────────────────────

export interface AppendPlan {
  /** The playlist to hand to configure(), or null when there is nothing to write. */
  next: StreamRef[] | null;
  added: number;
  /** Already in the slot. Reported, because "nothing happened" needs a reason. */
  duplicates: number;
  /** Left out for cap reasons. Reported, never silently dropped. */
  refused: number;
  /** Everything the gesture actually covered — the honest denominator. */
  considered: number;
}

/**
 * Plan an append. Pure: decides, does not write.
 *
 * Refuses the overflow rather than truncating quietly. The difference matters —
 * a truncation the user is not told about reads as "the map only found 12 cameras
 * there", which is exactly the claim `describeCoverage` exists to prevent.
 */
export function planAppend(
  existing: readonly StreamRef[],
  incoming: readonly StreamRef[],
  cap: number,
): AppendPlan {
  const limit = Math.max(0, Math.min(MAX_STREAMS, Math.floor(cap)));
  const seen = new Set(existing.map(streamKey));
  const next: StreamRef[] = [...existing];
  let added = 0;
  let duplicates = 0;
  let refused = 0;

  for (const ref of incoming) {
    const key = streamKey(ref);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    if (next.length >= limit) {
      refused++;
      continue;
    }
    seen.add(key);
    next.push(ref);
    added++;
  }

  return { next: added > 0 ? next : null, added, duplicates, refused, considered: incoming.length };
}

export interface AppendNoteOpts {
  /** How many of `considered` have a working feed today. */
  available?: number;
  /** The cap this gesture was planned against. */
  cap: number;
  /** The cadence that SET that cap, in seconds. */
  capSetBySeconds?: number;
  /**
   * Do the cadences in play actually differ?
   *
   * This decides whether "drop the fastest-refreshing camera" is real advice or
   * noise. Measured case that forced it: a box over the Forth crossing is 29
   * Traffic Scotland cameras, every one of them 120s. Telling that user to drop
   * the fastest one is confident, plausible and useless — removing any single
   * camera leaves the cap exactly where it was.
   */
  capMixed?: boolean;
}

function capReason(opts: AppendNoteOpts): string {
  return typeof opts.capSetBySeconds === "number"
    ? ` because a camera here refreshes every ${opts.capSetBySeconds}s`
    : "";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The toast copy. Always says what the gesture really covered, what it added, and
 * what a user could do differently — a bare "showing 12 of 306" tells someone their
 * selection was cut without telling them how to make a different one.
 */
export function describeAppend(plan: AppendPlan, opts: AppendNoteOpts): string {
  const { considered, added, duplicates, refused } = plan;

  if (added === 0 && refused === 0) {
    return duplicates > 0
      ? "Already in this slot, so nothing was added."
      : "Nothing here to add.";
  }
  if (added === 0) {
    return `This slot is full at ${opts.cap}${capReason(opts)}. Remove a camera, or arm an empty slot.`;
  }

  const bits: string[] = [];
  if (considered > added) {
    const live =
      typeof opts.available === "number" && opts.available !== considered
        ? `, ${opts.available} with a live feed`
        : "";
    bits.push(`${plural(considered, "camera")} here${live}.`);
    bits.push(`Added the ${added} nearest the centre.`);
  } else {
    bits.push(`Added ${plural(added, "camera")}.`);
  }
  if (duplicates > 0) bits.push(`${duplicates} already in the slot.`);
  if (refused > 0) {
    bits.push(`${refused} refused, because the cap is ${opts.cap}${capReason(opts)}.`);
    // Only offer the "drop the fastest one" lever when there IS a fastest one to
    // drop. Otherwise a second slot is the honest answer, and it is the shape of
    // the product anyway: a wall is made of slots.
    bits.push(
      opts.capMixed
        ? "Narrow the box, drop the fastest-refreshing camera, or use a second slot."
        : "Narrow the box, or use a second slot.",
    );
  }
  return bits.join(" ");
}
