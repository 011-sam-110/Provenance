import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { AUGUR_ATTRIBUTION, circleRing, parseGnssNotams, readAugur, type GnssNotam } from "@/lib/signals/augur";

// GNSS jamming warnings — the NOTAMs that air navigation service providers in and
// around Europe have issued for GPS/GNSS jamming, interference or spoofing, as
// EUROCONTROL AUGUR collects them. Keyless; read through lib/signals/augur.ts (one
// shared, 6-hourly read of the AUGUR document).
//
// A NEW LAYER, not part of `gpsJamming`, because it means something different: the
// gpsJamming cells are MEASURED interference (aircraft reporting degraded
// navigation); these are OFFICIAL WARNINGS that interference is possible or planned
// (a military exercise, a whole FIR near a war zone). A warning area with no measured
// jamming, and measured jamming with no warning, are both normal.
//
// The place is the NOTAM's own Q-line: a centre and a radius in nautical miles,
// drawn as a circle. That circle is the NOTAM's coarse area of influence, often a
// whole flight information region, not the jammer's position.

export const GNSS_NOTAMS_ATTRIBUTION = `GNSS NOTAMs: national air navigation service providers, via ${AUGUR_ATTRIBUTION}`;
const REFRESH_MS = 6 * 60 * 60 * 1000;

/** Pure: in-force NOTAMs → one circle per NOTAM, anchored at its Q-line centre. */
export function gnssNotamFeatures(notams: GnssNotam[]): SignalFeature[] {
  return notams.map((n) => ({
    id: `gnss-notam:${n.fir}-${n.number.replace("/", "-")}`,
    lat: n.lat,
    lon: n.lon,
    title: `GNSS warning ${n.fir} ${n.number}`,
    signalId: "gnss-notams",
    color: "#9333ea",
    geometry: { type: "Polygon", coordinates: [circleRing(n.lat, n.lon, n.radiusNm)] },
    link: "https://augur.eurocontrol.int/",
    ts: n.from,
    props: {
      notam: `${n.fir} ${n.number}`,
      fir: n.fir,
      radiusNm: n.radiusNm,
      from: n.from,
      until: n.to ?? "permanent",
      text: n.text.length > 600 ? `${n.text.slice(0, 597)}...` : n.text,
    },
  }));
}

export const GNSS_NOTAMS_SOURCE: SignalSource = {
  id: "gnss-notams",
  // The NOTAM's Q-line circle: an area of influence, not a position.
  precision: "area",
  label: "GNSS jamming warnings",
  group: "Infrastructure",
  color: "#9333ea",
  refreshMs: REFRESH_MS,
  attribution: GNSS_NOTAMS_ATTRIBUTION,
  sourceUrl: "https://augur.eurocontrol.int/",
  async fetch() {
    const doc = await readAugur();
    if (!doc) return degraded("fetch failed");
    const features = gnssNotamFeatures(parseGnssNotams(doc.value, Date.now()));
    // A failed re-read serves the last good document, declared as such.
    return doc.ok ? observed(features, doc.at) : degradedWith(features, "fetch failed", doc.at);
  },
};
