"use client";
// The Terminal footer's scrolling ticker.
//
// EVERY FIGURE ON THIS LINE IS REAL, OR IT IS NOT ON THE LINE. The design file
// ships a hardcoded ticker string; that string is the visual target, never the
// data source. What scrolls here is composed from state the app has ALREADY
// produced for other reasons:
//
//   * the four core map layers  → lib/metrics (metricsStore, written by WorldMap)
//                                 + lib/freshness (was the last fetch ok? has one
//                                 ever completed?) + lib/layers (is it even on?)
//   * the 37 signal layers      → the same three inputs the FEED HEALTH strip uses,
//                                 rolled up by the shared pure buildFeedCells() /
//                                 feedCounts() so the strip and the ticker can never
//                                 disagree about how many layers are live.
//
// WHAT IS DELIBERATELY ABSENT, AND WHY. Markets. lib/console/widgets/markets.tsx
// reads /api/markets through useJsonPoll, which holds its state in the CALLING
// component — there is no shared cache, so a quote in this footer would mean a
// second independent poll of a keyless upstream on every page, mounted whether or
// not the user has the markets widget open. The brief's rule settles it: a figure
// that needs a new network call is left out rather than invented, because a made-up
// number scrolling past in a 9.5px ticker is unfalsifiable at the point of viewing —
// exactly the lie this product exists not to tell. If the integrator later hoists
// the markets payload into a shared store, add a segment here; do not add a fetch.
//
// NO FIGURE IS EVER PRINTED BARE WHEN WE DO NOT HAVE IT. A layer that is switched
// off says OFF, one whose last attempt failed says DOWN, one that has never
// completed a fetch says CONNECTING…, and one that fetched and got nothing says
// NONE NOW. The words are lifted from lib/console/freshChip.ts's vocabulary rather
// than invented, so the ticker reads in the same language as the rail and the
// widget headers.
//
// ─────────────────────────────────────────────────────────────────────────────
// CSS THIS FILE NEEDS (integrator: add to app/globals.css under .tn-terminal).
// `om-ticker` is the design's named keyframe and is shared with nothing else.
//
//   .tnx-ticker      { flex:1 1 auto; min-width:0; display:flex; align-items:center;
//                      overflow:hidden; white-space:nowrap; }
//   .tnx-ticker-track{ display:flex; align-items:center; flex:none;
//                      animation: om-ticker 55s linear infinite; will-change:transform; }
//   .tnx-ticker-item { flex:none; padding-right:3rem; color:var(--tnx-ink-faint);
//                      letter-spacing:0.06em; font-variant-numeric:tabular-nums; }
//
//   @keyframes om-ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
//
//   @media (prefers-reduced-motion: reduce) {
//     .tnx-ticker-track { animation: none; }
//     .tnx-ticker-item + .tnx-ticker-item { display: none; }
//   }
//
// Two notes on that CSS, both load-bearing:
//  - translateX(-50%) is half the TRACK, and the track holds exactly two identical
//    items, so half the track is exactly one item — which is what makes the loop
//    seamless. The trailing padding lives on the item (not the track) so both
//    halves stay identical in width; put it on the track and the second copy butts
//    straight up against the first.
//  - REDUCED MOTION IS HANDLED IN CSS, NOT JS. The component always renders both
//    copies; the media query stops the animation and hides the duplicate, so the
//    user gets one static line. Doing it in CSS rather than matchMedia keeps this
//    component free of a window read at first paint (there is no jsdom in this
//    repo's vitest, and a matchMedia branch would also risk an SSR/client
//    hydration mismatch on the very first frame).
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useMetrics } from "@/lib/metrics";
import { useLayers } from "@/lib/layers";
import { useFreshness } from "@/lib/freshness";
import { SIGNALS } from "@/lib/signals/registry";
import { useSignals } from "@/lib/signals/store";
import { classifySignalFreshness, useSignalFreshness } from "@/lib/signals/freshness";
import { unifySignalFresh, type FreshKind } from "@/lib/sources/freshKind";
import { useStatus } from "@/lib/sources/useStatus";
import { buildFeedCells, feedCounts, type FeedCounts } from "@/lib/terminal/feedHealth";
import { groupDigits } from "@/lib/signals/coverage";
import { useNow } from "@/lib/shell/useNow";

