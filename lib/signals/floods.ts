// Floods — four primary sources since 2026-10-16, where there used to be one relay.
//
// Until then this layer was NASA EONET's floods category, and every EONET flood is a
// GDACS event relayed. EONET began publishing new floods as [lon, lat] at about
// 2026-09-26 while older ones stayed [lat, lon], and prod pinned "Flood in Nepal" at
// 84.6 N (sources-audit/eonet.md). Reading GDACS directly removes the relay and the
// coordinate guess: SEARCH returns standard GeoJSON [lon, lat] points.
//
//   • GDACS SEARCH FL, 60 days — global, model-detected (GloFAS) flood events.
//   • NWS Flood / Flash Flood Warnings — US, drawn as the warning polygons.
//   • NWPS river gauges in flood — US, observed stage at the gauge.
//   • Copernicus EMS flood activations — impact-grade, mapped events. When the event
//     is also a GDACS event on this layer it is attached to it, not pinned twice.
//
// The `gdacs` multi-hazard layer still shows the CURRENT GDACS floods among its other
// hazards. That is the same overlap EONET had (it was a relay of the same events);
// the two layers answer different questions and are toggled separately.

import type { SignalSource } from "@/lib/signals/types";
import { fetchGdacsSearch, gdacsToLayerFeatures } from "@/lib/signals/gdacs";
import { fetchNwsAlerts, nwsAlertsToFeatures, nwsGaugesToFeatures, NWS_GAUGES_URL } from "@/lib/signals/nws";
import { attachCemsToGdacs, cemsToFeatures, fetchCemsActivations } from "@/lib/signals/copernicus-ems";
import { getJson, readInput, withInputsOutcome } from "@/lib/signals/multiInput";

export const FLOODS_WINDOW_DAYS = 60;
export const FLOOD_COLOR = "#0ea5e9";

export const FLOODS_ATTRIBUTION =
  "Global Disaster Alert and Coordination System, GDACS; NOAA National Weather Service; " +
  "© European Union, Copernicus Emergency Management Service";

export const FLOODS_SOURCE: SignalSource = {
  id: "floods",
  // A GDACS flood point is the centroid of an affected area; NWS warnings are polygons.
  // Gauges set "facility" per feature.
  precision: "area",
  label: "Floods",
  group: "Natural hazards",
  color: FLOOD_COLOR,
  refreshMs: 10 * 60 * 1000,
  attribution: FLOODS_ATTRIBUTION,
  async fetch() {
    const now = Date.now();
    const [gdacs, warnings, gauges, cems] = await Promise.all([
      readInput("floods:gdacs", "GDACS", async () =>
        gdacsToLayerFeatures(
          await fetchGdacsSearch("FL", FLOODS_WINDOW_DAYS, now, (u) => getJson(u, 20_000)),
          { signalId: "floods", idPrefix: "floods:gdacs", sourceLabel: "GDACS (GloFAS)" },
        ),
      now),
      readInput("floods:nws", "NWS warnings", async () => nwsAlertsToFeatures(await fetchNwsAlerts(now), "floods"), now),
      readInput("floods:gauges", "NWS gauges", async () => nwsGaugesToFeatures(await getJson(NWS_GAUGES_URL, 20_000)), now),
      readInput("floods:cems", "Copernicus EMS", async () =>
        cemsToFeatures(await fetchCemsActivations(now), {
          category: "Flood",
          signalId: "floods",
          color: FLOOD_COLOR,
          maxAgeDays: FLOODS_WINDOW_DAYS,
          now,
        }),
      now),
    ]);
    const features = [
      ...attachCemsToGdacs(gdacs.features, cems.features),
      ...warnings.features,
      ...gauges.features,
    ];
    return withInputsOutcome([gdacs, warnings, gauges, cems], features, now);
  },
};
