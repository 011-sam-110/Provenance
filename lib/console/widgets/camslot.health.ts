"use client";
// Which streams in a slot are currently answering, and which have stopped.
//
// THE BUG THIS EXISTS TO FIX (found by QA, 2026-08-15). A dead stream rendered its
// honest "no longer published" placeholder and then kept being re-fetched: measured
// ~19 requests to the same 404 within two minutes. Two paths caused it, and neither
// knew about the other — every rotation back to a dead stream remounts its view with
// a fresh `failed=false`, and the history recorder fetches on its own schedule.
//
// /api/proxy uses a 10s upstream timeout against a rotation dwell of a few seconds,
// so a dead stream always has a request in flight when its next turn arrives. Six
// dead cameras in one slot is thousands of pointless invocations an hour from a
// single tab, against free public feeds we have no contract with.
//
// A FETCH THAT WORKED CAN STILL BE A DEAD CAMERA (2026-10-24). Caltrans answers a
// camera that is down with HTTP 200 and its "Temporarily Unavailable" card, so a
// wall over downtown Los Angeles showed that card on four tiles of nine while this
// bench counted every one of them as answering. camslot.picture.ts now judges the
// picture itself, and a known card or a black frame arrives here as a failure with
// its own reason. A black frame takes the same two strikes as a fetch that failed.
// A known card takes one (CARD_FAILURES_BEFORE_DROP): it is the operator saying the
// camera is down, not a blip. Otherwise the reason only changes what the tile says.
//
// The pure half is separated from the store so the decision rules are unit-testable
// in the node environment, with no fake timers and no DOM.