/**
 * How often the signal roll-up is re-derived.
 *
 * The freshness store already re-renders this component every time ANY switched-on
 * layer completes a fetch, so the only transition a clock is needed for is the one
 * that happens when nothing arrives: live → lagging → stale. 30s is well under the
 * 60s floor useSignalFeed puts on a layer's cadence, so a stalling feed is caught
 * within one tick of when it becomes provable.
 *
 * The timer is safe here ONLY because the ticker is aria-hidden. tests/unit/
 * shell-a11y.test.ts pins the rule this protects: a live region must not recite
 * churning numbers. The clock also lives in THIS component rather than in
 * TerminalFooter on purpose — a tick here must not re-render the footer's
 * aria-live selection block.
 */
const TICK_MS = 30_000;

// The state words, taken from lib/console/freshChip.ts's vocabulary rather than
// invented, and upper-cased because the whole ticker is upper-case by design.
const OFF = "OFF";
const DOWN = "DOWN";
const CONNECTING = "CONNECTING…";
const NONE_NOW = "NONE NOW";

/** The separator between ticker segments. The design uses "·" throughout. */
export const TICKER_SEP = " · ";

/** One core map layer's honest reading. All four fields come from a real store. */
export interface TickerLayerReading {
  /** Display label, already upper-case, e.g. "CAMERAS". */
  label: string;
  /** Is the layer switched on? An off layer is not being fetched at all. */
  on: boolean;
  /** Did the last completed attempt succeed? (lib/freshness SourceRecord.ok) */
  ok: boolean;
  /** Has ANY fetch ever completed? (SourceRecord.lastUpdate != null) */
  seen: boolean;
  count: number;
  /** Optional tail, e.g. "19,112 ONLINE". Printed only alongside a real count. */
  extra?: string;
}

export interface BuildTickerLineInput {
  /** SIGNALS.length, passed in — never a literal. The registry has grown twice already. */
  signalLayers: number;
  counts: FeedCounts;
  layers: readonly TickerLayerReading[];
}

/**
 * PURE. One core layer's segment.
 *
 * The order of the branches IS the honesty policy, worst-and-most-specific first:
 *   off        — we are not fetching it, so we know nothing and claim nothing.
 *   down       — the last attempt failed. Never dressed up as "nothing to report".
 *   connecting — nothing has completed yet. Not a failure, and not an empty result
 *                either; printing "0" here would assert a reading we do not have.
 *   none now   — a completed fetch returned nothing. That is a real answer.
 *   the count  — the only branch that prints a number.
 */
export function layerReadingSegment(r: TickerLayerReading): string {
  if (!r.on) return `${r.label} ${OFF}`;
  if (!r.ok) return `${r.label} ${DOWN}`;
  if (!r.seen) return `${r.label} ${CONNECTING}`;
  if (r.count <= 0) return `${r.label} ${NONE_NOW}`;
  const n = groupDigits(r.count);
  return r.extra ? `${r.label} ${n}${TICKER_SEP}${r.extra}` : `${r.label} ${n}`;
}

/**
 * PURE. The whole line.
 *
 * Always non-empty: the registered-layer count is a fact the app holds before any
 * network call, so the ticker never scrolls a blank track on a cold load. LAG,
 * DOWN and NEEDS KEY are printed only when non-zero — a run of "0 LAG · 0 DOWN"
 * is noise, whereas LIVE and DORMANT are the two the reader is actually scanning
 * for and are always shown, including when LIVE is legitimately zero.
 *
 * NEEDS KEY reads 0 both when this deployment holds every credential AND when
 * GET /api/status has not answered yet (buildFeedCells folds an unknown status
 * into dormant rather than guessing). Omitting the segment at zero therefore
 * omits it in exactly the two cases where printing it would assert something we
 * cannot back.
 */
