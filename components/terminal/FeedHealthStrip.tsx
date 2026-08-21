"use client";
// The Terminal shell's 22px FEED HEALTH band — one cell per REGISTERED signal
// layer, sitting directly under the header.
//
// WHAT THE STRIP NO LONGER PRINTS, AND WHERE THOSE NUMBERS WENT. It used to end
// in a hover readout ("37 SIGNAL LAYERS · HOVER A CELL") and five tallies
// (LIVE/LAG/DOWN/NEEDS KEY/OFF). Both are gone from here and that slot now holds
// the map's view controls. Nothing factual was lost:
//
//   * the five tallies are printed by the footer ticker, from feedCounts() — the
//     SAME pure function this file calls (components/terminal/TickerLine.tsx:166),
//     so the two surfaces cannot disagree, and the ticker additionally suppresses
//     LAG/DOWN when they are zero rather than parading four reassuring noughts;
//   * the per-cell readout survives as the FIRST LINE of each cell's `title`, which
//     is where a mouse user was reading the prose from anyway — the caption was a
//     summary of the tooltip it now sits on top of.
//
// THIS COMPONENT DECIDES NOTHING. Every judgement about what a layer's state is,
// what colour it earns and which tally it lands in lives in lib/terminal/feedHealth
// as pure, unit-tested functions (tests/unit/terminal-feed-health.test.ts), because
// vitest here is the NODE environment with no jsdom and no React Testing Library —
// a component test is impossible, so anything that could lie has to be testable
// somewhere else. What is left here is plumbing: read the stores, hand them to
// buildFeedCells(), render what comes back.
//
// THE CELL COUNT COMES FROM THE REGISTRY, NEVER A LITERAL. It is 37 today; CLAUDE.md
// still says 35 and lib/sources/catalog.ts says 39, and both are stale. Mapping over
// SIGNALS means the strip cannot drift the way those comments did, and a new layer
// appears in the band the day its adapter lands.
//
// WHERE THE DATA COMES FROM — AND WHAT IT COSTS (nothing):
//   • signalsStore   — which layers are ON. Signals DEFAULT ALL OFF, so a first
//                      visit is 37 dormant cells. That is the honest render: a
//                      layer nobody switched on has never been fetched, and an
//                      unfetched layer is not green.
//   • signalFreshnessStore — written by <SignalFeed> inside WorldMap, which mounts
//                      only while a layer is on. Covers exactly the layers that
//                      are actually being fetched.
//   • useStatus()    — ONE memoised GET /api/status per page. The only client-side
//                      source of "needs a key" (SignalSource carries no key field),
//                      and the only source of "refused".
//
// WHAT THIS DELIBERATELY DOES NOT DO: mount a poller. useSignalFeed floors its
// cadence at 60s per id, so subscribing the strip to all 37 layers would open 37
// concurrent /api/signals/<id> loops against upstreams we do not own — several of
// them expensive (the cables adapter enriches ~700 per-cable JSONs behind a 60s
// maxDuration). That is the denial-of-service-on-our-own-providers pattern
// /api/status was written to avoid. The strip is a READER of state other components
// already produce; it starts no traffic of its own.
//
// ─── CSS THIS COMPONENT NEEDS (integrator owns app/globals.css) ───────────────
// All of it scoped under .tn-terminal, using the --tnx-* token block.
//
// .tnx-feed          height:22px; display:flex; align-items:stretch;
//                    background:var(--tnx-panel); border-bottom:1px solid var(--tnx-line-strong);
//                    font-size:9.5px; flex:none; user-select:none;
// .tnx-feed-label    display:flex; align-items:center; padding:0 9px; letter-spacing:.12em;
//                    color:var(--tnx-ink-faint); border-right:1px solid var(--tnx-line); flex:none;
// .tnx-feed-cells    flex:1; display:flex; gap:2px; padding:4px 8px; min-width:0;
// .tnx-feed-cell     flex:1; min-width:3px; border:0; padding:0; border-radius:1px;
//                    cursor:pointer; background:currentColor (overridden inline);
// .tnx-feed-cell:hover  outline:1px solid var(--tnx-ink); outline-offset:0;
// .tnx-view-controls display:flex; align-items:stretch; flex:none;
//                    border-left:1px solid var(--tnx-line);
// .tnx-num           font-variant-numeric:tabular-nums;
// Narrow viewports: the cells are the payload, so .tnx-view-controls sheds its
// basemap buttons before the strip lets a cell drop below 3px.

import { useMemo } from "react";
import { SIGNALS } from "@/lib/signals/registry";
import { signalsStore, useSignals } from "@/lib/signals/store";
import { classifySignalFreshness, useSignalFreshness } from "@/lib/signals/freshness";
import { unifySignalFresh, type FreshKind } from "@/lib/sources/freshKind";
import { useStatus } from "@/lib/sources/useStatus";
import { useNow } from "@/lib/shell/useNow";
import { buildFeedCells } from "@/lib/terminal/feedHealth";
import StageControls from "@/components/terminal/StageControls";

/**
 * The id+title list the strip renders, derived once at module load from the
 * registry. Cheap, stable, and it keeps the cell list out of the render path so a
 * tick cannot reallocate 37 objects for no reason.
 */
