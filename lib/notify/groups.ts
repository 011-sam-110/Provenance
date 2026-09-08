// LAYER 2 — what a FAMILY of sources can be asked.
// LAYER 3 — what ONE source overrides, which is the last word.
//
// Keyed by the `group` a source already carries (see SignalSource.group in
// lib/signals/types.ts), so a new adapter registered into an existing group is
// armable the moment it exists, with no notification code written. That is the
// "one adapter + one registry entry" rule this codebase already holds, extended
// to notifications.
//
// An UNKNOWN group resolves to nothing rather than to a default set. A source
// that quietly inherits someone else's capabilities is how a menu starts lying.
//
// EVERY KEY BELOW IS A GROUP A REGISTERED SOURCE ACTUALLY CARRIES, and
// tests/unit/notify-groups.test.ts asserts that in both directions. It has to,
// because neither direction is visible from the other: a group named here that no
// source carries is dead code that reads as coverage, and a group a source carries
// that is missing here makes that source silently unarmable with no error anywhere.
// This file was first written against invented names — five of thirteen keys matched
// nothing, and five real groups had no entry — and nothing failed until the menu was
// opened. Measure against the registry, never against memory.

import type { TriggerCapability, TriggerKind } from "@/lib/notify/types";

export const GROUP_TRIGGERS: Record<string, TriggerKind[]> = {
  // Rows appear at a fixed place and do not move, so enters/leaves are meaningless.
  "Natural hazards": ["appears", "crosses", "count", "quiet"],
  "Civic safety": ["appears", "count", "quiet"],
  "Human cost": ["appears", "count", "quiet"],
  Environment: ["appears", "crosses", "count", "quiet"],

  // Rows carry a stable id and a position that CHANGES between polls.
  Maritime: ["appears", "disappears", "enters", "leaves", "count", "quiet"],
  Military: ["appears", "count", "quiet"],

  // A per-entity status that changes.
  "Cyber threat": ["appears", "disappears", "crosses", "count", "quiet"],
  Conflict: ["appears", "disappears", "state", "count", "quiet"],

  // MIXED, and the reason SOURCE_CAPABILITY below exists. This one group holds live
  // status (grid load, internet outages, cloud status, GPS jamming) alongside OSM
  // reference data (cables, landings, plants, airports, ports). The group default is
  // the LIVE reading; the reference rows take it away one by one.
  Infrastructure: ["appears", "crosses", "count", "quiet"],

  // Forward-looking and time-anchored, so `due` is the real trigger and a count of
  // scheduled rows says very little.
  Space: ["appears", "due", "quiet"],

  // An index / forecast field, not a set of rows. Counting them means nothing; the
  // honest question is whether the index crossed something.
  "Space weather": ["crosses", "quiet"],

  // Coded news COVERAGE. Armable, but every message it sends is forced through the
  // "reported, not a verified incident" wording in lib/notify/wording.ts. Whether it
  // should be armable at all is an open call recorded in §2 of the design.
  Intel: ["appears", "count", "quiet"],

  // A derived score. Not a set of rows, so counting them says nothing.
  Synthesis: ["quiet"],
};

/** Every kind, for a source that can honestly back none of them. */
const NOTHING: TriggerKind[] = [
  "appears", "disappears", "enters", "leaves",
  "crosses", "count", "state", "due", "quiet",
];

/**
 * LAYER 3 — a single source's own word, which beats its group.
 *
 * WHY IT LIVES HERE AND NOT ON `SignalSource`. The registry's contract is "one
 * adapter file + one SIGNALS entry, no edits anywhere else", and adding a
 * notification field to that interface would put a notification concern in every
 * adapter. Keying it by source id keeps the whole four-layer resolution inside
 * lib/notify, where a reader can see all of it at once.
 *
 * OSM REFERENCE DATA IS THE CASE THAT FORCED IT. Plants, ports, airports, cables and
 * their landings are a position and a set of tags, refreshed on a scale of months,
 * with no operating state at all. "Tell me if this nuclear plant goes down" was
 * asked for by name and is NOT buildable from `power=plant`, so the composer offers
 * nothing for these rather than a trigger that would never fire — or worse, one that
 * would fire on an OSM edit and be read as an outage.
 */
export const SOURCE_CAPABILITY: Record<string, TriggerCapability> = {
  nuclear: { remove: NOTHING },
  ports: { remove: NOTHING },
  airports: { remove: NOTHING },
  cables: { remove: NOTHING },
  "cable-landings": { remove: NOTHING },
};

/**
 * PURE: the full declaration for one source — its own word, plus the scalar its
 * `metric` already names.
 *
 * A source with no `metric` names no real numeric field, so `crosses` has nothing to
 * compare and is removed. The group default cannot conjure a field, and inventing
 * one would put a threshold box on screen that reads a property that is never there.
 */
export function capabilityFor(
  source: { id: string; metric?: { field: string; domain: [number, number] } },
): TriggerCapability {
  const declared = SOURCE_CAPABILITY[source.id];
  const remove = new Set<TriggerKind>(declared?.remove ?? []);
  if (!source.metric) remove.add("crosses");

  return {
    ...declared,
    ...(source.metric
      ? { scalars: [{ field: source.metric.field, label: source.metric.field, domain: source.metric.domain }] }
      : {}),
    ...(remove.size > 0 ? { remove: [...remove] } : {}),
  };
}
