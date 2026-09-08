// LAYER 3 — a source's own declaration, and the last word.
//
// RESOLUTION ORDER, so no case is left to interpretation:
//   1. start with the group's kinds
//   2. a declared FIELD BLOCK implies its kind, whatever the group said —
//      declaring the field is the statement that the source can back the kind
//   3. union with `add`
//   4. subtract `remove`, which wins over everything including an implied kind
//
// Step 4 beating step 2 is what lets a source declare a `state` field so layer 4
// can audit it, while still refusing to be armed on it.

import { GROUP_TRIGGERS } from "@/lib/notify/groups";
import type { TriggerCapability, TriggerKind } from "@/lib/notify/types";

/** PURE: the kinds this source may be armed on, in a stable order. */
export function resolveTriggers(
  group: string,
  declaration: TriggerCapability | undefined,
): TriggerKind[] {
  const set = new Set<TriggerKind>(GROUP_TRIGGERS[group] ?? []);

  if (declaration) {
    if (declaration.scalars && declaration.scalars.length > 0) set.add("crosses");
    if (declaration.state) set.add("state");
    if (declaration.due) set.add("due");
    for (const k of declaration.add ?? []) set.add(k);
    for (const k of declaration.remove ?? []) set.delete(k);
  }

  // A stable order so the composer's dropdown does not reshuffle between renders.
  const ORDER: TriggerKind[] = [
    "appears", "disappears", "enters", "leaves",
    "crosses", "count", "state", "due", "quiet",
  ];
  return ORDER.filter((k) => set.has(k));
}