const STRIP_SIGNALS = SIGNALS.map((s) => ({ id: s.id, title: s.label }));

/**
 * 10s, the same cadence components/console/FreshChip.tsx already ticks at.
 *
 * It is a re-classification interval, not an animation: the freshness store pushes
 * an update the moment a fetch lands, and this only exists so a layer that goes
 * quiet CROSSES the lagging/stale thresholds on screen instead of sitting green
 * until something else re-renders the shell. Anything faster would repaint 37 cells
 * for no new information.
 */
const TICK_MS = 10_000;

export default function FeedHealthStrip() {
  const now = useNow(TICK_MS);
  const status = useStatus();
  const on = useSignals();
  const records = useSignalFreshness();

  const onIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of SIGNALS) if (on[s.id] === true) ids.add(s.id);
    return ids;
  }, [on]);

  // The freshness store holds raw records; the classification (and the refreshMs
  // each layer is judged against) is the registry's, so it is applied here rather
  // than inside the pure module — buildFeedCells takes an already-classified kind
  // so it never needs the registry, and stays testable with plain literals.
  const fresh = useMemo(() => {
    const out: Record<string, FreshKind> = {};
    for (const s of SIGNALS) {
      const rec = records[s.id];
      if (!rec) continue;
      out[s.id] = unifySignalFresh(classifySignalFreshness({ ...rec, refreshMs: s.refreshMs }, now));
    }
    return out;
  }, [records, now]);

  // `placeholderOnly` is deliberately NOT passed. Three layers (conflict, protests,
  // food-security) publish ONE labelled "no data" feature instead of an empty array
  // when they break, so their broken payload classifies as live — but only a caller
  // that can SEE the features knows that, and the strip reads counts, not payloads.
  // buildFeedCells puts the caveat in those three cells' tooltips instead. Claiming
  // "down" on suspicion would be the mirror-image lie.
  const cells = useMemo(
    () => buildFeedCells({ signals: STRIP_SIGNALS, status, fresh, on: onIds }),
    [status, fresh, onIds],
  );

  return (
    // THE aria-hidden MOVED DOWN A LEVEL, and that is the whole reason this band
    // could take the view controls at all.
    //
    // It used to sit on the root, which was right when the row held nothing but a
    // health readout: the band re-derives on a 10s timer, and tests/unit/
    // shell-a11y.test.ts asserts the announced status line contains no digits
    // precisely because a screen reader must not be interrupted by numbers that
    // change on their own. Left on the root, it would now also bury the basemap
    // buttons, the projection switch and Export — real controls with no second
    // home in this layout — inside a subtree assistive tech is told to ignore.
    //
    // So the attribute is on the two children that earn it: the label and the cell
    // grid. The controls sit outside them and stay in the accessibility tree.
    //
    // The cells keep tabIndex={-1} as the other half of the same decision. Hiding
    // them while leaving 37 buttons tabbable would be the worst of both — a
    // keyboard user tabbing through three dozen controls that announce nothing.
    // That is only acceptable because the SAME 37 layers have a fully labelled,
    // fully keyboard-reachable toggle in the Source Catalog rail
    // (components/shell/SourceCatalog), which is a hard requirement of the Terminal
    // layout. This strip is a glanceable duplicate of a control that exists
    // properly elsewhere; it is not anyone's only way in. Each cell still carries
    // the full `tip` as a title, so a sighted mouse user gets the evidence behind
    // the colour.
    <div className="tnx-feed">
      <span className="tnx-feed-label" aria-hidden="true">
        FEED HEALTH
      </span>

      <div className="tnx-feed-cells" aria-hidden="true">
        {cells.map((cell) => (
          <button
            key={cell.id}
            type="button"
            tabIndex={-1}
            className="tnx-feed-cell"
            // Runtime values: the colour is a palette token chosen by the pure
            // module from the cell's bucket, and the opacity is the strip's second
            // channel (dormant and needs-key cells are dimmed). Neither can be a
            // class without inventing a parallel bucket→class map that could
            // disagree with feedBucket().
            style={{ background: cell.color, opacity: cell.opacity }}
            // Two lines: the state in four words, then the prose behind it. The
            // strip used to print the first line as a hover caption beside the
            // cells; that slot holds the view controls now, so it moved into the
            // tooltip it was always a summary of rather than being deleted.
            title={`${cell.readout}
${cell.tip}`}
            // The same call the Source Catalog rail's per-signal toggle makes
            // (SourceCatalog.tsx:373, `signalsStore.toggle(id)`) — verbatim, so the
            // two surfaces cannot disagree about what "on" means or drift apart if
            // toggling ever grows a side effect. Switching a layer on is also the
            // only thing that can move its cell off dormant: WorldMap mounts that
            // layer's <SignalFeed>, the fetch lands, and the cell reports what
            // actually happened.
            onClick={() => signalsStore.toggle(cell.id)}
          />
        ))}
      </div>

      {/*
        The map's view controls, in the slot the hover readout and the five tallies
        used to hold. They render nothing unless a map is actually on the stage —
        the gate lives inside the component, so this band does not have to know
        what the stage is showing.
      */}
      <StageControls />
    </div>
  );
}
