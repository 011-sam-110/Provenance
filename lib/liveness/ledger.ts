/**
 * The ledger: which cameras a human has personally watched play, and the gate that
 * lets only those onto the map.
 *
 * THE RULE. A camera from a gated feed stays off the map until somebody has watched its
 * stream produce frames and signed for it. Default-DENY, so the map only ever grows by
 * a deliberate act. That is a claim the look-alike products structurally cannot make,
 * and it is worth nothing at all if the gate ever fails open.
 *
 * WHY THE EXISTING FEEDS ARE EXEMPT, AND WHY THE EXEMPTION IS TYPED OUT BY HAND.
 * Applied to everything, this gate would empty the map: the 1,467 live and 18,921 still
 * cameras already shipping have no ledger entries, so all of them would disappear on the
 * first deploy. So the feeds that existed before this work are grandfathered.
 *
 * That list is a LITERAL rather than something derived from the registry, and the
 * difference matters. Derived, it would grandfather every feed that ever gets added,
 * which is the gate quietly disabling itself the moment it is most needed — an
 * invariant made true by construction, which can never go red. Typed out, a new feed is
 * in neither set until someone decides, and `liveness-gate.test.ts` says so out loud.
 */

import type { Camera } from "@/lib/types";
import type { StreamKind } from "@/lib/liveness/scan";

/** One camera a human watched play, and the evidence they were looking at. */
export interface AdmittedCamera {
  /** `${source}:${nativeId}`, matching Camera.id. */
  cameraId: string;
  /** The registry key of the feed it came from. Checked, not assumed from the id. */
  feed: string;
  streamUrl: string;
  kind: StreamKind;
  /**
   * How long the stream was CONTINUOUSLY producing frames when the verdict was signed.
   *
   * Not "did it play". A stream that yields one frame and then stalls would pass that,
   * and under a per-camera signature the recorded fact has to be the stronger one. This
   * is what makes the admission checkable later rather than merely asserted.
   */
  producingMs: number;
  signedAt: string;
  /** Free text, for the rare admission that needs a sentence. */
  note?: string;
}

export interface RejectedCamera {
  cameraId: string;
  feed: string;
  reason: "dead" | "wrong-pin" | "not-a-camera" | "unsure" | "feed-abandoned";
  signedAt: string;
  /**
   * How long the reviewer actually waited before calling it dead.
   *
   * Recorded because rejection is the direction that fails INVISIBLY. An admission
   * that should not have happened is a wrong camera on the map, which someone can see.
   * A rejection that should not have happened is a good camera that silently never
   * appears, with nothing anywhere saying so — and under default-deny it never gets a
   * second chance. Keeping the wait makes a too-hasty pass reviewable after the fact
   * instead of unrecoverable. Absent on feed-abandoned, which is not a per-camera
   * observation.
   */
  waitedMs?: number;
}

/**
 * Measured time to first painted frame on live camera streams, from the Streets board
 * on 2026-09-08: of 20 consecutive switches, 7 never painted inside 15s, and the ones
 * that did averaged about 8.9s.
 *
 * This is why the deck warns before an early rejection. A reviewer pressing "dead" at
 * three seconds would be rejecting roughly a third of perfectly good cameras, and the
 * ledger would record a confident human verdict about a stream that had not finished
 * connecting.
 */
export const MEASURED_FIRST_PAINT_MS = 8_900;
export const EARLY_REJECT_WARNING_MS = 12_000;

export interface LiveLedger {
  version: 1;
  admitted: AdmittedCamera[];
  rejected: RejectedCamera[];
}

export function emptyLedger(): LiveLedger {
  return { version: 1, admitted: [], rejected: [] };
}

/**
 * The seventeen feeds live before per-camera admission existed (2026-09-08).
 *
 * Hand-typed on purpose — see the note at the top of this file. Adding a feed here is
 * a decision to put its cameras on the map WITHOUT anyone having watched them, so it
 * should be awkward and visible, not automatic.
 */
export const GRANDFATHERED_SOURCES: ReadonlySet<string> = new Set([
  "tfl",
  "caltrans",
  "scdot",
  "digitraffic",
  "castlerock",
  "tripcheck",
  "drivebc",
  "nzta",
  "iceland",
  "estonia",
  "trafficscotland",
  "cetsp",
  "mup-rs",
  "putevi-rs",
  "bihamk",
  "act-pr",
  "houston-transtar",
]);

/**
 * How long a stream must have been producing frames before an admission is accepted.
 *
 * PROVISIONAL, and the report says so. Stage A was meant to choose this from measured
 * time-to-first-frame across real streams, and it could not: the twelve silent feeds
 * yielded no playable live stream to measure (see
 * docs/superpowers/research/2026-09-08-liveness-stage-a-findings.md). So this is a
 * round number standing in for data, which is exactly what the design said not to ship
 * — the difference is that it is written down here rather than buried in a component.
 *
 * It errs long on purpose. Too short admits a stall; too long only costs the reviewer
 * seconds per card. Replace it the moment a real acquisition run produces latencies.
 */
export const MIN_PRODUCING_MS = 5_000;

/** Did a human sign for this exact camera, from this exact feed? */
export function isAdmitted(ledger: LiveLedger, feed: string, cameraId: string): boolean {
  return ledger.admitted.some((a) => a.cameraId === cameraId && a.feed === feed);
}

/**
 * Filter one feed output down to what has been admitted.
 *
 * An ungated source passes through untouched. A gated source with an empty ledger emits
 * NOTHING — failing open here would put unverified cameras on the map silently, which
 * is the entire failure this exists to prevent.
 */
export function gateCameras(
  cameras: Camera[],
  sourceKey: string,
  ledger: LiveLedger,
  gatedSources: ReadonlySet<string>,
): Camera[] {
  if (!gatedSources.has(sourceKey)) return cameras;
  return cameras.filter((c) => isAdmitted(ledger, sourceKey, c.id));
}

/**
 * Feeds subject to the gate. Empty until the first new live feed is acquired, and it
 * must never overlap GRANDFATHERED_SOURCES — a key in both would delete cameras that
 * are already on the map.
 */
export const GATED_SOURCES: ReadonlySet<string> = new Set<string>([]);
