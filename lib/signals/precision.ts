// lib/signals/precision.ts
// How precise the PLACE of a signal feature is, resolved in one place.
//
// THE RULE THIS SERVES. A place NAME is never to be read as a precise point. A
// country total placed on a centroid, a headline that names a city and an oblast
// under an air-raid alert all have a latitude and a longitude, and none of them is
// an event at that latitude and longitude. The level says which kind of place a
// feature has, so the detail panel can say it in words.
//
// TWO SOURCES, ONE ANSWER. Every layer declares a default on its `SignalSource`
// (the field is required, so a layer without one does not compile). A feature sets
// its own level only where one layer mixes levels: GDACS carries epicentres and
// flood areas, the headline layer carries cities and countries. `resolvePrecision`
// is the only function that combines the two.
//
// Pure, with type-only imports, so the client bundle can import it without the
// adapters and node tests can import it without React.

import type { SignalFeature, SignalPrecision, SignalSource } from "@/lib/signals/types";

/** Every level, from the most precise place to the least. */
export const SIGNAL_PRECISIONS: readonly SignalPrecision[] = ["exact", "facility", "area", "country"];

/** True when the value is one of the four levels. Guards data that crossed the wire. */
export function isSignalPrecision(value: unknown): value is SignalPrecision {
  return typeof value === "string" && (SIGNAL_PRECISIONS as readonly string[]).includes(value);
}

/**
 * The level of one feature: its own when the adapter set a valid one, else the
 * default of its layer.
 */
export function resolvePrecision(
  feature: Pick<SignalFeature, "precision">,
  source: Pick<SignalSource, "precision">,
): SignalPrecision {
  return isSignalPrecision(feature.precision) ? feature.precision : source.precision;
}

/**
 * A copy of the features with the resolved level written on each one.
 *
 * The /api/signals/<id> route calls this on the way out, so every consumer of the
 * payload reads `precision` from the feature and none has to know the registry.
 * It returns a NEW array: the coverage and outcome records ride on the adapter's
 * own array (lib/signals/coverage.ts, lib/signals/outcome.ts), so the route reads
 * those from the original before it calls this.
 */
export function withResolvedPrecision(
  features: readonly SignalFeature[],
  source: Pick<SignalSource, "precision">,
): SignalFeature[] {
  return features.map((f) => {
    const precision = resolvePrecision(f, source);
    return f.precision === precision ? f : { ...f, precision };
  });
}

/** The words for one level: a short name and the one plain line the panel shows. */
export interface PrecisionWording {
  /** Two or three words, for a chip or a legend row. */
  label: string;
  /** One plain sentence pair that says how precise the place is. */
  line: string;
}

export const PRECISION_WORDING: Readonly<Record<SignalPrecision, PrecisionWording>> = {
  exact: {
    label: "Exact point",
    line: "Exact point. The source gives these coordinates for this item.",
  },
  facility: {
    label: "Named facility",
    line: "Named facility. The mark is on the site.",
  },
  area: {
    label: "Area",
    line: "Area-level. The mark stands for an area, not an exact point.",
  },
  country: {
    label: "Country figure",
    line: "Country-level figure. Not an event at this point.",
  },
};

/**
 * The level the detail panel shows for a clicked signal object.
 *
 * `meta.precision` is the level the route resolved. An object can lack it (a payload
 * cached by an older build, or an object built by hand), and then the layer default
 * answers. `layerDefault` is passed in so this file needs no import of the registry.
 * Returns undefined only for an unknown layer, and the panel then shows no line: no
 * claim is better than a guessed one.
 */
export function precisionOfObject(
  meta: { precision?: unknown; signalId?: unknown },
  layerDefault: (signalId: string) => SignalPrecision | undefined,
): SignalPrecision | undefined {
  if (isSignalPrecision(meta.precision)) return meta.precision;
  return typeof meta.signalId === "string" ? layerDefault(meta.signalId) : undefined;
}

/** True for the two levels whose `lat`/`lon` is an anchor, not the place of the thing. */
export function isAnchorOnly(precision: SignalPrecision): boolean {
  return precision === "area" || precision === "country";
}
