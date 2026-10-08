"use client";
// Find the place of a typed question. The one part of the question reader that
// reads something from the network, and it reads only what the app already reads:
//
//   /geo/countries-110m.geojson   the country outlines the map itself loads
//   /api/geocode                  the place search the palette already uses
//
// The question text does not go to a model, and only the place words go to the
// geocoder: the same words the palette sent before, as its "fly to any place" search.
//
// A country that the reader knows by name needs no geocoder call at all. Every
// failure is "not found" (null): the palette then shows the place as not found and
// applies no place filter.

import type { GeocodeResult } from "@/lib/geo/geocode";
import { buildCountryOutlines } from "@/lib/map/precisionMarks";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { normalisePhrase, placeLabel, type AskFilter } from "@/lib/shell/ask";
import { placeFromCountry, placeFromGeocode, type ResolvedPlace } from "@/lib/shell/askPlace";

type Outlines = Map<string, GeoJSON.Geometry>;

let outlines: Promise<Outlines> | null = null;

function loadOutlines(): Promise<Outlines> {
  outlines ??= fetch("/geo/countries-110m.geojson")
    .then((r) => r.json())
    .then((fc) => buildCountryOutlines(fc as GeoJSON.FeatureCollection))
    .catch(() => {
      outlines = null; // let the next question try again
      return new Map() as Outlines;
    });
  return outlines;
}

const found = new Map<string, ResolvedPlace>();

/** The place of a question, or null when it cannot be found. Found places are kept. */
export async function lookupPlace(filter: Extract<AskFilter, { kind: "place" }>): Promise<ResolvedPlace | null> {
  const key = `${filter.countryIso3 ?? ""}|${normalisePhrase(filter.text)}`;
  const hit = found.get(key);
  if (hit) return hit;

  const byIso3 = await loadOutlines();
  let place: ResolvedPlace | null = null;
  if (filter.countryIso3) place = placeFromCountry(placeLabel(filter.text), byIso3.get(filter.countryIso3));
  if (!place) {
    // Not a country the reader knows, or a country with no outline in the file.
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(filter.text)}`);
      const data = (await res.json()) as { results?: GeocodeResult[] };
      const first = data.results?.[0];
      if (first) {
        place = placeFromGeocode(first, (iso2) => {
          const iso3 = centroidByIso2(iso2)?.iso3;
          return iso3 ? byIso3.get(iso3) : undefined;
        });
      }
    } catch {
      place = null;
    }
  }
  if (place) found.set(key, place);
  return place;
}