import { useSyncExternalStore } from "react";
import { streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";

/** Two strikes. One failure is a blip — a proxy cold start, a momentary upstream
 *  wobble — and dropping on the first would hide cameras that are fine. The same
 *  holds for a black frame: a camera switching its source can send one. */
export const FAILURES_BEFORE_DROP = 2;
/**
 * One strike for a KNOWN operator card. A fingerprint match is not a blip: on
 * 2026-10-24 the nearest real road frame sat 116 trits from the card, against a
 * match threshold of 20 (camslot.picture.ts). With two strikes the wall showed a
 * card for a whole dwell before it was benched, about 2 minutes on a tile with one
 * camera.
 */
export const CARD_FAILURES_BEFORE_DROP = 1;
/** Minutes-scale, per the spec. Long enough that a dead feed costs nothing, short
 *  enough that a camera coming back is picked up within one rotation of a long
 *  playlist rather than needing a reload. */
export const RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * Why a stream failed.
 *  - "fetch": our request for it did not work. The only kind before 2026-10-24.
 *  - "placeholder": it answered with its operator's own "unavailable" card.
 *  - "black": it answered with a frame that is black everywhere.
 */
export type BenchReason = "fetch" | "placeholder" | "black";

/** What a view reports. `true` is a picture that arrived and is worth showing;
 *  `false` is a fetch that failed; the two strings are a picture that arrived and is
 *  not one (see camslot.picture.ts). */
export type StreamOutcome = boolean | "placeholder" | "black";

export interface StreamHealth {
  /** Consecutive failures. Reset to 0 by any success. */
  failures: number;
  /** When the last failure was recorded. */
  lastFailedAt: number;
  /** Why the LAST failure was one. Absent reads as "fetch", which is what every
   *  failure meant before pictures were judged. */
  reason?: BenchReason;
}

export type HealthMap = Readonly<Record<string, StreamHealth>>;

// ── Pure rules ──────────────────────────────────────────────────────────────

/** How many failures in a row bench a stream, by the reason of the last one. */
export function failuresBeforeDrop(reason: BenchReason | undefined): number {
  return reason === "placeholder" ? CARD_FAILURES_BEFORE_DROP : FAILURES_BEFORE_DROP;
}

/** Is this stream currently benched? Benched means "do not fetch", not "forever":
 *  after RETRY_AFTER_MS it becomes eligible again so a recovered camera returns. */
export function isBenched(h: StreamHealth | undefined, now: number): boolean {
  if (!h || h.failures < failuresBeforeDrop(h.reason)) return false;
  return now - h.lastFailedAt < RETRY_AFTER_MS;
}

/** Why a stream is benched, for the words. */
export function benchReason(h: StreamHealth | undefined): BenchReason {
  return h?.reason ?? "fetch";
}

/** The streams a slot should actually rotate through. */
export function liveStreams(streams: readonly StreamRef[], health: HealthMap, now: number): StreamRef[] {
  return streams.filter((s) => !isBenched(health[streamKey(s)], now));
}

/**
 * Each reason's sentence, in two forms. `some` is for when the tile still has
 * something to show; `only` is for when the benched streams are everything the tile
 * has and nothing else is on screen, where "so it is skipped" would describe a
 * rotation that is not happening.
 *
 * The fetch wording is the original and says "not answering", not "offline": we
 * observed our own fetch fail, which is not the same as knowing the operator took
 * the camera down. The card wording, by contrast, reports what the operator itself
 * is showing, so it can say the camera is unavailable in the operator's own word.
 */
const SENTENCES: Record<BenchReason, { some: (n: number) => string; only: (n: number) => string }> = {
  fetch: {
    some: (n) => (n === 1 ? "1 stream is not answering, so it is skipped." : `${n} streams are not answering, so they are skipped.`),
    only: (n) => (n === 1 ? "This stream is not answering." : `None of these ${n} streams are answering.`),
  },
  placeholder: {
    some: (n) =>
      n === 1
        ? "1 camera here shows its operator's 'unavailable' card, so it is skipped."
        : `${n} cameras here show their operator's 'unavailable' card, so they are skipped.`,
    only: (n) =>
      n === 1 ? "This camera shows its operator's 'unavailable' card." : `All ${n} cameras here show their operator's 'unavailable' card.`,
  },
  black: {
    some: (n) =>
      n === 1 ? "1 camera here sends only a black picture, so it is skipped." : `${n} cameras here send only a black picture, so they are skipped.`,
    only: (n) => (n === 1 ? "This camera sends only a black picture." : `All ${n} cameras here send only a black picture.`),
  },
};
const REASON_ORDER: readonly BenchReason[] = ["fetch", "placeholder", "black"];

/**
 * How to describe the benched ones. Returns null when there is nothing to say —
 * a slot with everything working must not carry a reassuring "0 unavailable" line.
 *
 * One sentence per reason present, in a fixed order, so two tiles in the same state
 * say the same thing. `showingOther` is true when the tile is showing a camera that
 * is not its own (camslot.refill.ts): its own may all be benched and yet the tile is
 * not empty, so they are described as skipped rather than as all there is.
 */
export function benchedNote(
  streams: readonly StreamRef[],
  health: HealthMap,
  now: number,
  opts: { showingOther?: boolean } = {},
): string | null {
  const counts: Record<BenchReason, number> = { fetch: 0, placeholder: 0, black: 0 };
  let n = 0;
  for (const s of streams) {
    const h = health[streamKey(s)];
    if (!isBenched(h, now)) continue;
    counts[benchReason(h)] += 1;
    n += 1;
  }
  if (n <= 0) return null;
  const present = REASON_ORDER.filter((r) => counts[r] > 0);
  if (n === streams.length && !opts.showingOther && present.length === 1) {
    return SENTENCES[present[0]].only(n);
  }
  return present.map((r) => SENTENCES[r].some(counts[r])).join(" ");
}

/** Fold one outcome into a stream's record. Pure, so the reducer is testable. */
export function applyOutcome(prev: StreamHealth | undefined, outcome: StreamOutcome, now: number): StreamHealth {
  if (outcome === true) return { failures: 0, lastFailedAt: 0 };
  return {
    failures: (prev?.failures ?? 0) + 1,
    lastFailedAt: now,
    reason: outcome === false ? "fetch" : outcome,
  };
}

// ── Store ───────────────────────────────────────────────────────────────────
//
// Deliberately NOT persisted and NOT in widget config. It is an observation about
// right now, and writing it to the board archive would mark the board "customised"
// (see camslot.prefs.ts) and pin a stale verdict across reloads.

let health: HealthMap = {};
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export const streamHealth = {
  get(): HealthMap {
    return health;
  },
  report(ref: StreamRef, outcome: StreamOutcome, now: number = Date.now()): void {
    const key = streamKey(ref);
    const next = applyOutcome(health[key], outcome, now);
    const prev = health[key];
    // Only emit on a change that matters, or every image load would re-render every
    // slot on the board. A changed reason matters: it changes what the tile says.
    if (prev && prev.failures === next.failures && prev.reason === next.reason) return;
    health = { ...health, [key]: next };
    emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Test-only. */
  __reset(): void {
    health = {};
    emit();
  },
};

export function useStreamHealth(): HealthMap {
  return useSyncExternalStore(
    streamHealth.subscribe,
    streamHealth.get,
    () => ({}) as HealthMap,
  );
}

// ── The bench clock ─────────────────────────────────────────────────────────
//
// ONE clock for the whole board, ticking once a minute. The bench has a five-minute
// retry window, so re-evaluating it every second would re-render every slot sixty
// times more often than the answer can change.
//
// It is shared, not one interval per tile, because tiles now decide TOGETHER: a tile
// with nothing working borrows a camera from another (camslot.refill.ts), and every
// tile computes that same board-wide plan for itself. With a clock each, two tiles a
// few seconds apart around a retry would disagree about whether a camera is benched,
// and one camera could be drawn on both of them, or on neither.

export const BENCH_CLOCK_MS = 60_000;

let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

export const benchClock = {
  get(): number {
    return clockNow;
  },
  subscribe(fn: () => void): () => void {
    clockListeners.add(fn);
    if (!clockTimer) {
      clockNow = Date.now();
      clockTimer = setInterval(() => {
        clockNow = Date.now();
        for (const l of clockListeners) l();
      }, BENCH_CLOCK_MS);
    }
    return () => {
      clockListeners.delete(fn);
      if (clockListeners.size === 0 && clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  },
};

export function useBenchClock(): number {
  // The server snapshot is 0: nothing is benched on the server, so the value never
  // reaches the markup and cannot cause a hydration mismatch.
  return useSyncExternalStore(benchClock.subscribe, benchClock.get, () => 0);
}
