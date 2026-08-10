// Map click arbitration — the pure decision behind "did the user click a pin, or
// the country underneath it?".
//
// WHY THIS EXISTS. `country-fill` is a ~transparent polygon layer covering every
// landmass, added BEFORE every pin layer, so it sits at the bottom of the stack
// and *every* pin click is also a country click. MapLibre fires both layer-scoped
// handlers for the same event, so exactly one of them has to stand down. The old
// arbitration lived inline in WorldMap as a "guard layer" list and had a hole big
// enough to make the country dossier unreachable: the Country Instability Index
// plots a pin on EVERY country centroid, and those pins are guard layers, so with
// that (flagship) layer on, the guard swallowed the country click across most of
// the map — and the CII pin itself only ever opened the thin signal dossier.
//
// The rules, in one place:
//   • A pin genuinely under the cursor WINS. Clicking a camera opens the camera.
//   • Everywhere else inside a country opens the country dossier.
//   • The country-SCOPED signals are the exception: their pin *is* the country
//     (the CII pin sits on the centroid and scores the country), so it opens the
//     country dossier — which renders the full index anyway, see CountryDetail's
//     InstabilitySlot. It only falls back to its own signal dossier when there is
//     no country polygon under it (an unmapped territory, or countries toggled off).
//
// Pure and unit-tested; WorldMap owns the MapLibre side effects.

/** What a click resolves to. "none" ⇒ empty map, nothing to open. */
export type MapClickTarget = "pin" | "country" | "none";

/** One rendered feature under the cursor, distilled from queryRenderedFeatures. */
export interface MapClickHit {
  /** The style layer id that rendered the feature (`feature.layer.id`). */
  layer: string;
  /** `properties.signalId` — only features from the signal layers carry one. */
  signalId?: string;
}

/** The ~transparent country polygon layer that doubles as the dossier hit-area. */
export const COUNTRY_HIT_LAYER = "country-fill";

/**
 * Every layer whose features are a clickable object in their own right. Order is
 * irrelevant — presence alone decides — but the list must stay in sync with the
 * layers WorldMap wires a click handler to, or a pin click would open the country
 * behind it (or vice versa).
 */
export const PIN_HIT_LAYERS: readonly string[] = [
  "camera-markers", "camera-dots", "camera-clusters", "camera-cluster-count",
  "webcam-markers", "webcam-dots", "webcam-clusters", "webcam-cluster-count",
  "plane-markers", "satellite-core",
  "signal-dots", "signal-icons", "signal-line-paths", "signal-fill-areas",
  "user-pin-dots",
];

/**
 * Signal sources whose pin describes a COUNTRY rather than an event at a point.
 * Their marker sits on the country centroid, so it must not shadow the country.
 */
export const COUNTRY_SCOPED_SIGNALS: readonly string[] = ["instability"];

const PIN_LAYER_SET = new Set(PIN_HIT_LAYERS);
const COUNTRY_SCOPED_SET = new Set(COUNTRY_SCOPED_SIGNALS);

/** True when this signal id's pin stands for the country it sits on. */
export function isCountryScopedSignal(signalId: string | undefined | null): boolean {
  return typeof signalId === "string" && COUNTRY_SCOPED_SET.has(signalId);
}

/**
 * Decide what a click at a point belongs to, given every rendered feature under
 * the cursor. Deliberately order-independent: MapLibre documents
 * queryRenderedFeatures as topmost-first, but the country hit-area is always at
 * the bottom of the stack anyway, so "any real pin wins" is both simpler and
 * immune to a future layer reorder.
 *
 * Non-interactive hits (basemap fills, borders, labels) are ignored entirely.
 */
export function resolveMapClickTarget(hits: readonly MapClickHit[]): MapClickTarget {
  let country = false;
  let countryScopedPin = false;

  for (const hit of hits) {
    if (hit.layer === COUNTRY_HIT_LAYER) {
      country = true;
      continue;
    }
    if (!PIN_LAYER_SET.has(hit.layer)) continue; // decoration — never clickable
    if (isCountryScopedSignal(hit.signalId)) {
      countryScopedPin = true;
      continue;
    }
    return "pin";
  }

  if (country) return "country";
  // A country-scoped pin with no country under it (unmapped territory, or the
  // countries layer is off) still has to open something — its own dossier.
  if (countryScopedPin) return "pin";
  return "none";
}
