// THE DIFF. Every trigger is the same operation: compare what we knew to what we
// see, cropped to the ring.
//
// PURE. No React, no DOM, no network, no Date.now() — `now` is a parameter. This is
// the lib/console/widgets/camslot.conditions.ts idiom: every claim the product makes
// is decided in one node-testable file, and the impure shell only supplies inputs.
//
// The caller owns persistence. `diff` returns the NEXT observation rather than
// writing one, so a caller that decides not to trust this poll can keep the old one
// (see the guards in this file).

import { pointInRing } from "@/lib/shell/scope";
import type {
  AreaRule, NotifyEvent, ObservedRow, Observation, TriggerKind,
} from "@/lib/notify/types";

/** A never-observed pair. `lastOk: 0` means "no successful poll yet". */
export const EMPTY_OBSERVATION: Observation = {
  rows: {}, count: 0, lastOk: 0, dueFired: [], quietFired: false,
};

/** A sanitised open ring of [lon, lat], or null for the World context. */
export type Ring = readonly [number, number][] | null;

function isInside(r: ObservedRow, ring: Ring): boolean {
  if (ring === null) return true; // World — no boundary to be outside of
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return false;
  return pointInRing(r.lon, r.lat, ring);
}

function snapshot(rows: readonly ObservedRow[], ring: Ring): Observation["rows"] {
  const out: Observation["rows"] = {};
  for (const r of rows) {
    out[r.id] = { inside: isInside(r, ring), scalars: r.scalars, ...(r.state ? { state: r.state } : {}) };
  }
  return out;
}

function event(
  rule: AreaRule, kind: TriggerKind, at: number, rowId?: string,
): NotifyEvent {
  // `text` is filled in by wording.ts, which owns every sentence the product sends.
  // An empty string here is deliberate: the engine decides WHAT happened, never how
  // it is worded, so a source's honesty rules cannot be bypassed by a new trigger.
  return { ruleId: rule.id, areaId: rule.areaId, sourceId: rule.sourceId, kind, at, text: "", ...(rowId ? { rowId } : {}) };
}

export function diff(
  prev: Observation | undefined,
  rows: readonly ObservedRow[],
  ring: Ring,
  rules: readonly AreaRule[],
  feed: { ok: boolean; lastOk: number },
  now: number,
): { events: NotifyEvent[]; next: Observation } {
  const before = prev ?? EMPTY_OBSERVATION;
  const nextRows = snapshot(rows, ring);
  const insideNow = rows.filter((r) => isInside(r, ring));
  const next: Observation = {
    rows: nextRows,
    count: insideNow.length,
    lastOk: feed.ok ? feed.lastOk : before.lastOk,
    dueFired: before.dueFired,
    quietFired: before.quietFired,
  };

  const events: NotifyEvent[] = [];
  const armed = rules.filter((r) => r.enabled);

  for (const rule of armed) {
    if (rule.params.kind === "appears") {
      for (const r of insideNow) {
        if (!before.rows[r.id]) events.push(event(rule, "appears", now, r.id));
      }
    }
  }

  return { events, next };
}
