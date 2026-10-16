// lib/events/sources.ts
// The curated set of signal sources that emit discrete, time/place-stamped EVENTS
// for the feed. Seeded with the proven ids the Top Events panel already fetches
// successfully (components/shell/TopEventsPanel.tsx). Add more (floods, severe-
// storms, volcanoes, conflict) as each one's normalized magnitude scale is
// confirmed — see the registry in lib/signals/registry.ts.
//
// magnitudeUnit is set ONLY where props.magnitude genuinely IS that unit, so the
// row can show a native value without the Round-1 "MW" mislabel. Leave it unset
// and the row leans on the source's own title for the human magnitude.

import type { EventType, GeoPrecision } from "@/lib/events/model";

export interface EventSource {
  /** Signal source id — the /api/signals/<id> route segment + store key. */
  id: string;
  type: EventType;
  /** Human source label for the row's source credit. */
  label: string;
  attribution: string;
  /** Default geo-precision for this source's points (per-feature precision is P3). */
  precision: GeoPrecision;
  /** Native magnitude unit, only when props.magnitude IS that unit. */
  magnitudeUnit?: string;
}

// FIRMS active-fire is a dense detection layer (~1500 raw points), not discrete events; significant wildfires arrive via GDACS WF.
export const EVENT_SOURCES: EventSource[] = [
  { id: "earthquakes", type: "quake", label: "Earthquakes", attribution: "USGS, EMSC and national seismic agencies", precision: "EXACT", magnitudeUnit: "M" },
  { id: "gdacs", type: "disaster", label: "Disasters (GDACS)", attribution: "GDACS", precision: "ADMIN" },
  { id: "tropical-cyclones", type: "cyclone", label: "Cyclones (NHC, JTWC)", attribution: "NOAA NHC, JTWC", precision: "ADMIN" },
];