export function buildTickerLine(input: BuildTickerLineInput): string {
  const segs: string[] = [];
  for (const r of input.layers) segs.push(layerReadingSegment(r));
  segs.push(`${input.signalLayers} SIGNAL LAYERS`);
  segs.push(`${input.counts.live} LIVE`);
  if (input.counts.lag > 0) segs.push(`${input.counts.lag} LAG`);
  if (input.counts.down > 0) segs.push(`${input.counts.down} DOWN`);
  if (input.counts.key > 0) segs.push(`${input.counts.key} NEEDS KEY`);
  segs.push(`${input.counts.dormant} DORMANT`);
  return segs.join(TICKER_SEP);
}

export default function TickerLine() {
  const metrics = useMetrics();
  const layers = useLayers();
  const records = useFreshness();
  const signalsOn = useSignals();
  const signalFresh = useSignalFreshness();
  const status = useStatus();
  const now = useNow(TICK_MS);

  // lib/freshness seeds all four ids up front with lastUpdate: null, so this map
  // always has every key — but read it defensively anyway, because a missing
  // record must degrade to CONNECTING… (we have no evidence) and never to a count.
  const core = useMemo(() => {
    const m = new Map<string, { ok: boolean; seen: boolean }>();
    for (const r of records) m.set(r.id, { ok: r.ok, seen: r.lastUpdate != null });
    return m;
  }, [records]);

  const counts = useMemo(() => {
    // `on` is derived from signalsStore, NOT from the freshness store: the freshness
    // store keeps a record for a layer that has since been switched off, and reviving
    // that as a live cell is the lie buildFeedCells was written to prevent.
    const on = new Set<string>();
    const kinds: Record<string, FreshKind> = {};
    for (const s of SIGNALS) {
      if (signalsOn[s.id] === true) on.add(s.id);
      const rec = signalFresh[s.id];
      if (rec) {
        kinds[s.id] = unifySignalFresh(
          classifySignalFreshness({ ...rec, refreshMs: s.refreshMs }, now),
        );
      }
    }
    return feedCounts(
      buildFeedCells({
        // SignalSource calls it `label`; FeedCell calls it `title`. Map, don't rename.
        signals: SIGNALS.map((s) => ({ id: s.id, title: s.label })),
        status,
        fresh: kinds,
        on,
      }),
    );
  }, [signalsOn, signalFresh, status, now]);

  const line = useMemo(() => {
    const read = (
      label: string,
      id: string,
      on: boolean,
      count: number,
      extra?: string,
    ): TickerLayerReading => {
      const c = core.get(id);
      return { label, on, ok: c?.ok ?? true, seen: c?.seen === true, count, extra };
    };
    return buildTickerLine({
      signalLayers: SIGNALS.length,
      counts,
      layers: [
        // Cameras carry a second figure because "how many are reachable right now"
        // is the number the coverage claim rests on, and total-without-online reads
        // as if every camera in the registry were up.
        read(
          "CAMERAS",
          "cameras",
          layers.cameras,
          metrics.camerasTotal,
          `${groupDigits(metrics.camerasOnline)} ONLINE`,
        ),
        // Planes and satellites are stamped into the freshness store by WorldMap the
        // moment their (initially empty) object arrays first settle, so for these two
        // the CONNECTING… window is effectively zero and a cold load reads NONE NOW
        // for a beat. That is a quirk of where WorldMap records them, not something
        // to paper over here — NONE NOW is still true at that instant.
        read("PLANES", "planes", layers.planes, metrics.planes),
        read("SATELLITES", "satellites", layers.satellites, metrics.satellites),
        read("WEBCAMS", "webcams", layers.webcams, metrics.webcams),
      ],
    });
  }, [core, counts, layers, metrics]);

  return (
    // aria-hidden because the line repeats forever and re-derives on a timer:
    // handed to a screen reader it would recite the same counts on a loop. The
    // same facts reach assistive tech through the status lines StatusBar owns.
    <div className="tnx-ticker" aria-hidden="true">
      <div className="tnx-ticker-track">
        <span className="tnx-ticker-item">{line}</span>
        <span className="tnx-ticker-item">{line}</span>
      </div>
    </div>
  );
}
