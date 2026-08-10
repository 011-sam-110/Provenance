// The honest freshness chip on every widget header.
//
// WHY THIS EXISTS. Every widget used to hand WidgetFrame a hardcoded string —
// `freshLabel: "live"` — and the signals widget derived its label from the
// CONFIGURED cadence (`refreshMs`) rather than from anything that had actually
// happened. So a feed whose upstream froze three hours ago still said "live",
// and a feed that had never once succeeded said "live" too. A product whose
// pitch is honesty cannot ship a label that is a constant.
//
// This module turns an OBSERVATION (when did we last succeed, did the last
// attempt work, how many rows came back, how often should it update) into a
// state, a short chip label, and a full-sentence tooltip. All pure, so the
// interesting cases are unit-tested rather than eyeballed on a running map.
//
// The `empty` state is the one people get wrong: a feed that connected fine and
// returned zero rows (no active cyclones in February, no military flights right
// now) is NOT broken and NOT stale. Calling it "none now" instead of "live" or
// "down" is the difference between a monitor you can trust and one you can't.

import type { FreshKind } from "@/lib/sources/freshKind";

export interface FreshObservation {
  /** Epoch ms of the last SUCCESSFUL update, or null if there has never been one. */
  lastOk: number | null;
  /** Did the most recent attempt succeed? False means we are showing last-good data. */
  ok: boolean;
  /** Rows/features from the last successful update. Omit when the widget has no count. */
  count?: number;
  /** Expected cadence in ms. Thresholds are multiples of it, so a 12s feed and a
   *  5-minute feed are both judged against their own normal. */
  refreshMs: number;
  /** Computed in-browser (e.g. SGP4 satellite propagation) — no fetch, cannot go stale. */
  local?: boolean;
  /** Not being fetched at all: needs a key that is not configured. Dormant ≠ broken. */
  dormant?: boolean;
  /** Newest timestamp inside the DATA (server generatedAt, newest item). Distinct from
   *  lastOk: we may have fetched 5s ago a payload the upstream built an hour ago. */
  sourceAt?: number | null;
  /** For a widget fed by several upstreams: how many answered, out of how many were
   *  asked. A partial outage is the common failure mode for a fan-out widget and it
   *  is invisible in a single ok/not-ok flag — 2 of 9 sources answering still looks
   *  perfectly "live" without this. */
  coverage?: { ok: number; total: number };
}

/** True when some but not all of a fan-out widget's sources answered. */
export function isPartial(o: FreshObservation | null | undefined): boolean {
  const c = o?.coverage;
  return Boolean(c && c.total > 0 && c.ok > 0 && c.ok < c.total);
}

/** Age (ms) since the last success, or null if there has never been one. */
export function freshAgeMs(o: FreshObservation | null | undefined, now: number): number | null {
  if (!o || o.lastOk == null) return null;
  return Math.max(0, now - o.lastOk);
}

/**
 * Observation → state. Ordering matters:
 *   dormant  — we never even tried; nothing else can be said
 *   down     — the last attempt failed, whatever its age
 *   local    — propagated in-browser, so age is meaningless
 *   unknown  — no success yet, but nothing has failed either
 *   stale    — checked before `empty`, because a feed that stopped answering
 *              hours ago must not be excused as "nothing happening right now"
 */
export function classifyObservation(o: FreshObservation | null | undefined, now: number): FreshKind {
  if (!o) return "unknown";
  if (o.dormant) return "off";
  if (!o.ok) return "down";
  if (o.local) return (o.count ?? 1) > 0 ? "live" : "empty";
  if (o.lastOk == null) return "unknown";
  const cadence = Math.max(1_000, o.refreshMs);
  const age = Math.max(0, now - o.lastOk);
  if (age >= cadence * 6) return "stale";
  if ((o.count ?? 1) <= 0) return "empty";
  if (age >= cadence * 2) return "lagging";
  return "live";
}

