"use client";
// Generic signal-monitor widgets — ONE component renders EVERY registered global
// signal source as its own monitor card, and the loop at the bottom registers one
// widget type per source. "Every data piece is a widget": adding a layer to
// lib/signals/registry.ts gives it a ⌘K-discoverable widget for free, no edits here.
//
// The card reuses the shared widget row classes (.tn-w-*) so it needs no new CSS,
// reads the global Scope, and reports its count + "needs attention" alerts through
// the same WidgetFrame contract as the bespoke widgets. Pure projection +
// per-source ranking/alerts live in lib/console/signals/signalCard.ts.

import { useEffect, useMemo } from "react";
import { SIGNALS } from "@/lib/signals/registry";
import type { SignalSource } from "@/lib/signals/types";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useScope } from "@/lib/shell/scope";
import { projectSignal } from "@/lib/console/signals/signalCard";
import { signalHelp } from "@/lib/console/help";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { MetricBar } from "@/components/MetricBar";
import { makeSignalDetail } from "./signals.detail";

const GROUP_ICON: Record<string, string> = {
  Synthesis: "🧭",
  "Natural hazards": "🌋",
  "Space weather": "🌌",
  Space: "🚀",
  Infrastructure: "🛰",
  Intel: "📰",
  Conflict: "⚔",
  Environment: "🌿",
  "Civic safety": "🚨",
  "Cyber threat": "🛡",
  "Human cost": "🆘",
  Military: "🎖",
  Maritime: "🚢",
  Weather: "🌦",
};

function iconFor(source: SignalSource): string {
  return GROUP_ICON[source.group] ?? "📡";
}

// NOTE: there used to be a freshLabel(refreshMs) here that turned the CONFIGURED
// cadence into a header word — so a layer whose upstream had been dead for hours
// still advertised "live", and so did one that had never succeeded once. The chip
// now derives its own state from an observation of what actually happened; see
// lib/console/freshChip.ts and components/console/FreshChip.tsx.

/**
 * Compact "5m" / "2h" / "3d" since an ISO timestamp, and "in 4h" / "in 3d" for one
 * in the FUTURE. "" when undated or unparsable.
 *
 * The Math.max(0, …) this replaces meant every forward-dated row rendered "· 0s":
 * the whole rocket-launch layer showed a zero countdown whether the launch was
 * tomorrow or in three months. Clamping a negative interval hides the sign; a
 * schedule layer needs it shown.
 */
function relativeTime(ts: string | undefined, now: number): string {
  if (!ts) return "";
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return "";
  const deltaS = Math.round((now - t) / 1000);
  const s = Math.abs(deltaS);
  const span =
    s < 60 ? `${s}s`
    : s < 3600 ? `${Math.round(s / 60)}m`
    : s < 172_800 ? `${Math.round(s / 3600)}h`
    : `${Math.round(s / 86_400)}d`;
  return deltaS < 0 ? `in ${span}` : span;
}

function makeSignalBody(source: SignalSource) {
  function SignalBody({ config }: WidgetBodyProps) {
    const scope = useScope();
    const { features, status, updatedAt, ok } = useSignalFeed(source.id, source.refreshMs);

    const projected = useMemo(
      () =>
        projectSignal(
          features,
          scope,
          { alertMin: typeof config.alertMin === "number" ? config.alertMin : undefined },
          source.metric,
        ),
      [features, scope, config],
    );

    const report = useWidgetReport();
    useEffect(() => {
      report({
        alerts: projected.alerts,
        count: projected.shown,
        // The chip describes the FEED, so it counts what the upstream returned
        // (features.length), not what survived the user's scope filter
        // (projected.shown). Otherwise zooming into a quiet country would report
        // the source as empty. The body already says "Nothing in <scope>".
        fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: source.refreshMs },
      });
    }, [projected, report, updatedAt, ok, features.length]);

    if (status === "loading" && projected.shown === 0) {
      return <p className="tn-w-empty">Loading {source.label}…</p>;
    }
    if (status === "error" && projected.shown === 0) {
      return <p className="tn-w-empty">{source.label} unavailable.</p>;
    }
    if (projected.shown === 0) {
      return <p className="tn-w-empty">Nothing in {scope.label}.</p>;
    }

    const now = Date.now();
    return (
      <ul className="tn-w-list">
        {projected.rows.map((r) => {
          const rel = relativeTime(r.ts, now);
          return (
            <li key={r.id}>
              {r.metric ? (
                <MetricBar value={r.metric.value} domain={r.metric.domain} color={r.color} label={r.metric.label} />
              ) : (
                <span className="tn-w-dot" style={{ background: r.color || "var(--tn-text-faint, #94a3b8)" }} aria-hidden />
              )}
              <span className="tn-w-place">{r.title}</span>
              {rel && <span className="tn-w-muted"> · {rel}</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  return SignalBody;
}

// Register one widget type per registered signal source.
for (const source of SIGNALS) {
  registerWidget({
    id: `signal:${source.id}`,
    title: source.label,
    icon: iconFor(source),
    category: source.group,
    defaultHeight: 240,
    defaultConfig: {},
    component: makeSignalBody(source),
    detail: makeSignalDetail(source),
    help: signalHelp(source),
  });
}
