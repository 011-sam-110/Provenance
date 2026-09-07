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
import { projectSignal, rowLabel } from "@/lib/console/signals/signalCard";
import { signalHelp } from "@/lib/console/help";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { useCapabilityStatus } from "@/lib/sources/useStatus";
import type { StatusEntry } from "@/lib/sources/statusReport";
import { MetricBar } from "@/components/MetricBar";
import { makeSignalDetail } from "./signals.detail";

/**
 * The "you can't have this right now" badge for one capability's status.
 *
 * PURE and exported so both places that need to say this — this widget's own
 * empty-state message, and the rail row badge in components/shell/SourceCatalog.tsx
 * (imported from here) — agree on the wording, and so every CapabilityState is
 * handled in exactly one spot.
 *
 * `locked` and `refused` used to render IDENTICALLY: a key-gated layer with no
 * key, and a key-gated layer whose credential an upstream actively rejected,
 * both showed nothing at all. That erases the difference between "we never
 * asked" and "we asked and were turned away" — precisely the class of lie this
 * product exists not to tell. They get distinct icons, distinct short text, and
 * a `long` sentence built from what was actually observed (never invented).
 *
 * `keyless`, `configured`, `upgradable` and `enhanced` earn no badge — all four
 * describe a capability that is working or keyless, and badging a working
 * feature would say a live thing is dead, the same class of error in reverse.
 *
 * The switch is exhaustive on purpose: adding a 7th CapabilityState to
 * lib/sources/keyRequirements.ts without handling it here fails `tsc`, not
 * silently renders blank. See tests/unit/capability-badge.test.ts.
 */
export interface CapabilityBadge {
  kind: "locked" | "refused";
  /** Compact glyph for a pill or an inline icon. */
  icon: string;
  /** Short label — plain, never a vague "unavailable". */
  short: string;
  /** Full sentence(s). Safe as a tooltip title or a widget-body paragraph. */
  long: string;
}

export function capabilityBadge(
  status: Pick<StatusEntry, "state" | "missingEnv" | "degrades" | "obtain" | "refusal"> | null | undefined,
): CapabilityBadge | null {
  if (!status) return null;
  switch (status.state) {
    case "locked": {
      const need = status.missingEnv.length > 0 ? status.missingEnv.join(" + ") : "a key";
      return {
        kind: "locked",
        icon: "🔑",
        short: "needs a key",
        long: [
          `Locked — this deployment has no ${need}.`,
          status.degrades,
          status.obtain,
          "Holding a key is not the same as the upstream accepting it — the freshness dot above says whether data is actually arriving.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    case "refused": {
      const who = status.refusal?.host ?? "the upstream";
      return {
        kind: "refused",
        icon: "⛔",
        short: "credential refused",
        long: [
          // `refusal.observed` is the same sentence /api/status publishes, built
          // from an actual 401/402/403 this process saw — never a guess, and
          // never worded as "unavailable".
          status.refusal?.observed ?? `${who} refused this deployment's credential.`,
          status.degrades,
          status.obtain,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    case "keyless":
    case "configured":
    case "upgradable":
    case "enhanced":
      return null;
    default: {
      const exhaustive: never = status.state;
      return exhaustive;
    }
  }
}

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
    const { features, status, updatedAt, ok, coverage } = useSignalFeed(source.id, source.refreshMs);
    // A key-gated layer with no key is DORMANT, not quiet. Without this the chip
    // read "none now" and the tooltip said "Connected, but there is nothing to
    // report right now — that is a real answer, not a failure" for layers that
    // this deployment cannot fetch at all. That is the honesty machinery lying in
    // the one place it must not, and the `dormant` state existed unwired.
    const capability = useCapabilityStatus(source.id);
    // Same decision the rail badge renders (capabilityBadge, above) — null for
    // every state except locked/refused, so this stays silent for the 34 of 35
    // states that need no explanation.
    const badge = capabilityBadge(capability);

    const projected = useMemo(
      () =>
        projectSignal(
          features,
          scope,
          { alertMin: typeof config.alertMin === "number" ? config.alertMin : undefined },
          source.metric,
          coverage,
        ),
      [features, scope, config, coverage],
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
        fresh: {
          lastOk: updatedAt,
          ok,
          count: features.length,
          refreshMs: source.refreshMs,
          dormant: capability?.state === "locked",
        },
      });
    }, [projected, report, updatedAt, ok, features.length, capability?.state]);

    if (status === "loading" && projected.shown === 0) {
      return <p className="tn-w-empty">Loading {source.label}…</p>;
    }
    if (status === "error" && projected.shown === 0) {
      return <p className="tn-w-empty">{source.label} unavailable.</p>;
    }
    if (badge) {
      // `refused` reads as a rejection, never as the same vague "unavailable"
      // a locked layer gets — the wording is built in capabilityBadge from
      // what was actually observed (a real 401/402/403), not guessed.
      return (
        <p className={`tn-w-empty tn-w-capstate tn-w-capstate-${badge.kind}`}>
          <span aria-hidden>{badge.icon}</span> {source.label}: {badge.long}
        </p>
      );
    }
    if (projected.shown === 0) {
      // "Nothing in World." beside a header badge reading 8 is the contradiction
      // reviewers reported: the badge counts the FEED, the body counts what
      // survived the active scope, and printing only the second makes a filtered
      // card indistinguishable from a dead one. A duty officer's words for it:
      // "an empty panel I cannot prove is truly empty is worse than no panel".
      //
      // The genuinely-zero case is unchanged. Only the case where the feed has
      // rows and the scope hid them gains a sentence, and that sentence names
      // both numbers so the disagreement resolves itself on screen.
      return projected.total > 0 ? (
        <p className="tn-w-empty">
          {projected.totalLabel} in the feed, none inside {scope.label}.
        </p>
      ) : (
        <p className="tn-w-empty">Nothing in {scope.label}.</p>
      );
    }

    const now = Date.now();
    return (
      <>
        {/* A render cap is not a measurement. When the adapter truncated, say so
            and say how the survivors were chosen — otherwise "1,500 fires" reads
            as all the fires there are. The note sits on the FEED, not the scoped
            row count, so it stays true whatever scope is active. */}
        {projected.capNote && <p className="tn-w-capnote">{projected.capNote}</p>}
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
              {/* rowLabel, not r.title: the title also serves as the map's pin
                  label, where there is no value column and the magnitude has to
                  stay. In the row it was said twice. See lib/console/signals/signalCard. */}
              <span className="tn-w-place">{rowLabel(r.title, r.metric)}</span>
              {rel && <span className="tn-w-muted"> · {rel}</span>}
            </li>
          );
        })}
        </ul>
      </>
    );
  }
  return SignalBody;
}

// Register one widget type per registered signal source.
//
// SIGNALS, not MAP_SIGNALS -- the deliberate exception to the split. This widget is a
// READ-ONLY LIST of a source's rows; it has no map toggle and draws nothing on the
// globe. A data-only source (the Country Instability Index) therefore still deserves
// one: taking the pin off the map was never meant to take away the ability to read the
// numbers. The rail's "+" cannot reach these, because the rail is built from the
// catalog and the catalog IS filtered -- so a data-only source's widget is reachable
// from the command palette and nowhere else, which is the intent.
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
