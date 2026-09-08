"use client";
// Flattens a source's real rows into ObservedRow, which is all the engine knows.
//
// SIGNALS ONLY IN M1. Core layers (planes, cameras) arrive in M3 with enters/leaves,
// which is when their positions are actually needed. A source this file does not
// know returns null, and the runner treats that as "not loaded" rather than an
// error — dormant-safe, like every other fetch path in this codebase.
//
// IT READS THE SHARED POLLER, AND ALSO HOLDS IT OPEN. `useSignalFeed` already keeps
// one ref-counted loop per signal id, so reading its cache adds no upstream request
// when a widget for that source is already on the board. But a rule belongs to a
// PLACE, not to a card, so `syncArmedSubscriptions` holds a loop open for every
// armed source — otherwise an area rule would fire only while a widget for it
// happened to be mounted, which is not what the user armed.
//
// `SIGNALS`, NOT `MAP_SIGNALS`, IS DELIBERATE HERE. CLAUDE.md warns that importing
// SIGNALS into something that lists layers turns a data-only source back into a
// layer — this lists ARMABLE SOURCES, which is a different question. The Country
// Instability Index is deliberately not a map layer and is still worth a rule.

import { SIGNALS, getSignal } from "@/lib/signals/registry";
import { peekSignalFeed, subscribeSignalFeed } from "@/lib/console/signals/useSignalFeed";
import type { SignalFeature } from "@/lib/signals/types";
import type { ObservedRow, TriggerCapability, TriggerKind } from "@/lib/notify/types";
import type { SourceFeed } from "@/lib/notify/runner";
import { capabilityFor } from "@/lib/notify/groups";
import { resolveTriggers } from "@/lib/notify/capability";

/**
 * PURE: a SignalFeature → the flat row the engine reads.
 *
 * THE SCALAR COMES FROM THE SOURCE'S OWN `metric`, not from a hardcoded field name.
 * `SignalMetric` already exists in lib/signals/types.ts precisely because
 * `props.magnitude` is overloaded — a Richter value for quakes, a rescaled radius
 * proxy for GDACS and cyclones — and each source names its REAL field and domain
 * there. That declaration is exactly what a threshold needs, so `crosses` reads it
 * rather than inventing a parallel one. A source with no `metric` offers no
 * `crosses`, which is the honest answer.
 */
export function toObservedRow(f: SignalFeature, metricField?: string): ObservedRow {
  const scalars: Record<string, number> = {};
  if (metricField) {
    const raw = f.props?.[metricField];
    if (typeof raw === "number" && Number.isFinite(raw)) scalars[metricField] = raw;
  }
  return {
    id: f.id, lat: f.lat, lon: f.lon, scalars, title: f.title,
    ...(f.ts ? { dueAt: f.ts } : {}),
  };
}

export function readNotifyFeed(sourceId: string): SourceFeed | null {
  const source = getSignal(sourceId);
  const hit = peekSignalFeed(sourceId);
  if (!source || !hit) return null;
  const field = source.metric?.field;
  return {
    rows: hit.features.map((f) => toObservedRow(f, field)),
    ok: hit.ok,
    // `updatedAt` IS "last success" in this codebase — a failed refresh deliberately
    // does not advance it, which is exactly the semantics `lastOk` wants.
    lastOk: hit.updatedAt ?? 0,
    label: source.label,
  };
}

/** Live poll holds, keyed by source id, for sources kept open on a rule's behalf. */
const held = new Map<string, () => void>();

/**
 * Hold a poll loop open for exactly the armed source ids, and release the rest.
 * Idempotent — safe to call on every tick.
 */
export function syncArmedSubscriptions(armed: ReadonlySet<string>): void {
  for (const id of armed) {
    if (held.has(id)) continue;
    const source = getSignal(id);
    if (!source) continue;
    held.set(id, subscribeSignalFeed(id, source.refreshMs));
  }
  for (const [id, detach] of held) {
    if (armed.has(id)) continue;
    detach();
    held.delete(id);
  }
}

/** Test-only: drop every held subscription. */
export function __releaseAll(): void {
  for (const detach of held.values()) detach();
  held.clear();
}

/** Every source the composer may offer, with what it needs to build the menu.
 *  `metric` is passed through so the composer can label the threshold with the
 *  source's real field and clamp it to the source's real domain, and `capability`
 *  is layer 3 resolved here rather than in the component — so the menu's contents
 *  are unit-testable without rendering anything. */
export function armableSources(): {
  id: string; label: string; group: string;
  metric?: { field: string; domain: [number, number]; unit?: string };
  capability: TriggerCapability;
}[] {
  return SIGNALS.map((s) => ({
    id: s.id, label: s.label, group: s.group,
    ...(s.metric ? { metric: { field: s.metric.field, domain: s.metric.domain, unit: s.metric.unit } } : {}),
    capability: capabilityFor(s),
  }));
}

/** The kinds one source may actually be armed on, group ∪ implied − removed. */
export function triggersFor(sourceId: string): TriggerKind[] {
  const s = getSignal(sourceId);
  return s ? resolveTriggers(s.group, capabilityFor(s)) : [];
}
