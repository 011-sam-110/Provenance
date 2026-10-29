// How many rows the console's Sources rail draws, for the foot of /eye's Sources tray
// ("Open the full map with all N sources") and its empty search. It is read from the same
// list and the same grouping the rail renders (components/shell/SourceCatalog.tsx:
// buildSourceSections(RAIL_SOURCES)), so the tray and the rail cannot disagree. Called in
// app/(console)/eye/page.tsx, on the server, and passed down as a number, so the rail's
// list stays out of /eye's browser bundle.

import { RAIL_SOURCES } from "@/lib/console/sources/railSources";
import { buildSourceSections } from "@/lib/console/sources/sections";

export function railSourceCount(): number {
  return buildSourceSections(RAIL_SOURCES).reduce((n, section) => n + section.rows.length, 0);
}
