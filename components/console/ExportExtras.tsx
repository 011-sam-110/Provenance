"use client";
// The two export buttons that follow "GeoJSON" in a detail view: KML, and the data
// dictionary. Plain <button>s with no class of their own, so each footer styles them
// with the rule it already has for its CSV and GeoJSON buttons.

import type { GeoPoint } from "@/lib/export";
import { saveDataDictionary, saveKml } from "@/lib/export/save";

export const KML_TITLE = "The same points as the GeoJSON, for Google Earth";
export const DICTIONARY_TITLE = "What each column means, the source of the data and the time of the export (plain text)";

export default function ExportExtras({
  name,
  kind,
  rows,
  geo,
  source,
  extra,
}: {
  /** The name of the export: the same one its CSV and GeoJSON files carry. */
  name: string;
  /** Which dictionary describes the columns (lib/export/dictionary.ts). */
  kind: string;
  rows: Record<string, unknown>[];
  geo: GeoPoint[];
  /** The credit line of the data. */
  source: string;
  /** Meanings of columns that only this view knows. */
  extra?: Record<string, string>;
}) {
  return (
    <>
      <button disabled={geo.length === 0} title={KML_TITLE} onClick={() => saveKml(name, geo)}>⬇ KML</button>
      <button
        disabled={rows.length === 0 && geo.length === 0}
        title={DICTIONARY_TITLE}
        onClick={() => saveDataDictionary({ name, kind, rows, geo, source, extra })}
      >⬇ Data dictionary</button>
    </>
  );
}
