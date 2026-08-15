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
// The pure half is separated from the store so the decision rules are unit-testable
// in the node environment, with no fake timers and no DOM.

import { useSyncExternalStore } from "react";
import { streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";

/** Two strikes. One failure is a blip — a proxy cold start, a momentary upstream
 *  wobble — and dropping on the first would hide cameras that are fine. */
export const FAILURES_BEFORE_DROP = 2;
/** Minutes-scale, per the spec. Long enough that a dead feed costs nothing, short
 *  enough that a camera coming back is picked up within one rotation of a long
 *  playlist rather than needing a reload. */
export const RETRY_AFTER_MS = 5 * 60 * 1000;

export interface StreamHealth {
  /** Consecutive failures. Reset to 0 by any success. */
  failures: number;
  /** When the last failure was recorded. */
  lastFailedAt: number;
}

export type HealthMap = Readonly<Record<string, StreamHealth>>;

// ── Pure rules ──────────────────────────────────────────────────────────────

/** Is this stream currently benched? Benched means "do not fetch", not "forever":
 *  after RETRY_AFTER_MS it becomes eligible again so a recovered camera returns. */
export function isBenched(h: StreamHealth | undefined, now: number): boolean {
  if (!h || h.failures < FAILURES_BEFORE_DROP) return false;
  return now - h.lastFailedAt < RETRY_AFTER_MS;
}

/** The streams a slot should actually rotate through. */
export function liveStreams(streams: readonly StreamRef[], health: HealthMap, now: number): StreamRef[] {
  return streams.filter((s) => !isBenched(health[streamKey(s)], now));
}

/**
 * How to describe the benched ones. Returns null when there is nothing to say —
 * a slot with everything working must not carry a reassuring "0 unavailable" line.
 *
 * Note it says "not answering", not "offline": we observed our own fetch fail, which
 * is not the same as knowing the operator took the camera down.
 */
export function benchedNote(streams: readonly StreamRef[], health: HealthMap, now: number): string | null {
  const n = streams.length - liveStreams(streams, health, now).length;
  if (n <= 0) return null;
  if (n === streams.length) {
    return n === 1 ? "This stream is not answering." : `None of these ${n} streams are answering.`;
  }
  return n === 1 ? "1 stream is not answering — skipped." : `${n} streams are not answering — skipped.`;
}

/** Fold one outcome into a stream's record. Pure, so the reducer is testable. */
export function applyOutcome(prev: StreamHealth | undefined, ok: boolean, now: number): StreamHealth {
  if (ok) return { failures: 0, lastFailedAt: 0 };
  return { failures: (prev?.failures ?? 0) + 1, lastFailedAt: now };
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
  report(ref: StreamRef, ok: boolean, now: number = Date.now()): void {
    const key = streamKey(ref);
    const next = applyOutcome(health[key], ok, now);
    const prev = health[key];
    // Only emit on a change that matters, or every image load would re-render every
    // slot on the board.
    if (prev && prev.failures === next.failures) return;
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
