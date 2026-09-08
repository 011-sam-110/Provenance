"use client";
// The impure shell. It reads the stores, calls the pure pieces in the one correct
// order, and hands finished text to `dispatch` in lib/shell/notifications.ts.
//
// NOTHING HERE DECIDES ANYTHING. What happened is engine.ts, how it is worded is
// wording.ts, whether it is sent is budget.ts. If a behaviour question arises in
// this file, it belongs in one of those three.
//
// WHY IT IS ONE SUBSCRIBER AND NOT PER-WIDGET. A rule must fire whether or not a
// widget for its source is on the board — the point of an area rule is that you are
// watching a PLACE, not a card. WidgetFrame's existing per-mount dispatch cannot do
// that, and is left alone: it keeps serving the widget-type rules it always did.

import { diff } from "@/lib/notify/engine";
import { rulesStore } from "@/lib/notify/rules";
import { observationsStore } from "@/lib/notify/observations";
import { wordEvent } from "@/lib/notify/wording";
import { applyBudget } from "@/lib/notify/budget";
import { syncArmedSubscriptions } from "@/lib/notify/sources";
import { dispatch, notificationsStore, type NotifyRule } from "@/lib/shell/notifications";
import { inspectorStore } from "@/lib/shell/inspector";
import { WORLD_AREA_ID, type AreaRule, type NotifyEvent, type ObservedRow } from "@/lib/notify/types";

/** How often the runner re-reads the feeds. Well under the slowest source cadence
 *  so a transition is not missed, and cheap because a tick only READS the shared
 *  poller's cache. It does not fetch: the polling itself stays on each source's own
 *  `refreshMs` (floored at 60s by useSignalFeed), and a source already on the board
 *  costs nothing extra because the ref count is shared. */
const TICK_MS = 10_000;

/** Per-area send timestamps for the rolling budget. In memory only: a reload
 *  legitimately starts a fresh hour, and persisting it would let a stale window
 *  silence a genuinely new incident. */
const sentByArea = new Map<string, number[]>();

/** Supplied by the source adapters registered in `lib/notify/sources.ts`. */
export interface SourceFeed {
  rows: readonly ObservedRow[];
  ok: boolean;
  lastOk: number;
  label: string;
}
export type FeedReader = (sourceId: string) => SourceFeed | null;

function ringFor(areaId: string): readonly [number, number][] | null {
  if (areaId === WORLD_AREA_ID) return null;
  const area = inspectorStore.get().areas.find((a) => a.id === areaId);
  return area ? area.polygon : null;
}

function labelFor(areaId: string): string {
  if (areaId === WORLD_AREA_ID) return "World";
  return inspectorStore.get().areas.find((a) => a.id === areaId)?.label ?? areaId;
}

/** One pass: diff every armed (area, source) pair, word it, budget it, send it. */
export function tick(readFeed: FeedReader, now: number): void {
  const rules = rulesStore.get().filter((r) => r.enabled);
  if (rules.length === 0) return;

  // Group by pair so one diff serves every rule watching the same area and source.
  const pairs = new Map<string, { areaId: string; sourceId: string; rules: AreaRule[] }>();
  for (const r of rules) {
    const k = `${r.areaId}|${r.sourceId}`;
    const hit = pairs.get(k);
    if (hit) hit.rules.push(r);
    else pairs.set(k, { areaId: r.areaId, sourceId: r.sourceId, rules: [r] });
  }

  // The whole NotifyEvent is carried, not just its text: the budget slices this
  // list, and every survivor still has to name the rule whose channels it goes out on.
  const perArea = new Map<string, NotifyEvent[]>();

  for (const { areaId, sourceId, rules: armed } of pairs.values()) {
    const feed = readFeed(sourceId);
    if (!feed) continue; // source not registered / not loaded — not an error

    const prev = observationsStore.get(areaId, sourceId);
    const { events, next } = diff(prev, feed.rows, ringFor(areaId), armed, { ok: feed.ok, lastOk: feed.lastOk }, now);
    observationsStore.put(areaId, sourceId, next);
    if (events.length === 0) continue;

    const areaLabel = labelFor(areaId);
    for (const e of events) {
      const row = e.rowId ? feed.rows.find((r) => r.id === e.rowId) : undefined;
      const rule = armed.find((r) => r.id === e.ruleId);
      const level =
        rule && (rule.params.kind === "count" || rule.params.kind === "crosses")
          ? rule.params.level
          : undefined;
      const text = wordEvent(e, {
        areaLabel,
        sourceLabel: feed.label,
        rowTitle: row?.title,
        count: next.count,
        level,
      });
      const bucket = perArea.get(areaId) ?? [];
      // The ruleId RIDES ALONG. Each event is sent on the channels of the rule that
      // produced it — a rule armed to Browser only must not reach Telegram because
      // some other rule on the same area happens to have Telegram on.
      bucket.push({ ...e, text });
      perArea.set(areaId, bucket);
    }
  }

  for (const [areaId, items] of perArea) {
    const { send, nextSent, closing } = applyBudget(items, sentByArea.get(areaId) ?? [], now, labelFor(areaId));
    sentByArea.set(areaId, nextSent);

    for (const e of send) {
      const rule = rulesStore.get().find((r) => r.id === e.ruleId);
      if (rule) fanOut(e.text, rule.channels);
    }
    // The closing line is about the AREA, not about any one rule, so it goes to the
    // union of everything armed there — it must reach whoever was going to be
    // notified, whichever rule's events were the ones held.
    if (closing) fanOut(closing, unionChannels(areaId));
  }
}

function unionChannels(areaId: string): NotifyRule["channels"] {
  const channels = { browser: false, telegram: false, discord: false };
  for (const r of rulesStore.forArea(areaId)) {
    if (!r.enabled) continue;
    channels.browser ||= r.channels.browser;
    channels.telegram ||= r.channels.telegram;
    channels.discord ||= r.channels.discord;
  }
  return channels;
}

/** Fan one line out on exactly these channels. */
function fanOut(text: string, channels: NotifyRule["channels"]): void {
  // Reuses the existing master gate, cred checks and relays verbatim — a rule here
  // can never send through a channel the user has switched off globally.
  const rule: NotifyRule = { enabled: true, channels };
  dispatch(text, rule);
}

/** Test-only: forget the rolling send window. */
export function __resetBudgetWindow(): void {
  sentByArea.clear();
}

/** The sources currently armed by an enabled rule — what has to be kept polling. */
function armedSourceIds(): Set<string> {
  return new Set(rulesStore.get().filter((r) => r.enabled).map((r) => r.sourceId));
}

/** Mount the loop. Returns a teardown for ConsoleShell's effect.
 *
 *  The subscription sync lives HERE and not in `tick` on purpose: `tick` takes its
 *  feed reader as an argument so it can be driven from a node test without touching
 *  the network, and reaching into the real poller from inside it would undo that. */
export function startNotifyRunner(readFeed: FeedReader): () => void {
  if (typeof window === "undefined") return () => {};
  syncArmedSubscriptions(armedSourceIds());
  const h = window.setInterval(() => {
    if (!notificationsStore.getState().master) return; // global gate, checked live
    // Re-synced every tick because arming a rule must start its feed without a
    // remount, and disarming the last rule on a source must stop it.
    syncArmedSubscriptions(armedSourceIds());
    tick(readFeed, Date.now());
  }, TICK_MS);
  return () => {
    window.clearInterval(h);
    syncArmedSubscriptions(new Set()); // release every poll hold we opened
  };
}
