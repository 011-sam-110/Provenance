// The rows of the God's eye view's Sources tray, built from the console's own rail.
//
// SERVER ONLY. It reads the catalogue and the signal registry, which are far too big for
// /eye's browser bundle, so only app/(console)/eye/page.tsx may import it, and the rows go
// down as a prop (the repo has no `server-only` package). The browser half is lib/eye/sources.ts.
//
// THE RULE, BY PROPERTY AND NOT BY A LIST. The rows are the rail's rows (RAIL_SOURCES,
// grouped by buildSourceSections, so its six sections and its order), minus any row that
// has no map layer (`widgetOnly`: World Headlines) and minus any layer whose places are
// whole countries (`precision: "country"`): a country-wide figure is not something to put
// on a street. This view's own seven come first, in their own section, and are not
// repeated in the rail's sections below them. Leon's answer to "which layers": this view's
// own plus the console layers that show at street level.

import { RAIL_SOURCES } from "@/lib/console/sources/railSources";
import { buildSourceSections } from "@/lib/console/sources/sections";
import type { CatalogSource } from "@/lib/sources/catalog";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import type { SignalPrecision } from "@/lib/signals/types";
import { EYE_OWN_IDS, ownKind, type EyeSourceRow } from "@/lib/eye/sources";
import { THIS_VIEW } from "@/lib/eye/wording";

/** Precision of the console's core layers, which are not signals and so declare none. */
const CORE_PRECISION: Readonly<Record<string, SignalPrecision>> = {
  livecams: "exact",
  staticcams: "exact",
  planes: "exact",
  satellites: "exact",
};

/** A layer's precision: the signal's own, else the core layer's, else null (the borders). */
export function precisionOf(id: string): SignalPrecision | null {
  return MAP_SIGNALS.find((s) => s.id === id)?.precision ?? CORE_PRECISION[id] ?? null;
}

/** Why a rail row is not offered in this view. */
export interface EyeLeftOut {
  id: string;
  label: string;
  reason: "country" | "widget";
}

/** The rail's rows in their sections, each with the reason it is dropped, or null when it stays. */
function walk(catalog: readonly CatalogSource[], precision: (id: string) => SignalPrecision | null) {
  const out: { row: EyeSourceRow | null; left: EyeLeftOut | null }[] = [];
  for (const section of buildSourceSections(catalog)) {
    for (const r of section.rows) {
      const p = precision(r.id);
      if (r.widgetOnly) {
        out.push({ row: null, left: { id: r.id, label: r.label, reason: "widget" } });
      } else if (p === "country") {
        out.push({ row: null, left: { id: r.id, label: r.label, reason: "country" } });
      } else {
        const own = ownKind(r.id) != null;
        out.push({
          left: null,
          row: {
            id: r.id,
            label: r.label,
            color: r.color,
            section: own ? "view" : section.id,
            sectionTitle: own ? THIS_VIEW : section.title,
            own,
            // A core row (cameras, planes, satellites, the borders) is a map LAYER; the rest are
            // signals. Read from the row, not from lib/layers.ts: that is a "use client" module,
            // and a server component importing a value from one gets a client reference whose
            // keys are empty (every row came out `layer: false` on the dev server).
            layer: r.kind === "core",
            credit: r.attribution,
            precision: p,
          },
        });
      }
    }
  }
  return out;
}

/** The rows the tray offers: this view's own seven first, then the rail's, in the rail's order. */
export function eyeSourceRows(
  catalog: readonly CatalogSource[] = RAIL_SOURCES,
  precision: (id: string) => SignalPrecision | null = precisionOf,
): EyeSourceRow[] {
  const rows = walk(catalog, precision).flatMap((w) => (w.row ? [w.row] : []));
  const own = EYE_OWN_IDS.flatMap((id) => rows.filter((r) => r.id === id));
  return [...own, ...rows.filter((r) => !r.own)];
}

/** The rail's rows this view leaves out, and why. */
export function eyeLeftOut(
  catalog: readonly CatalogSource[] = RAIL_SOURCES,
  precision: (id: string) => SignalPrecision | null = precisionOf,
): EyeLeftOut[] {
  return walk(catalog, precision).flatMap((w) => (w.left ? [w.left] : []));
}

/** How many rows are left out for each reason, for the line in the tray's foot. */
export function leftOutCounts(left: readonly EyeLeftOut[]): { country: number; widget: number } {
  return {
    country: left.filter((l) => l.reason === "country").length,
    widget: left.filter((l) => l.reason === "widget").length,
  };
}
