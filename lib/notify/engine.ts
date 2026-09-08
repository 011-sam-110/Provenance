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

/**
 * EDGE, not level. True only when the value moved ACROSS the line since last time.
 *
 * This is a deliberate correction. `aviation.rules.ts` emits its private-jet surge
 * whenever the count is at or above the threshold, and WidgetFrame's dedupe set is
 * per-MOUNT, so focusing a widget and coming back re-announces a surge that never
 * went away. An edge fires once and re-arms only when the value returns.
 *
 * A non-finite previous value means "we have never seen this", which is not a
 * crossing — you cannot cross a line you were never on a side of.
 */
function crossed(prev: number | undefined, cur: number, dir: "atOrAbove" | "below", level: number): boolean {
  if (prev == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return false;
  return dir === "atOrAbove" ? prev < level && cur >= level : prev >= level && cur < level;
}

export function diff(
  prev: Observation | undefined,
  rows: readonly ObservedRow[],
  ring: Ring,
  rules: readonly AreaRule[],
  feed: { ok: boolean; lastOk: number },
  now: number,
): { events: NotifyEvent[]; next: Observation } {
  const seeding = prev === undefined;
  const before = prev ?? EMPTY_OBSERVATION;

  // G2 — is this poll worth believing?
  //   • the fetch errored, so its rows tell us nothing; or
  //   • a previously non-empty set came back completely empty, which is what an
  //     upstream hiccup looks like and is indistinguishable from a real evacuation.
  // Either way the OBSERVATION IS LEFT UNTOUCHED, so the next healthy poll compares
  // against the last state we trusted rather than against an empty one. Believing a
  // bad poll would announce that everything left Soho, and then announce it all
  // arriving back a minute later.
  const collapsed = before.count > 0 && rows.length === 0;
  const trustRows = feed.ok && !collapsed;

  const nextRows = trustRows ? snapshot(rows, ring) : before.rows;
  const insideNow = trustRows ? rows.filter((r) => isInside(r, ring)) : [];
  const next: Observation = {
    rows: nextRows,
    count: trustRows ? insideNow.length : before.count,
    lastOk: feed.ok && !collapsed ? feed.lastOk : before.lastOk,
    dueFired: before.dueFired,
    quietFired: before.quietFired,
  };
  if (trustRows) next.quietFired = false; // same expression the quiet branch negates

  const events: NotifyEvent[] = [];
  const armed = rules.filter((r) => r.enabled);

  // G1 — the first observation SEEDS. Rows already present are not "appeared", and a
  // count already over its level is not a crossing. Arming a rule over a busy area
  // must not fire ninety messages about things that were there before the rule
  // existed. `quiet` is exempt: it reads the clock, not the rows.
  if (trustRows && !seeding) {
    for (const rule of armed) {
      if (rule.params.kind === "appears") {
        for (const r of insideNow) {
          if (!before.rows[r.id]) events.push(event(rule, "appears", now, r.id));
        }
      }

      if (rule.params.kind === "count") {
        const { dir, level } = rule.params;
        if (crossed(before.count, next.count, dir, level)) {
          events.push(event(rule, "count", now));
        }
      }

      if (rule.params.kind === "crosses") {
        const { field, dir, level } = rule.params;
        for (const r of insideNow) {
          const cur = r.scalars[field];
          if (!Number.isFinite(cur)) continue; // absent is not zero
          if (crossed(before.rows[r.id]?.scalars?.[field], cur, dir, level)) {
            events.push(event(rule, "crosses", now, r.id));
          }
        }
      }
    }
  }

  for (const rule of armed) {
    if (rule.params.kind !== "quiet") continue;
    const { silentMs } = rule.params;
    // lastOk === 0 means this pair has NEVER answered. Silence with no baseline is
    // not an outage — it is a source that was armed before it ever worked, and
    // announcing it would blame the wrong thing.
    //
    // A poll we TRUSTED is not silence, whatever the previous lastOk says. This
    // term must stay the exact complement of the `next.quietFired = false` reset
    // above — hence `trustRows`, not a re-typed `feed.ok`. If the two ever
    // disagree, the single poll on which a feed RECOVERS both fires a bogus
    // outage and re-latches quietFired after the reset already cleared it,
    // leaving the latch stuck true so the next genuine outage is never announced.
    const silentFor = !trustRows && before.lastOk > 0 ? now - before.lastOk : 0;
    if (silentFor >= silentMs && !before.quietFired) {
      events.push(event(rule, "quiet", now));
      next.quietFired = true;
    }
  }

  return { events, next };
}
