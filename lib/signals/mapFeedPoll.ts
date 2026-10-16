// lib/signals/mapFeedPoll.ts
// How the MAP reads one signal layer: one request to /api/signals/<id>, and when to
// ask again. WorldMap's <SignalFeed> is the only caller; it owns what the rows turn
// into (WorldObjects, the scope crop, the counts). This file owns the read and the
// clock, with no React and no DOM, so the clock can be tested.
//
// THE BUG THIS FILE EXISTS FOR (2026-10-16). Sampo turned on "Submarine cables" and
// "Cable landing stations" and neither drew, with both rows ON in the rail. The map
// read each layer once on mount and then waited `refreshMs` before it asked again,
// whatever the first read had returned. For those two layers that is SIX HOURS
// (lib/signals/cables.ts). So ONE failed read left the layer empty for six hours:
//   - a 502 while the server restarts after a deploy (the body is not JSON),
//   - a cold server whose first cables read degrades to `ok:false` with no rows
//     (the geometry call to TeleGeography timed out),
//   - a body cut off mid-stream (a browser disk-cache write that fails, measured on
//     /api/cameras, see the note in WorldMap's CamerasFeed).
// The failure also WIPED the rows the layer already had, and said nothing in the
// console. The route already learnt this lesson for its own cache (cacheTtl.ts:
// "one slow cold load blanked that layer for six hours"); the client had not.
//
// THE RULE NOW:
//   - a failed read is asked again soon: 30 s, then doubling, never later than
//     EMPTY_RETRY_MS (5 min) and never later than the layer's own cadence;
//   - a failed read keeps the rows the layer already shows (last-good). With no
//     rows yet it hands on an empty list, as before, so the count reads 0;
//   - the request skips the browser's HTTP cache (`cache: "no-store"`). The edge
//     still caches; the browser copy never helped a once-per-mount read.

import type { SignalFeature } from "@/lib/signals/types";
import { EMPTY_RETRY_MS } from "@/lib/signals/cacheTtl";
import { signalReadSucceeded } from "@/lib/console/signals/useSignalFeed";

/** The shortest cadence any layer polls at, so a misconfigured 0 cannot spin. */
export const MIN_POLL_MS = 30_000;
/** The first retry after a failed read. Each further failure doubles it. */
export const FIRST_RETRY_MS = 30_000;

/** What one read of /api/signals/<id> gave. */
export type MapSignalRead =
  | { ok: true; features: SignalFeature[]; declaredOk: boolean | undefined }
  | { ok: false; reason: string };

/**
 * How long to wait before the next read.
 *
 * `failures` is the number of failed reads in a row (0 after a good one). A good
 * read waits the layer's cadence. A failed one waits FIRST_RETRY_MS, doubling per
 * failure, capped at EMPTY_RETRY_MS and at the cadence itself, so a fast layer is
 * never slowed down by a failure.
 */
export function nextPollMs(refreshMs: number, failures: number): number {
  const cadence = Math.max(MIN_POLL_MS, Number.isFinite(refreshMs) ? refreshMs : MIN_POLL_MS);
  if (failures <= 0) return cadence;
  const backoff = FIRST_RETRY_MS * 2 ** Math.min(failures - 1, 16);
  return Math.min(cadence, EMPTY_RETRY_MS, backoff);
}

/**
 * Read one layer. Never throws: every way a read can fail comes back as
 * `{ ok: false, reason }`.
 *
 * A failure is: no response, a non-2xx status, a body that is not JSON, or a
 * declared failure with nothing in it (`ok: false` and no rows, the route's
 * "geometry fetch failed" on a cold server). A declared failure that still carries
 * rows is the route's last-good copy and counts as a read, as in useSignalFeed.
 */
export async function readMapSignal(
  id: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<MapSignalRead> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/signals/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch (err) {
    return { ok: false, reason: `request failed: ${String(err)}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  let d: Record<string, unknown> | null;
  try {
    d = (await res.json()) as Record<string, unknown> | null;
  } catch {
    return { ok: false, reason: "body was not JSON (cut off, or an error page)" };
  }
  const features = Array.isArray(d?.features) ? (d!.features as SignalFeature[]) : [];
  if (!signalReadSucceeded(d, features.length)) {
    const why = typeof d?.degradedReason === "string" ? d.degradedReason : "declared failure";
    return { ok: false, reason: `no rows: ${why}` };
  }
  return { ok: true, features, declaredOk: typeof d?.ok === "boolean" ? d.ok : undefined };
}

export interface MapSignalPollOptions {
  id: string;
  refreshMs: number;
  read: (id: string) => Promise<MapSignalRead>;
  /** A good read. */
  onRows: (features: SignalFeature[], declaredOk: boolean | undefined) => void;
  /**
   * A failed read. `hadRows` says whether the layer still shows rows from an earlier
   * good read; the caller keeps them and only empties a layer that never had any.
   */
  onFailure: (reason: string, hadRows: boolean) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Start polling one layer. Reads at once, then on the clock `nextPollMs` sets.
 * Returns a stop function; nothing is delivered after stop.
 */
export function startMapSignalPoll(opts: MapSignalPollOptions): () => void {
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let alive = true;
  let failures = 0;
  let hadRows = false;
  let timer: unknown = null;

  const tick = () => {
    timer = null;
    void opts.read(opts.id).then((r) => {
      if (!alive) return;
      // The next read is booked whatever the callbacks do: a callback that throws
      // must not end the loop, or the layer is frozen for the session.
      try {
        if (r.ok) {
          failures = 0;
          hadRows = r.features.length > 0;
          opts.onRows(r.features, r.declaredOk);
        } else {
          failures += 1;
          opts.onFailure(r.reason, hadRows);
        }
      } catch (err) {
        console.error(`[signals:${opts.id}] map layer could not use a read:`, err);
      } finally {
        if (alive) timer = setTimer(tick, nextPollMs(opts.refreshMs, failures));
      }
    });
  };
  tick();

  return () => {
    alive = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
}
