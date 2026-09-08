// LAYER 2 — what a FAMILY of sources can be asked.
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
// "Static infrastructure" is deliberately EMPTY and that is the interesting entry.
// Nuclear plants, ports, airports and cables are OpenStreetMap reference data:
// position and tags, no operating state, changing on a scale of months. There is
// no honest rule to build against them, so the composer offers none — see
// §11 of the spec.

import type { TriggerKind } from "@/lib/notify/types";

export const GROUP_TRIGGERS: Record<string, TriggerKind[]> = {
  // Rows carry a stable id and a position that CHANGES between polls.
  Movers: ["appears", "disappears", "enters", "leaves", "crosses", "count", "quiet"],
  Maritime: ["appears", "disappears", "enters", "leaves", "count", "quiet"],
  Military: ["appears", "count", "quiet"],

  // Rows appear at a fixed place and do not move, so enters/leaves are meaningless.
  "Natural hazards": ["appears", "crosses", "count", "quiet"],
  Weather: ["appears", "crosses", "count", "quiet"],
  "Human cost": ["appears", "count", "quiet"],

  // A per-entity status that changes.
  "Cyber threat": ["appears", "disappears", "crosses", "count", "quiet"],
  Infrastructure: ["appears", "crosses", "count", "quiet"],
  Space: ["appears", "count", "quiet"],

  // A derived score. Not a set of rows, so counting them says nothing.
  Synthesis: ["quiet"],

  // Text rows arriving.
  News: ["appears", "count", "quiet"],

  // Streams that stop answering.
  Cameras: ["disappears", "count", "quiet"],

  // No state is published. Nothing to notice a change in.
  "Static infrastructure": [],
};
