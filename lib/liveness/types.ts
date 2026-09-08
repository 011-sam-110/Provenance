/**
 * The review queue's shapes and its pure helpers, with NO filesystem.
 *
 * WHY THIS IS SEPARATE FROM queue.ts. The deck is a client component, and importing a
 * type from a module that also imports `node:fs` pulls that module into the browser
 * bundle — a type import is erased by the compiler but the module specifier is not.
 * The result is green tsc, a green test suite, and `next build` failing with "Module
 * not found" so production silently stops deploying.
 *
 * That is not hypothetical here: LiveDeck.tsx did exactly this, and
 * tests/unit/client-bundle-node-builtins.test.ts caught it. So the split is load-bearing
 * rather than tidiness — anything the client touches lives in this file, and queue.ts
 * keeps the I/O.
 */

import type { StreamKind } from "@/lib/liveness/scan";

/** One candidate awaiting a human. Everything the deck needs to render a card. */
export interface QueueCamera {
  cameraId: string;
  feed: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  streamUrl: string;
  kind: StreamKind;
  /** A still to show while the stream warms up, where the feed has one. */
  imageUrl?: string;
  operator: string;
  license: string;
  attribution: string;
  /**
   * What the machine already found, shown to the reviewer rather than hidden.
   *
   * A card whose probe said `live` two hours ago and is black now is a DIFFERENT
   * judgement from a card nothing was ever known about, and the reviewer should be able
   * to tell those apart without leaving the deck.
   */
  probe?: {
    status: "live" | "dead" | "unknown" | "unplayable";
    reason: string;
    firstByteMs?: number;
    refererUsed?: string;
    at?: string;
  };
  /** Anything the gates flagged, verbatim. */
  flags?: string[];
}

export interface LiveQueue {
  version: 1;
  generatedAt: string;
  cameras: QueueCamera[];
}

export function emptyQueue(): LiveQueue {
  return { version: 1, generatedAt: new Date(0).toISOString(), cameras: [] };
}

/**
 * Honest time remaining, in hours, at a given unlock threshold.
 *
 * Shown instead of a card count because the two differ by two orders of magnitude at
 * the scale this queue can reach: 70,000 cards at a five-second unlock is about 97
 * hours, and "70,000 remaining" reads like a number somebody could work through.
 */
export function hoursRemaining(count: number, unlockMs: number): number {
  // Unlock plus a second of human decision time, which is generous downward -- the
  // estimate should not be the one that flatters the tool.
  return (count * (unlockMs + 1_000)) / 3_600_000;
}
