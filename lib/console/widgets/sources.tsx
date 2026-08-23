"use client";
// The widgets the Source Catalog's ＋ button creates for sources the console has
// no bespoke card for:
//   • one ROLL-UP card per catalog category — a live summed total plus a row per
//     constituent source, each with its own count, freshness dot and a ⤢ that
//     pops that single source out as its own card;
//   • one generic LEAF card per core source that no bespoke widget already shows
//     (today: Webcams) — hero count, ▴/▾ delta and a glance sparkline.
//
// Both are read-only projections of stores that are already running (lib/sources/live),
// so mounting one starts no fetch. The map toggle in the footer mirrors the source's
// own layer/signal on-state, keeping card and map in lockstep.
//
// These bodies were previously rendered only by components/shell/DockableWorkspace,
// which nothing has mounted since the console rebuild — so the rail's ＋ wrote a
// placement no one drew and the button looked dead. They now register as ordinary
// console widget types, which is the only kind this app renders.

import { useEffect } from "react";
import { getCatalogSource, catalogByGroup, CORE_IDS } from "@/lib/sources/catalog";
import { useSourceLive, toggleSourceMap } from "@/lib/sources/live";
import { useCountHistory, deltaOf, trendOf } from "@/lib/widgets/history";
import { constituentIds } from "@/lib/widgets/rollup";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { shellLayoutStore } from "@/lib/console/store";
import { useMetrics } from "@/lib/metrics";
import { useSignalCounts } from "@/lib/signals/store";
import { rollupCount } from "@/lib/widgets/rollup";
import {
  genericCoreIds,
  rollupWidgetId,
  sourceWidgetId,
  widgetTypeForSource,
} from "@/lib/console/sourceWidgets";
import { rollupHelp, sourceHelp } from "@/lib/console/sourceCards";
import type { FreshKind } from "@/lib/sources/freshKind";
import { WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";

const FRESH_LABEL: Record<FreshKind, string> = {
  off: "off",
  unknown: "connecting…",
  live: "live",
  empty: "live · none now",
  lagging: "lagging",
  stale: "stale",
  down: "unavailable",
};

const fmtCount = (n: number | null): string => (n == null ? "—" : n.toLocaleString());

// Freshness pip — the state class lives on the PARENT so the existing
// `.tn-fresh-<state> .tn-fresh-dot` rules colour the inner dot.
function FreshDot({ fresh }: { fresh: FreshKind }) {
  return (
    <span className={`tn-fresh tn-fresh-${fresh}`} role="img" aria-label={FRESH_LABEL[fresh]} title={FRESH_LABEL[fresh]}>
      <span className="tn-fresh-dot" aria-hidden />
    </span>
  );
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <span className="tn-src-spark" aria-hidden />;
  const W = 64;
  const H = 18;
  const n = points.length;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${((i / (n - 1)) * W).toFixed(1)} ${(H - p * H).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="tn-src-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Generic leaf ────────────────────────────────────────────────────────────

function makeLeafBody(id: string) {
  function LeafBody(_props: WidgetBodyProps) {
    const report = useWidgetReport();
    const source = getCatalogSource(id);
    const live = useSourceLive(id);
    const hist = useCountHistory(id);

    // The frame's count + freshness chip. `fresh` is a REAL observation only when
    // the layer is on and something has arrived; otherwise the chip must say so
    // rather than inherit a stale "live" from a previous mount.
    useEffect(() => {
      report({
        alerts: [],
        count: live.count ?? undefined,
        freshLabel: FRESH_LABEL[live.fresh],
      });
    }, [report, live.count, live.fresh]);

    if (!source) return <p className="tn-w-empty">Unknown source “{id}”.</p>;

    const delta = deltaOf(hist);
    return (
      <div className="tn-src-body">
        {!live.hasData ? (
          <p className="tn-w-empty">
            Off. Enable it on the map to monitor it.{" "}
            <button type="button" className="tn-src-enable" onClick={() => toggleSourceMap(id, true)}>
              Enable
            </button>
          </p>
        ) : (
          <div className="tn-src-glance">
            <span className="tn-src-count tn-num">{fmtCount(live.count)}</span>
            {delta !== 0 ? (
              <span className={`tn-src-delta ${delta > 0 ? "up" : "down"}`}>
                {delta > 0 ? "▴" : "▾"}
                {Math.abs(delta)}
              </span>
            ) : null}
            <Sparkline points={trendOf(hist, 16)} color={source.color} />
          </div>
        )}
        <p className="tn-widget-foot">
          <span className="tn-widget-source">{source.attribution}</span>{" "}
          <button
            type="button"
            className="tn-src-mapon"
            role="switch"
            aria-checked={live.mapOn}
            onClick={() => toggleSourceMap(id, !live.mapOn)}
          >
            ◇ {live.mapOn ? "on map" : "off map"}
          </button>
        </p>
      </div>
    );
  }
  return LeafBody;
}

// ── Category roll-up ────────────────────────────────────────────────────────

function RollupRow({ id }: { id: string }) {
  const source = getCatalogSource(id);
  const live = useSourceLive(id);
  if (!source) return null;
  return (
    <li className="tn-widget-row">
      <span className="tn-src-dot" style={{ background: source.color }} aria-hidden />
      <span className="tn-widget-row-main">
        <span className="tn-widget-row-title">{source.label}</span>
      </span>
      <FreshDot fresh={live.fresh} />
      <span className="tn-widget-metric tn-num">{fmtCount(live.count)}</span>
      <button
        type="button"
        className="tn-src-pop"
        title={`Open ${source.label} as its own widget`}
        aria-label={`Open ${source.label} as its own widget`}
        onClick={() => {
          const r = shellLayoutStore.add(widgetTypeForSource(id));
          if (!r.ok) {
            window.dispatchEvent(
              new CustomEvent("tn-toast", { detail: WIDGET_LIMIT_MESSAGE }),
            );
          }
        }}
      >
        ⤢
      </button>
    </li>
  );
}

// Live roll-up total without per-id hooks: core counts come from metrics, signal
// counts from the signals store — summed by the pure rollupCount helper.
function useRollupCount(ids: string[]): number | null {
  const m = useMetrics();
  const sig = useSignalCounts();
  const counts: Record<string, number | undefined> = {};
  for (const id of ids) {
    if (id === "cameras") counts[id] = m.camerasTotal || undefined;
    else if (id === "planes") counts[id] = m.planes || undefined;
    else if (id === "satellites") counts[id] = m.satellites || undefined;
    else if (id === "webcams") counts[id] = m.webcams || undefined;
    else counts[id] = sig[id] ?? undefined;
  }
  return rollupCount(counts, ids);
}

function makeRollupBody(group: string) {
  function RollupBody(_props: WidgetBodyProps) {
    const report = useWidgetReport();
    const ids = constituentIds(group);
    const total = useRollupCount(ids);

    // No freshness chip: a roll-up's honest freshness is per-row (each row has its
    // own dot), and a single chip over sources on different cadences would be a
    // claim the card cannot support.
    useEffect(() => {
      report({ alerts: [], count: total ?? undefined });
    }, [report, total]);

    return (
      <div className="tn-src-body">
        <div className="tn-src-glance">
          <span className="tn-src-count tn-num">{fmtCount(total)}</span>
          <span className="tn-src-glance-label">
            tracked now · {ids.length} source{ids.length === 1 ? "" : "s"}
          </span>
        </div>
        <ol className="tn-widget-list">
          {ids.map((id) => (
            <RollupRow key={id} id={id} />
          ))}
        </ol>
      </div>
    );
  }
  return RollupBody;
}

// ── Registration ────────────────────────────────────────────────────────────

// One roll-up per catalog category. `category` is the group itself, so the ⌘K
// palette files each roll-up alongside the sources it summarises.
for (const g of catalogByGroup()) {
  registerWidget({
    id: rollupWidgetId(g.group),
    title: `${g.group} roll-up`,
    icon: "▦",
    category: g.group,
    defaultHeight: 260,
    defaultConfig: {},
    component: makeRollupBody(g.group),
    help: rollupHelp(g.group),
  });
}

// A generic leaf for every core source no bespoke widget already covers. Signals
// are excluded by construction: widgets/signals.tsx registers a card for each.
for (const id of genericCoreIds(CORE_IDS)) {
  const source = getCatalogSource(id);
  registerWidget({
    id: sourceWidgetId(id),
    title: source?.label ?? id,
    icon: "◇",
    category: source?.group ?? "Sources",
    defaultHeight: 190,
    defaultConfig: {},
    component: makeLeafBody(id),
    help: sourceHelp(id),
  });
}