/** Compact age for a chip that has ~60px to work with. */
export function formatAgeShort(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Short chip text. "live" stays bare — every other state carries its evidence. */
export function chipLabel(kind: FreshKind, ageMs: number | null): string {
  switch (kind) {
    case "off": return "dormant";
    case "unknown": return "connecting…";
    case "down": return "down";
    case "empty": return "none now";
    case "stale": return ageMs == null ? "stale" : `stale · ${formatAgeShort(ageMs)}`;
    case "lagging": return ageMs == null ? "lagging" : `${formatAgeShort(ageMs)} old`;
    case "live": return "live";
  }
}

/**
 * The full explanation, shown on hover. This is where the two clocks live: when we
 * last fetched successfully, and how old the newest thing IN that payload is. A
 * five-second-old fetch of an hour-old payload is a real situation, and the chip
 * alone cannot say it.
 */
export function chipTitle(o: FreshObservation | null | undefined, now: number): string {
  if (!o) return "No freshness information is published for this widget.";
  if (o.dormant) {
    return "Dormant — this source needs an API key that is not configured, so nothing is being fetched. Not an error.";
  }
  const parts: string[] = [];
  if (o.local) {
    parts.push("Computed in your browser from orbital elements — no network fetch, so it cannot go stale.");
  } else if (o.lastOk == null) {
    parts.push(o.ok ? "Waiting for the first successful update." : "No successful update yet.");
  } else {
    parts.push(`Last successful update ${formatAgeShort(now - o.lastOk)} ago.`);
  }
  if (!o.ok) parts.push("The most recent attempt FAILED — anything shown is the last good data.");
  if (!o.local && o.refreshMs > 0) parts.push(`Expected every ${formatAgeShort(o.refreshMs)}.`);
  if (o.sourceAt != null) parts.push(`Newest item in the data is ${formatAgeShort(now - o.sourceAt)} old.`);
  if (o.coverage && o.coverage.total > 0) {
    parts.push(
      o.coverage.ok === o.coverage.total
        ? `All ${o.coverage.total} sources answered.`
        : `Only ${o.coverage.ok} of ${o.coverage.total} sources answered — this view is incomplete.`,
    );
  }
  if (o.count != null) parts.push(`${o.count.toLocaleString("en-GB")} ${o.count === 1 ? "row" : "rows"}.`);
  if (classifyObservation(o, now) === "empty") {
    parts.push("Connected, but there is nothing to report right now — that is a real answer, not a failure.");
  }
  return parts.join(" ");
}

// --- adapters from the two stores that already track this -------------------
// Both take structural shapes rather than importing lib/freshness.ts or
// lib/signals/freshness.ts, so this module stays pure and node-testable (those
// two are "use client" and pull in React).

/** A record from the core-layer store (cameras / planes / satellites / webcams). */
export function observeCoreSource(
  r: { ok: boolean; count: number; lastUpdate: number | null; refreshMs: number; local: boolean } | undefined,
): FreshObservation | undefined {
  if (!r) return undefined;
  return { lastOk: r.ok ? r.lastUpdate : null, ok: r.ok, count: r.count, refreshMs: r.refreshMs, local: r.local };
}

/**
 * A record from the signals store, plus the layer's configured cadence.
 * Returns an observation even when the layer has never reported, so the chip can
 * say "connecting…" instead of vanishing — an absent chip reads as "fine".
 */
export function observeSignalSource(
  r: { lastUpdate: number; ok: boolean; count: number } | undefined,
  refreshMs: number,
): FreshObservation {
  if (!r) return { lastOk: null, ok: true, refreshMs };
  return { lastOk: r.ok ? r.lastUpdate : null, ok: r.ok, count: r.count, refreshMs };
}

export interface FreshChipView {
  kind: FreshKind;
  label: string;
  title: string;
  ageMs: number | null;
}

/**
 * One call for the UI: state + short label + tooltip.
 *
 * A partial fan-out gets its denominator appended to the chip ("live · 7/9"),
 * because "live" over two of nine working sources is the most misleading thing a
 * dashboard can say — the number shown is real, it is just not the whole picture.
 */
export function freshChipView(o: FreshObservation | null | undefined, now: number): FreshChipView {
  const kind = classifyObservation(o, now);
  const ageMs = freshAgeMs(o, now);
  const base = chipLabel(kind, ageMs);
  const label = isPartial(o) ? `${base} · ${o!.coverage!.ok}/${o!.coverage!.total}` : base;
  return { kind, label, title: chipTitle(o, now), ageMs };
}
