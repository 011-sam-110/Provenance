"use client";
// Mounts the variant's persistent chrome — today that is the Source Catalog rail.
//
// This component had NO importer between the console rebuild (5f14051 swapped
// <PanelHost/> for <ConsoleWorkspace/> in ConsoleShell) and now, which is why
// `.tn-rail`, `.tn-rail-fab` and `.tn-layer-row` all measured 0 in the DOM at
// 1440, 390 and 360. ConsoleWorkspace mounts it again, inside `.tn-cw-shell` so
// the rail inherits the console's `--tn-lw` column-width var.
//
// It reads the variant's OWN panels, not variantStore.layoutForVariant(): a saved
// layout override is written every time a source is docked as a widget, and the
// rail must not be able to unmount itself as a side effect of that.
import { useVariant, resolveVariant } from "@/lib/variants/store";
import { PANEL_REGISTRY, persistentPanelsFor } from "@/lib/shell/panelRegistry";

export default function PanelHost() {
  const { activeId } = useVariant();
  const variant = resolveVariant(activeId);
  return (
    <>
      {persistentPanelsFor(variant.panels).map((k) => {
        const Cmp = PANEL_REGISTRY[k].component;
        return <Cmp key={k} />;
      })}
    </>
  );
}
