"use client";
// "Open the six recon tools" from the network dossier: point the shared recon target at
// the looked-up network, and add the recon cards that are not on the board yet.
//
// The cards go into the right rail through shellLayoutStore.add, the same door the
// placement picker uses. It refuses at capacity, so a full board gets fewer cards and
// the caller says so. Nothing here is persisted that the board does not already keep.

import { shellLayoutStore } from "@/lib/console/store";
import { getWidgetType } from "@/lib/console/registry";
import { reconTargetStore } from "@/lib/recon/targetStore";
import "@/lib/console/widgets/recon";
import { missingReconTools } from "@/lib/recon/reconTools";

/** Set the target and add the missing cards. Answers how many were added and missing. */
export function openReconTools(target: string): { added: number; missing: number } {
  reconTargetStore.set(target);
  const todo = missingReconTools(shellLayoutStore.get().widgets.map((w) => w.type));
  let added = 0;
  for (const type of todo) {
    const result = shellLayoutStore.add(type, {
      segment: "right",
      height: getWidgetType(type)?.defaultHeight,
    });
    if (!result.ok) break;
    added++;
  }
  return { added, missing: todo.length - added };
}
