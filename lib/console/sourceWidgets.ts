// Which CONSOLE widget type does a Source Catalog row open?
//
// The rail lists catalog sources (lib/sources/catalog.ts). The console renders
// widget *types* (lib/console/registry.ts). This module is the single mapping
// between the two, kept pure + node-testable so the rail's ＋ button and the
// widget registry can never drift apart.
//
// Three cases:
//   • a core layer that already has a bespoke console widget → that widget
//     ("planes" is shown by the Aviation card, not a second planes card),
//   • any other core layer → the generic leaf registered in widgets/sources.tsx,
//   • a signal → the per-signal card widgets/signals.tsx already registers.
//
// It used to point at variantStore's dock layout instead, which nothing has
// rendered since the console rebuild — so every ＋ click silently wrote to a
// store with no reader and the button looked broken. See lib/widgets/dock.ts.

import { kindOf } from "@/lib/sources/catalog";

/** Core layers whose data is already shown by a bespoke console widget. */
const CORE_TO_WIDGET: Record<string, string> = {
  cameras: "cameras",
  planes: "aviation",
  satellites: "satellites",
};

/** Prefix for the generic per-source leaf card (core sources with no bespoke widget). */
export const SOURCE_WIDGET_PREFIX = "source:";
/** Prefix for the per-category roll-up card. */
export const ROLLUP_WIDGET_PREFIX = "rollup:";

export function sourceWidgetId(id: string): string {
  return `${SOURCE_WIDGET_PREFIX}${id}`;
}

export function rollupWidgetId(group: string): string {
  return `${ROLLUP_WIDGET_PREFIX}${group}`;
}

/** The console widget type that shows this catalog source. */
export function widgetTypeForSource(id: string): string {
  if (kindOf(id) === "signal") return `signal:${id}`;
  return CORE_TO_WIDGET[id] ?? sourceWidgetId(id);
}

/** The console widget type that shows this catalog group's roll-up. */
export function widgetTypeForGroup(group: string): string {
  return rollupWidgetId(group);
}

/** Core ids that need the generic leaf card registering (no bespoke widget). */
export function genericCoreIds(coreIds: readonly string[]): string[] {
  return coreIds.filter((id) => !(id in CORE_TO_WIDGET));
}
