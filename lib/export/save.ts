// Browser-side: the two downloads that sit beside CSV and GeoJSON in every export
// menu. The text of each file comes from a pure function (toKml, toDataDictionary);
// this file only names the file and hands it to the browser.

import { KML_MIME, downloadText, exportFilename, toKml, type GeoPoint } from "@/lib/export";
import { toDataDictionary, type DictionaryInput } from "@/lib/export/dictionary";

/** Download the points of an export as a KML file, for Google Earth. */
export function saveKml(name: string, geo: GeoPoint[]): void {
  const base = exportFilename(name, Date.now());
  downloadText(`${base}.kml`, KML_MIME, toKml(geo, { name: base }));
}

/** Download the data dictionary of an export as a plain text file. */
export function saveDataDictionary(input: Omit<DictionaryInput, "at">): void {
  const at = Date.now();
  downloadText(`${exportFilename(input.name, at)}-data-dictionary.txt`, "text/plain", toDataDictionary({ ...input, at }));
}
