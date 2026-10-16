// What every layer actually is, how much to trust it, and what it CANNOT tell you.
//
// THE POINT. Our nearest competitor invented this card — source, freshness,
// confidence, limitations — and it is genuinely the best idea in their product.
// They shipped it for 8 of their 20 layers. The other twelve, including several
// headline ones, render a fallback admitting "a curated source and confidence card
// has not been added yet". A trust feature with a 60% hole in it teaches users not
// to rely on it.
//
// So the differentiator here is not the idea, it is COMPLETENESS: every registered
// layer, no exceptions, no fallback string. tests/unit/signals-explain.test.ts
// fails the build when a layer is registered without an entry, which means the
// only way to add a layer is to be able to say what it can't do.
//
// HOUSE RULES for writing an entry:
//   • `limitations` is never empty. Every dataset has a boundary; if you cannot
//     name one you do not understand the source well enough to ship it.
//   • Say the unflattering thing. "Detects heat, not fire" and "absence of a pin
//     is not absence of the thing" are the entries that earn the card its trust.
//   • `confidence` describes the DATA's provenance, not our uptime.
//   • No marketing voice. A limitation written to sound reassuring is worse than
//     no limitation at all.

import { SIGNALS } from "@/lib/signals/registry";

/**
 * How the number in front of you came to exist. Ordered loosely from most to
 * least direct — this is provenance, not quality: a good model beats a bad sensor.
 */
export type Confidence =
  /** A physical instrument measured it (seismometer, air-quality monitor, ADS-B transponder). */
  | "measured"
  /** An official body states it (a government agency, a UN cluster, an operator). */
  | "official"
  /** Someone reported it and a human or organisation checked it (curated databases, ACLED). */
  | "reported"
  /** A model produced it (forecasts, indices, interpolated fields). */
  | "modelled"
  /** WE computed it from other layers on this map. The most caveated category. */
  | "derived";

export interface LayerExplainer {
  /** Must match a `SignalSource.id` in the registry. */
  id: string;
  /** One sentence: what a single pin on this layer IS. Concrete, not a category name. */
  whatItShows: string;
  /** How the value/severity is arrived at. "Reported directly by the source" is a fine answer. */
  method: string;
  confidence: Confidence;
  /** Geographic or population boundary. Say "global" only when it is genuinely global. */
  coverage: string;
  /** What this layer cannot tell you. At least one. Plain language, no hedging. */
  limitations: string[];
}

const EXPLAINERS: LayerExplainer[] = [
  // --- Synthesis ------------------------------------------------------------
  {
    id: "instability",
    whatItShows: "A 0–100 country instability score, composited from conflict (GDELT article volume), food insecurity, displacement and internet outages. Not a map layer — it feeds the Brief, the Country Instability widget and the country dossier.",
    method: "A weighted mean of the available factors, rescaled to 0–100, with the number of contributing factors published alongside the score.",
    confidence: "derived",
    coverage: "Every country for which at least one input factor has data.",
    limitations: [
      "This is OUR composite, not an established index. It is not INFORM, not Fragile States, and has not been validated against them.",
      "The score is a floor, not a measurement: a factor with no data counts as 0 and nothing is renormalised, so a country scored on one factor of four cannot score high. Even with every input present, the conflict factor (GDELT article volume) is hard-capped, so no score can exceed 82. The factor count shown beside the score tells you how much of the formula actually ran.",
      "A low score means we found little signal, which is not the same as a country being stable.",
      "Weights are a judgement call, not a fitted model.",
    ],
  },

  // --- Natural hazards ------------------------------------------------------
  {
    id: "earthquakes",
    whatItShows: "An earthquake located by a seismic agency, sized by magnitude. One dot per quake, however many catalogues list it; the panel says which reported it.",
    method: "Read from ten catalogues: USGS, EMSC, GFZ GEOFON and the national agencies of New Zealand (GeoNet), Italy (INGV), Japan (JMA), Australia (Geoscience Australia), Canada (NRCan), Indonesia (BMKG) and Spain (IGN). Rows within 2 minutes, 60 km and 0.8 magnitude of each other are one event. The shown row is the national agency's inside its own country, then USGS, then GEOFON, then EMSC. Magnitude and depth are that agency's, unmodified.",
    confidence: "measured",
    coverage: "Global for about M4.5 and up. Below that it depends on where a catalogue is read: about M2.5 in the US, and smaller local events in New Zealand, Italy, Japan, Australia, Canada, Indonesia and Iberia. Elsewhere small quakes come only through EMSC, which misses many.",
    limitations: [
      "Early magnitudes are automatic and get revised, sometimes by several tenths, in the hours after an event.",
      "Catalogues disagree on magnitude, depth and epicentre for the same quake. The panel lists each catalogue's magnitude; the dot shows one of them.",
      "Reported by several catalogues is not independent confirmation: EMSC and USGS often carry the same national network's solution.",
      "Two quakes seconds apart in a swarm can be joined into one dot, or one quake left as two when catalogues disagree by more than the rule allows.",
      "A large magnitude in an unpopulated area matters less than a moderate one under a city — this layer shows the physics, not the impact.",
      "Small quakes in poorly instrumented regions are simply never recorded.",
    ],
  },
  {
    id: "wildfires",
    whatItShows: "A named wildfire incident: from NIFC in the United States, from GDACS elsewhere, plus burnt areas EFFIS mapped in Europe this week and Copernicus EMS mapping activations.",
    method: "US incidents come from NIFC's WFIGS, the interagency system of record, wildfires only (no prescribed burns). Outside the US, GDACS fire events detected by the EU's Global Wildfire Information System.",
    confidence: "official",
    coverage: "Every current US wildfire incident; elsewhere, fires GDACS saw burning in the last 7 days.",
    limitations: [
      "These are INCIDENTS, not burning pixels. A fire that no agency has declared will not appear here even while it burns.",
      "A US incident stays on the list until the agency closes it, so a pin does not prove something is burning right now.",
      "A GDACS fire point is the centre of the affected area, not the fire front.",
      "For satellite heat detection use the Active fires (FIRMS) layer instead — the two answer different questions.",
    ],
  },
  {
    id: "volcanoes",
    whatItShows: "A volcano with an alert raised now: USGS colour code and alert level, JMA eruption alert level 2 or above, or a GDACS eruption alert. Grey pins are NASA EONET's list of continuing eruptions, dated when listed.",
    method: "Read from the observatories themselves: the USGS Volcano Hazards Program, the Japan Meteorological Agency, and GDACS alerts triggered by volcanic-ash advisories.",
    confidence: "official",
    coverage: "US and Japanese volcanoes from their own observatories; elsewhere, eruptions that drew an ash advisory in the last 90 days.",
    limitations: [
      "An alert level is the observatory's judgement of unrest, not a measure of an eruption's size.",
      "Most of the world's volcanoes are not monitored continuously; absence here says nothing about quiescence.",
      "A grey EONET pin is a listing, not a current alert: that list has not been updated since June 2026.",
    ],
  },
  {
    id: "floods",
    whatItShows: "A flood: a GDACS flood event, a US flood warning (its polygon), a US river gauge in flood, or a Copernicus EMS mapping activation.",
    method: "GDACS flood events are detected by the GloFAS flood model; NWS warnings and gauge readings come from the US National Weather Service.",
    confidence: "official",
    coverage: "Global over the last 60 days from GDACS; the United States in more detail, live.",
    limitations: [
      "A GDACS point is the centre of an affected area, not the water's edge.",
      "GDACS events come from a model, and reporting lags the water, sometimes by days.",
      "Urban and flash flooding outside the US is systematically under-represented.",
    ],
  },
  {
    id: "severeStorms",
    whatItShows: "A tropical cyclone tracked by NASA EONET (from JTWC and NHC), a US tornado, wind or hail report, or a US tornado or severe-thunderstorm warning.",
    method: "Cyclone positions are relayed by EONET from the warning centres. Storm reports come from the NOAA Storm Prediction Center; warnings from the National Weather Service.",
    confidence: "official",
    coverage: "Tropical cyclones worldwide; tornado, wind and hail reports and warnings for the United States only.",
    limitations: [
      "A cyclone point is the system's reported position, not its footprint or its forecast track. For cyclone detail use the NHC layer.",
      "A storm report is what a spotter or the public reported, checked later; early reports can be wrong or duplicated.",
      "Outside the US there are no tornado, wind or hail reports here.",
    ],
  },
  {
    id: "gdacs",
    whatItShows: "A disaster alert issued by GDACS, the UN OCHA / European Commission global alert system, with its own green/orange/red severity.",
    method: "GDACS models expected humanitarian impact from hazard magnitude plus exposed population and vulnerability. The colour is theirs.",
    confidence: "modelled",
    coverage: "Global, for the hazard types GDACS covers (quake, cyclone, flood, volcano, drought, wildfire). Only events GDACS still marks as current are shown.",
    limitations: [
      "The alert level is a MODELLED estimate of likely impact issued within minutes — it is designed to trigger a response, not to describe what happened. Early alerts are frequently revised.",
      "Most rows on a normal day are Green wildfire notifications, which are numerous and small; the Orange and Red alerts are the ones GDACS expects to need a response.",
      "Green does not mean nobody was harmed. It means the modelled impact fell below a threshold.",
      "Conflict, displacement and slow-onset crises are out of scope.",
    ],
  },
  {
    id: "tropical-cyclones",
    whatItShows: "An active tropical cyclone at its current centre, from NOAA's National Hurricane Center (Atlantic, East and Central Pacific) or the Joint Typhoon Warning Center (every other basin). NHC's storms also carry their 5-day forecast cone, and NHC's outlook areas show where a storm may form.",
    method: "Reported directly by NHC advisories and JTWC warnings, both on 1-minute sustained winds, which is what the Saffir-Simpson colours assume. In the West Pacific, JMA's (10-minute) and CMA's (2-minute) readings of the same storm are added as labelled fields, never used for the colour.",
    confidence: "official",
    coverage: "Every basin: NHC for the Atlantic and the East and Central Pacific, JTWC for the West Pacific, the North Indian Ocean and the Southern Hemisphere. Cones and outlook areas exist for NHC's basins only.",
    limitations: [
      "Outside NHC's basins the warning centre is JTWC, a US military centre, not the regional WMO centre (JMA, IMD, Météo-France, Fiji, BoM). Their intensities can differ from JTWC's, partly because most of them average wind over 10 minutes.",
      "A JTWC warning is issued every 6 hours, so a West Pacific position can be up to 6 hours old.",
      "The cone is where the CENTRE is likely to track (two-thirds of past forecast errors), not the size of the storm: damage often reaches well outside it.",
      "Outside the seasons this layer is legitimately empty for weeks.",
    ],
  },
  {
    id: "cyclone-forecasts",
    whatItShows: "Two NHC forecasts: the 5-day forecast cone of each active Atlantic or Pacific storm, and the outlook areas where NHC expects a storm may form, with its 2-day and 7-day chances.",
    method: "Read directly from NHC's KMZ products for the current advisory and the current Tropical Weather Outlook. Nothing is recomputed.",
    confidence: "modelled",
    coverage: "NHC's basins only: the Atlantic and the East and Central Pacific. No cone or outlook is drawn for West Pacific, Indian Ocean or Southern Hemisphere storms.",
    limitations: [
      "The cone is where the storm's CENTRE is likely to go: it is sized so that two-thirds of NHC's past forecast errors fall inside it. Rain, surge and wind often reach far outside it.",
      "An outlook area is a chance that a storm forms, not a storm. Most low-chance areas never become one.",
      "The cone follows the last full advisory; an intermediate advisory can move the storm before the cone is redrawn.",
    ],
  },
  {
    id: "tsunami-alerts",
    whatItShows: "The latest bulletin of each NOAA Tsunami Warning Center (Pacific in Honolulu, National in Palmer), pinned at the earthquake it is about: a warning, advisory, watch, threat message or information statement.",
    method: "Read directly from each centre's Atom feed. The category and the note are the centre's own words. A bulletin stays on the map for 24 hours after it was issued.",
    confidence: "official",
    coverage: "The areas the two NOAA centres warn for: the US and Canadian coasts, Hawaii, the US Pacific territories and the Caribbean, and the Pacific basin for international information.",
    limitations: [
      "The pin is the earthquake, not the coast at risk: a warning covers coasts that can be thousands of kilometres away. Read the bulletin for which.",
      "An information statement usually means NO tsunami threat. It is shown because it says a large quake was assessed, not because a wave is coming.",
      "Other countries' warning centres (Japan, Indonesia, Chile, Australia and others) are not read here; for their own coasts, theirs are the official messages.",
    ],
  },
  {
    id: "volcano-alerts",
    whatItShows: "A volcano whose observatory has raised its alert above normal: the US volcanoes (USGS) with their ground-hazard level and aviation colour, and Japan's (JMA) with their Volcanic Alert Level or warning.",
    method: "Read directly from USGS HANS (the elevated-volcano list) and JMA's eruption warnings in force. The level is the observatory's own; JMA's Japanese wording is translated by a fixed table and kept beside the translation.",
    confidence: "official",
    coverage: "Volcanoes monitored by the US observatories (Alaska, Cascades, Hawaii, California, Yellowstone, the Northern Mariana Islands) and by JMA. Not global: Indonesia, the Philippines, Italy, Iceland and Latin America are not read.",
    limitations: [
      "USGS and JMA use different scales, and neither is comparable with the other: WATCH is not Level 3.",
      "A raised level is a statement about unrest or eruption risk, not that an eruption is happening.",
      "Most of the world's active volcanoes are outside the two networks read here, so a quiet map elsewhere means nothing.",
    ],
  },
  {
    id: "cems-activations",
    whatItShows: "A Copernicus Emergency Management Service rapid-mapping activation: a request by a national authority or an EU or UN body for satellite maps of one disaster, pinned at the centre of its mapped areas.",
    method: "Read directly from the Copernicus EMS Rapid Mapping public list. Open activations are all shown; closed ones for 30 days after they were activated.",
    confidence: "official",
    coverage: "Global, wherever an authorised user activated the service. Most activations are in Europe.",
    limitations: [
      "An activation means maps were requested, not how severe the disaster is: many large disasters are never activated, and some small ones are.",
      "The pin is the centre of the mapped areas, which can be far apart; open the activation for its maps.",
      "Maps arrive hours to days after the activation; 'open' means the work is under way.",
    ],
  },
  {
    id: "weather-warnings",
    whatItShows: "An official weather alert in force from the US National Weather Service or Environment and Climate Change Canada: a warning, watch, advisory or statement for a stated area.",
    method: "Read directly from the NWS active-alerts API and ECCC's weather-alerts service. The event, severity and area text are theirs. An NWS alert with its own polygon is drawn as that polygon; a Severe or Extreme NWS alert that names counties but has no polygon is placed at the centre of those counties.",
    confidence: "official",
    coverage: "The United States and Canada only. Europe (MeteoAlarm) and India (SACHET) are not read yet.",
    limitations: [
      "Most NWS alerts name forecast zones and carry no polygon. Those rated Minor or Moderate are not drawn, and Severe or Extreme ones are a disc at the centre of their counties, not their real outline.",
      "Marine alerts name no county and are drawn only when NWS gives a polygon.",
      "Severity is each service's own scale, and the two services do not use the same words: compare within a country, not across the border.",
    ],
  },
  {
    id: "fire-active",
    whatItShows: "A thermal anomaly detected from orbit by NASA FIRMS (VIIRS on three satellites, and MODIS), i.e. something on the ground was hot when a satellite passed over in the last 24 hours.",
    method: "Measured by satellite radiometer and flagged by NASA's detection algorithm.",
    confidence: "measured",
    coverage: "Global for the last 24 hours from four polar-orbiting satellites, which pass several times a day. Over Australasia and East Asia (Himawari-9), North America (GOES, each point checked by a NOAA analyst) and South America (GOES-19, via INPE) it also shows geostationary detections from the last 3 hours, scanned every 10 minutes.",
    limitations: [
      "It detects HEAT, not fire. Gas flares, industrial furnaces, volcanic vents and agricultural burning all appear as detections.",
      "Cloud cover hides fires completely. A gap in detections can be weather rather than an absence of fire.",
      "Between polar overpasses there is no observation at all, so outside the three geostationary regions timing is coarse.",
      "A geostationary pixel is about 2 km across, much coarser than VIIRS (375 m); INPE publishes no fire radiative power for its points.",
    ],
  },

  // --- Space weather / space -----------------------------------------------
  {
    id: "aurora",
    whatItShows: "The modelled probability of visible aurora at a location, at the forecast time the grid states: typically 30 to 90 minutes ahead (61 to 65 minutes on 2026-10-16).",
    method: "NOAA SWPC's OVATION model, driven by live solar-wind measurements, sampled onto a grid.",
    confidence: "modelled",
    coverage: "Global grid, meaningful mainly at high latitudes.",
    limitations: [
      "A probability of visibility, not an observation. High probability under thick cloud means you will see nothing.",
      "The model is a short-range nowcast. Its lead time is the solar wind's travel time from the L1 monitor to Earth, so it changes with the wind speed; beyond the stated forecast time it is not a forecast.",
      "OVATION's grid carries a weak artefact at the equator; cells within 20 degrees of the equator are not drawn.",
      "Daylight is not accounted for in the probability itself.",
    ],
  },
  {
    id: "space-weather",
    whatItShows: "Current space-weather conditions in one pin: the latest Kp (SWPC's 1-minute estimate, with the last official 3-hour block beside it), the NOAA G/R/S storm scales, the GOES X-ray flare class now and its 24-hour peak, the solar wind at L1, and the SWPC alerts and warnings issued in the last 24 hours or still valid.",
    method: "Kp is derived from a global network of magnetometers: the 1-minute value is SWPC's estimate, the 3-hour block is the official one. Flare classes come from the GOES-18 X-ray sensor, the solar wind from the DSCOVR/ACE monitors at L1, and alerts are issued by NOAA SWPC. GFZ Potsdam's Kp and its half-hourly Hp30 ride beside NOAA's numbers as an independent second reading.",
    confidence: "measured",
    coverage: "Planetary — a single global index, not a per-location value. The pin sits at the north geomagnetic pole as an anchor, not as a place where anything was measured.",
    limitations: [
      "Kp is a planetary index. Even the 1-minute estimate cannot tell you conditions at your location right now.",
      "A flare's radio blackout hits only the sunlit side of the Earth, and the 24-hour peak does not say whether it is still going on.",
      "The index is quantised in thirds and saturates at 9, so it compresses the most extreme events.",
      "It says nothing about which specific systems (HF radio, GNSS, power grids) are actually being affected.",
    ],
  },
  {
    id: "geomag-stations",
    whatItShows: "A magnetometer station and what it measured just now: Finnish Meteorological Institute stations show FMI's auroral-activity R-index with FMI's own verdict; USGS observatories show how far the horizontal magnetic field moved in the last hour.",
    method: "Measured by ground magnetometers. FMI's level compares the R-index with each station's own lower and higher limits. USGS publishes raw field values only, so Provenance takes the range of the horizontal field H over the last hour and calls it active at 100 nT and strong at 300 nT at the three Alaskan auroral-zone observatories, and at 40 and 120 nT elsewhere; the number is always shown beside the word.",
    confidence: "measured",
    coverage: "11 FMI stations in Finland and Estonia and 14 USGS observatories in Alaska, the contiguous US, Hawaii, Guam and Puerto Rico. Nothing in the southern hemisphere, Canada, the rest of Europe or Asia.",
    limitations: [
      "A disturbance at a station is not a sighting. Cloud, daylight and light pollution decide whether anyone there sees an aurora.",
      "The USGS levels are this project's rule, not the USGS's; a 40 nT hour means more at Tucson than at College.",
      "FMI's R-index and the USGS hourly range are different measures, so the two networks' numbers cannot be compared with each other.",
      "A station that stops reporting disappears from the map; its absence is not a quiet reading.",
    ],
  },
  {
    id: "launches",
    whatItShows: "A scheduled orbital rocket launch, at its launch site, with a countdown.",
    method: "Reported by The Space Devs' Launch Library, which aggregates operator and range announcements.",
    confidence: "reported",
    coverage: "Global orbital launches. Suborbital and most classified launches are not covered.",
    limitations: [
      "Launch dates slip constantly — weather, range conflicts, technical holds. A time here is an intention, not a commitment.",
      "Many entries carry only a day, a month, a quarter or a year. Those show as \"NET Oct 2026\" with no countdown and stay out of \"Next 24h\"; the time stamp in an export is Launch Library's placeholder for that date class.",
      "The pin is the launch site, not the trajectory or the payload's destination.",
    ],
  },

  // --- Infrastructure -------------------------------------------------------
  {
    id: "cables",
    whatItShows: "The route of a submarine telecommunications cable.",
    method: "Curated by TeleGeography from operator disclosures.",
    confidence: "reported",
    coverage: "Global commercial cable systems.",
    limitations: [
      "Routes are SCHEMATIC. The drawn line is indicative, not a surveyed position — real cables meander, and exact routes are commercially and militarily sensitive. For US and European waters the Charted cable routes layer shows the surveyed route.",
      "This is infrastructure, not status: the layer cannot tell you whether a cable is currently cut or carrying traffic.",
      "Capacity is shown only for the 9 US-international cables whose operators let the US FCC publish it (2024 data); every other cable says '—'.",
      "Military and some private cables are absent by design.",
    ],
  },
  {
    id: "cable-landings",
    whatItShows: "A landing station where submarine cables come ashore.",
    method: "Curated by TeleGeography from operator disclosures. Where OpenStreetMap maps exactly one landing-station building for that landing (within 30 km, matched by name or as the only one), the pin is moved onto the building and the town point is kept in the details.",
    confidence: "reported",
    coverage: "Global commercial cable systems.",
    limitations: [
      "Most positions still mark a landing point generalised to a town rather than the building: OpenStreetMap maps only 58 landing stations worldwide, and a town with several (Bude, Porthcurno) keeps its town pin and lists them.",
      "Static infrastructure — no operational status, no capacity, no current traffic.",
    ],
  },
  {
    id: "ukraineAlerts",
    whatItShows:
      "Which Ukrainian oblasts currently have an air-raid alert active. A warning to take shelter — not a report that anything was struck.",
    method:
      "Read directly from the oblast alert state alerts.com.ua publishes; the marker is placed on the oblast's main city because the feed carries no geometry.",
    confidence: "official",
    coverage:
      "All 25 regions Ukraine's alert system covers (24 oblasts plus Kyiv city). Nothing outside Ukraine, and no sub-oblast detail — an alert covers an area up to about 300 km across.",
    limitations: [
      "An alert is a warning, not an incident. Most alerts end with nothing happening at any given point inside the oblast, and the layer can never say where something landed.",
      "The dot marks the oblast's administrative centre, which is an anchor and not a location. Reading it as the place under threat is wrong by up to a few hundred kilometres.",
      "Occupied oblasts can sit in a permanently-alerted state — Luhansk has not cleared since October 2023 — so those are labelled as standing conditions rather than fresh warnings.",
      "This is a public mirror of the alert state, not the government's own API, which requires an issued key. It can lag or drop out, and a stale read would look like an all-clear; the layer serves its last-good reading rather than an empty map for that reason.",
    ],
  },
  {
    id: "cable-routes",
    whatItShows: "A submarine cable on the route a hydrographic or marine authority has charted: US waters from NOAA, and European waters from EMODnet's national sources.",
    method: "Read from NOAA's Submarine Cables layer (from NOAA charts and NASCA records) and EMODnet Human Activities' telecom cable routes (BSH, SHOM, Rijkswaterstaat, Spanish, UK and Maltese sources).",
    confidence: "official",
    coverage: "US waters and the European seas the EMODnet sources cover; nowhere else.",
    limitations: [
      "Regional only: outside US and European waters there is no charted route, and the Submarine cables layer's schematic route is all there is.",
      "Status is each publisher's own word and many rows have none; NOAA names only about a third of its charted cables, so most draw as 'Unnamed charted cables'.",
      "Revisions are slow: NOAA's layer was last edited in February 2025 and EMODnet's in June 2023, so a cable laid since then is missing here.",
    ],
  },
  {
    id: "gpsJamming",
    whatItShows: "An area where aircraft are reporting degraded GNSS reception, i.e. probable GPS jamming or spoofing.",
    method: "Derived from aircraft-reported navigation-accuracy values aggregated over a grid.",
    confidence: "derived",
    coverage: "Wherever ADS-B-equipped aircraft fly and are received — so busy air corridors, and effectively nothing over empty ocean or where there are no receivers.",
    limitations: [
      "This infers interference from aircraft behaviour; it does not detect a transmitter. Equipment faults and receiver coverage gaps produce the same signature.",
      "No aircraft overhead means no data, which is not the same as no jamming.",
      "It cannot distinguish jamming from spoofing, and it cannot locate the source.",
      "Two daily sources share this layer: GPSJAM worldwide (a percentage per cell) and, for Europe, EUROCONTROL's own interference map (a high or medium level, no percentage). A cell both show is drawn once, from GPSJAM.",
    ],
  },
  {
    id: "gpsJammingLive",
    whatItShows: "A grid cell where, over the last hour, a share of passing airliners reported degraded GPS accuracy: probable jamming or spoofing now, not yesterday.",
    method: "Computed by Provenance from live adsb.lol aircraft: each airborne aircraft's reported navigation accuracy (NACp below 7 counts as bad), counted per H3 resolution-3 cell (about 12,000 km², coarser than the daily layer's grid) with GPSJAM's (bad - 1) / total rule.",
    confidence: "derived",
    coverage: "Wherever mainline airliners fly within range of adsb.lol's volunteer receivers.",
    limitations: [
      "Only the mainline airliner types are asked for, so each cell holds far fewer aircraft than GPSJAM's daily grid and a single bad receiver moves the percentage more.",
      "The hour builds up in one server's memory, one snapshot every ten minutes; right after a restart the window is a single snapshot.",
      "No aircraft overhead means no data, which is not the same as no jamming. Equipment faults produce the same signature.",
    ],
  },
  {
    id: "gnss-notams",
    whatItShows: "An official warning (a NOTAM) that GPS/GNSS signals may be jammed, degraded or spoofed in an area, issued by a national air navigation service provider.",
    method: "The jamming, interference and spoofing NOTAMs in force, as collected by EUROCONTROL AUGUR. Each is drawn as the circle its own Q-line states: a centre and a radius in nautical miles.",
    confidence: "official",
    coverage: "Europe and its neighbours, as far as AUGUR collects NOTAMs; not worldwide.",
    limitations: [
      "A warning is not a measurement: it says interference may occur (a military exercise, a border area), not that it is happening now. Compare it with the GPS jamming layers.",
      "The circle is the NOTAM's coarse area of influence, often a whole flight information region, not the position of a jammer.",
    ],
  },
  {
    id: "nuclear",
    whatItShows: "A nuclear power station, as mapped by OpenStreetMap contributors, with its state of use from Wikidata (operating, shut down, under construction).",
    method: "Crowd-mapped in OSM and extracted by tag through QLever's OSM-planet index. Research reactors, military and fuel-cycle sites, duplicates and one vandalised row are removed by a reviewed list. The state of use is Wikidata's, joined by the plant's OSM wikidata tag.",
    confidence: "reported",
    coverage: "Global, with quality varying by how actively a region is mapped.",
    limitations: [
      "The state of use is Wikidata's statement, and more than half the plants have none. 'Not stated' does not mean the plant is running.",
      "A shut-down or unbuilt plant keeps its pin in grey; only plants that can generate are ranked by capacity.",
      "Live reactor output covers the US (NRC daily percent power), Great Britain (Elexon notified megawatts, a plan rather than a meter reading) and Ontario (IESO hourly megawatts). Everywhere else a plant has no live reading, which does not mean it is running.",
      "OSM tagging is inconsistent: some entries are whole sites, some individual reactors, so counts should not be treated as reactor counts.",
      "No safety status and no incident reporting.",
    ],
  },
  {
    id: "airports",
    whatItShows: "A major airport with scheduled airline service, from the OurAirports public-domain database, with its live weather category and, where a feed covers it, its ground stops, delay programmes and flight delays.",
    method: "OurAirports large airports with scheduled service. Live state is joined by airport code: NOAA's METAR and TAF caches (flight category and forecast), the FAA's national airspace status (US), Avinor's flight boards (Norway) and Hong Kong airport's flight information.",
    confidence: "reported",
    coverage: "Global for the directory and weather (about 80% of pins have a METAR); delay and stop status only for the US, Norway and Hong Kong.",
    limitations: [
      "A pin with no status badge means no feed covers that airport, not normal operations. Outside the US, Norway and Hong Kong there is no delay data at all.",
      "The flight category describes the weather at the airport (visibility and cloud base), not whether flights are operating.",
      "Avinor's delayed flag and Hong Kong's 15-minute rule are different definitions of 'delayed', so their counts do not compare.",
      "The 'major' cut-off is a size classification, so some busy regional fields are excluded.",
    ],
  },
  {
    id: "ports",
    whatItShows: "A major commercial seaport, from a curated list of large cargo and container ports.",
    method: "Curated from Wikipedia's List of busiest container ports (2023); the file order means nothing and no rank is shown. Each port carries official figures joined by its UN/LOCODE: UNCTAD's quarterly liner shipping connectivity index (the layer's measure), Eurostat's quarterly tonnage for EU ports and USACE's annual tonnage for US ports.",
    confidence: "reported",
    coverage: "The world's largest container and cargo ports — a top-N list, not every port.",
    limitations: [
      "A deliberately short curated list. Absence from this layer says nothing about a port's existence or importance: some top-70 ports (for example in Vietnam and Indonesia) are not on it.",
      "No congestion and no current vessel counts. The figures are quarterly or annual and up to a year old; each says its period.",
      "The connectivity index measures how well a port is linked into container liner networks, not how much cargo it handles: a big bulk or oil port can score low.",
      "Coordinates mark the port area, not a berth.",
    ],
  },
  {
    id: "internet-outages",
    whatItShows: "A country or region where IODA has detected a drop in internet connectivity that is still in progress, or ended within the last two hours (marked recovering).",
    method: "IODA (CAIDA / Georgia Tech) infers outages from independent signals: BGP routing withdrawals, active probing of address blocks, the Merit network telescope and Google traffic. We show only events that are still running or ended in the last two hours, and we drop a probing burst that starts in ten or more places in the same ten minutes unless another signal agrees at that place: that pattern is IODA's prober restarting, not an outage. Severity rises with the number of signals that agree.",
    confidence: "measured",
    coverage: "Global at country level, plus IODA's sub-national regions (Natural Earth admin-1, about 4,600 of them). A region mark is placed inside the region, not at the fault.",
    limitations: [
      "Detects reachability from the outside. A national shutdown and a major cable fault look similar; the cause is not in the data.",
      "Small or short outages fall below the detection threshold.",
      "Throttling — the internet being slow rather than absent — is largely invisible to it.",
      "Mobile-only and regional shutdowns are a known weak point: on 2026-10-16 IODA had nothing for cuts in Tigray and Khyber Pakhtunkhwa that other monitors reported.",
      "The burst filter can hide a real outage that starts at the same moment as a prober fault, when only probing saw it.",
      "With ISOC_PULSE_API_KEY set, the layer adds Internet Society Pulse's logged shutdowns: reported and checked by people, not measured, and refreshed daily at best. Pulse allows non-commercial use only.",
      "IODA's own severity score is unitless and unbounded, and its practical scale moves: on 2026-08-10 one country scored 5.8e10 while the next-worst scored 2.9e4. We rank and band it on a log scale and show a 0–10 magnitude rather than the raw number, because the raw number is not comparable between countries or between weeks.",
    ],
  },
  {
    id: "cloud-status",
    whatItShows: "A cloud or platform incident that the vendor's OWN status page reports right now — AWS, Google Cloud, Azure, Oracle Cloud, Fastly, Cloudflare, GitHub, Akamai and others — pinned at the region or point of presence the vendor names.",
    method: "Read straight from each vendor's own status feed: Atlassian Statuspage summaries for sixteen pages, AWS's public current-events feed, Google Cloud's and Google Workspace's incident lists, Azure's status RSS, Oracle's region health and Fastly's status RSS. The severity is the vendor's own, not our judgement. The place is the one the vendor names: a PoP by its airport code, a cloud region by its id or name.",
    confidence: "official",
    coverage: "Twenty-two status feeds from cloud, CDN and developer platforms. Region placement covers AWS, Google Cloud, Azure and Oracle regions, and PoP placement covers Cloudflare and Fastly by airport code or city.",
    limitations: [
      "An incident that names no place is pinned at the vendor's HEADQUARTERS, and that pin says so: it is not where the outage is.",
      "A PoP or region pin marks the metro area the vendor names, not a data centre.",
      "It is the vendor's self-assessment. Status pages are routinely slow to go red, and some incidents are never posted at all.",
      "Some incidents stay open for months (two AWS Middle East regions since March 2026, a Cloudflare WARP issue since August 2026). They are shown with the date they opened, so read 'open since' before reading them as news.",
      "An empty layer is the normal, healthy state: only non-operational services appear. Absence here is not proof that everything works.",
    ],
  },
  {
    id: "grid-load",
    whatItShows: "The latest electricity demand (MW) in one grid area: a bidding zone, a US balancing authority or an Australian market region.",
    method: "Published by the operators themselves: Elexon (GB), RTE (France), Energinet (Denmark), AEMO (Australia), EIA-930 (US, with EIA_API_KEY) and ENTSO-E's Transparency Platform (continental Europe, with ENTSOE_API_TOKEN). Where an operator publishes its own area, that reading replaces ENTSO-E's copy. Denmark's figure is derived: production plus net imports.",
    confidence: "official",
    coverage: "Great Britain, France, Denmark and Australia with no key; continental Europe and about 50 US balancing authorities when their free keys are set. Not global.",
    limitations: [
      "No open live feed was found for most of Asia, Africa and South America, so an empty map there is coverage, not calm.",
      "Readings are from the operator's last interval: five minutes for GB, Denmark and Australia, fifteen for France, about an hour for EIA and ENTSO-E. A reading older than six hours is not shown.",
      "TSO and EIA submissions are revised after the fact; recent values are provisional.",
      "Load only. GB's pin also carries NESO's generation mix, but no other area shows generation.",
      "Grid areas are market or utility areas, not countries, and do not line up with borders.",
    ],
  },

  // --- Intel / conflict -----------------------------------------------------
  {
    id: "news-coverage",
    whatItShows: "A place that stories pushed by the NewsScraper host were read as being about, with the outlets carrying them and the newest headline. One pin per place, not per story, so five outlets covering one earthquake read as corroboration rather than as five events.",
    method: "The scraper fetches each outlet's front pages hourly and a language model reads a place name, a category and the sentence it took them from out of the article body. This app geocodes that NAME through Photon (OpenStreetMap) and refuses any match whose own label does not mention the country the article named. Stories sharing a coordinate to 2 decimal places (≈1.1 km) become one pin.",
    confidence: "modelled",
    coverage: "Whatever the scraper reads: Reuters, BBC, The Guardian, PBS NewsHour and The New York Times. World and top-news sections, not full archives. Empty until the host pushes, and empty again after this app restarts.",
    limitations: [
      "The place is a MODEL'S READING of an article, not a verified location. Nothing here checked that the event happened, that it happened there, or that the model read the right sentence. The sentence it used is published on the pin so you can judge it yourself.",
      "The geocoder is a second guess on top of the first. It matches a name, and names repeat: the country check catches a Springfield in the wrong country and cannot catch one in the right country. What it matched is published as `resolvedTo` — where that disagrees with what the article said, trust neither.",
      "This is COVERAGE, and coverage follows newsrooms. Five English-language outlets decide what is on this map, so an unreported event is absent and a heavily-covered one is prominent. Absence of a pin is not absence of the thing.",
      "The story count is attention, not severity. A royal visit and a massacre both count one story per outlet.",
      "A story with no place, or one the geocoder refused, is not dropped from the news feed — it simply does not appear here. The map is a subset of the rail, never the whole of it.",
      "Categories come from the model and are shown as what it coded, never as a finding.",
      "The two ways this is known to go wrong are not geocoding faults, so a correct coordinate does not rule them out: a line saying where someone SPOKE TO A REPORTER read as the place the event happened, and a SCHEDULED hearing read as one that already has. Each ran at roughly 1% to 1.5% of pinnable stories in the scraper's own review.",
      "Pins are OFF until a labelled sample passes an accuracy gate, so an empty layer here usually means nobody has measured it yet rather than that the world is quiet.",
      "Place names are resolved at most 12 per cycle to stay a good guest on a community geocoder, so after a backfill the map fills in over several hours rather than at once.",
    ],
  },
  {
    id: "headline-places",
    whatItShows:
      "Which places the current World Headlines stream NAMES, and the headlines that name them. One pin per place, not per story, so six outlets writing about one summit read as corroboration rather than as six events.",
    method:
      "Every headline in the merged feed is scanned for place names from two tables committed to this repo — country centroids and the ~50-city list the weather layers use. Matching is literal and deterministic: word boundaries only, longest name first (so “South Africa” beats “Africa” and “Nigeria” beats “Niger”), short forms such as US and UK matched case-sensitively, and no demonyms. Where a headline names a city and that city’s own country, only the city is kept. No model reads anything and no geocoder is called.",
    confidence: "measured",
    coverage:
      "The same 29 world RSS feeds and one Telegram channel the World Headlines rail serves, plus anything the NewsScraper host has pushed. Only places in the two committed tables can be matched, so a town is invisible unless its country is named too.",
    limitations: [
      "THE CLAIM IS ONLY THAT THE HEADLINE CONTAINS THE NAME. Not that anything happened there, not that the story is about there. “US sanctions Iran” names two countries and locates nothing; both get a pin, and neither pin means an event.",
      "A country pin sits on a centroid, which is a label anchor for the whole country and not a location. A pin in the middle of Kazakhstan means Kazakhstan was named, not that anything is at that point.",
      "The gazetteer is small on purpose — about 250 countries and 50 cities. A headline about Bayeux or Bakhmut pins nothing at all unless it also names France or Ukraine, so an empty region means nobody wrote a matchable name, not that nothing happened there.",
      "Names that are also common words or personal names are dropped rather than guessed at: Georgia (the US state), Jordan, Chad and Guinea never pin. That loses real stories about those countries, which is the trade made deliberately — a wrong pin is on the map and a missing one is not.",
      "Headline counts are attention, not severity. A royal visit and a massacre both count one headline per outlet.",
      "This is coverage, and coverage follows newsrooms. Thirty mostly English-language sources decide what is on this map, so an unreported event is absent and a heavily covered one is prominent.",
      "Every pin publishes the headlines behind it. If a match looks wrong, it is wrong — read the headline on the card and judge it, which is the one thing this layer is built to let you do.",
    ],
  },
  {
    id: "conflict",
    whatItShows: "How much conflict-coded news reporting mentions each COUNTRY — GDELT's machine coder tagged articles as assault, armed clash or mass violence and filed them in the last four hours. It is a map of reporting volume, not of confirmed incidents, and the marker sits on a national centroid.",
    method: "GDELT codes global news into CAMEO event records, each with an action location. We keep roots 18/19/20 at QuadClass 4 (material conflict), require at least two source documents AND at least one TYPED actor, collapse GDELT's repeated actor-pair rows, then total the remaining articles PER COUNTRY. The dot is sized by that total.",
    confidence: "modelled",
    coverage: "Global, but strongly shaped by which languages and outlets GDELT ingests.",
    limitations: [
      "This layer counts REPORTING, not incidents, and it is aggregated to the country on purpose. GDELT's machine coding is accurate enough in bulk and unreliable per record: audited against their source articles, most individual city-level codings turned out to be court reporting about past events, metaphor, or unrelated news. Aggregating to the country is the scale at which the signal is real.",
      "Individual CAMEO labels are shown only as the best-covered coding in that country, attributed to GDELT, never as a finding. A country total says nothing about where inside it anything happened.",
      "Ranking is MEDIA ATTENTION, not severity. A heavily-covered country outweighs an unreported massacre, and a viral non-event contributes just as much as a real battle.",
      "The United States dominates this layer by roughly an order of magnitude — on a typical window it carries more conflict-coded articles than every other country combined. That is GDELT's English-language and US-outlet skew, not a finding about the world. Read the ranking BELOW the top entry.",
      "The four-hour window is when GDELT FILED the records, not when anything happened. Each marker shows the best-covered event's own date, which carries day resolution at best and is sometimes years older.",
      "The marker sits on a national centroid, which is usually empty land. It is a country statistic drawn as a dot, not a location.",
      "Coverage follows press freedom and internet access, so the quietest countries on this layer are often the least covered.",
      "For adjudicated, located incident records you need a curated dataset such as ACLED, which this app no longer carries. This layer cannot substitute for one.",
    ],
  },
  {
    id: "protests",
    whatItShows: "How much protest-coded reporting mentions each COUNTRY — GDELT tagged articles as a demonstration, strike, blockade or riot and filed them in the last four hours.",
    method: "As with the conflict layer, but keeping CAMEO root 14 (protest). Most of that branch is coded QuadClass 3, so no material-conflict filter is applied to it. The typed-actor requirement and the per-country aggregation both apply here too.",
    confidence: "modelled",
    coverage: "Global, shaped by GDELT's source and language mix.",
    limitations: [
      "Media attention, not turnout. There is no crowd size and no verification here.",
      "Machine coding misfires at least as often as on the conflict layer — an emergency-restrictions notice has been coded as a blockade, and a quarterly earnings release as a rally. That is exactly why this is a country total rather than a pin.",
      "Article volume drives the ranking, so one heavily-covered protest outranks several larger but ignored ones.",
      "The four-hour window is GDELT's filing time, not the protest's. The marker also carries the best-covered event's own date.",
      "The marker sits on a national centroid. It says nothing about where in the country anything happened.",
    ],
  },
  {
    id: "military-air",
    whatItShows: "An aircraft currently broadcasting ADS-B that community trackers classify as military.",
    // Two different claims live in one pin, and they do NOT share a provenance.
    // The POSITION is measured (the aircraft's own transponder). The MILITARY
    // CLASSIFICATION — which is the only reason this layer exists, and the whole
    // content of the label "Military flights" — is inherited wholesale from a
    // community-maintained hex-range list. Grading the layer `measured` borrowed
    // the transponder's credibility for somebody else's judgement call, which is
    // exactly the "every Dash 8 marked military" complaint users report. Per this
    // file's own house rule, `confidence` describes the DATA's provenance, and the
    // datum here is "this is military", not "an aircraft is at this lat/lon".
    method: "Two community receiver networks, adsb.lol and adsb.fi, are asked every cycle and joined by the aircraft's ICAO address; where both saw an aircraft, the fresher position is drawn and the dossier says which networks saw it. The position is measured from the aircraft's own transponder. The military classification is not ours and is not measured: it is inherited unchanged from community-maintained registration lists, and we render their call as they made it.",
    confidence: "reported",
    coverage: "Wherever volunteer ADS-B receivers listen — good over Europe and North America, poor over oceans, deserts and much of Africa and Asia. On 2026-10-16 about 85% of the aircraft shown were over North America, most of them US forces; the Middle East, Ukraine and Russia, and the Taiwan Strait were almost empty.",
    limitations: [
      "Aircraft on sensitive missions routinely switch their transponder off or broadcast a false identity. This layer shows what is willing to be seen, so a near-empty conflict zone means transponders are off, not that nothing is flying.",
      "The flag covers state aircraft, not only armed forces: government and royal VIP jets, US forces' civil-registered aircraft and aero clubs, contract trainers and civil-protection tankers carry it too. Where the network's database names an owner, the dossier shows it.",
      "Classification is community-maintained and imperfect: government, contractor and test aircraft are inconsistently labelled.",
      "Gaps are receiver coverage, not empty sky.",
    ],
  },

  {
    id: "gliders",
    whatItShows: "A glider, paraglider, hang glider, tow plane, helicopter, balloon or drone whose FLARM or OGN tracker was heard in the last ten minutes.",
    method: "Read from the Open Glider Network's live map feed: volunteer receivers hear the trackers' own position broadcasts. ADS-B traffic that OGN also relays is left out, because the planes layer draws it. A device whose owner chose not to be tracked in OGN's device database is dropped, and one whose owner chose not to be identified shows no registration.",
    confidence: "measured",
    coverage: "Where OGN receivers are: dense over the Alps and the rest of Europe, sparse in North America, Australia and South Africa, and almost absent elsewhere. Gliding is a daytime, fair-weather activity, so the layer is near empty at night and in winter.",
    limitations: [
      "Gaps are receiver coverage, not empty sky, and many light aircraft carry no tracker at all.",
      "A device OGN's database does not know shows a type but no registration, and when the database cannot be read, no device shows one.",
      "Aircraft types are what the pilot set on the tracker, so a type can be wrong.",
    ],
  },

  // --- Weather / environment -----------------------------------------------
  {
    id: "airquality",
    whatItShows: "Modelled air quality (CAMS / GEOS-CF) at a selected city.",
    method: "Global atmospheric-composition model output, interpolated to the point.",
    confidence: "modelled",
    coverage: "Global model field, sampled at our city list.",
    limitations: [
      "Modelled, not measured. Values can differ substantially from a nearby monitor, especially near roads and industry.",
      "Model grid cells are tens of kilometres across, so street-level pollution is invisible.",
      "For instrument readings use the OpenAQ stations layer.",
    ],
  },
  {
    id: "air-quality-stations",
    whatItShows: "A physical air-quality monitoring station and its latest reading.",
    method: "Measured by the instrument and published via OpenAQ.",
    confidence: "measured",
    coverage: "Wherever a government or community operator publishes to OpenAQ — dense in Europe and North America, sparse across much of the global south.",
    limitations: [
      "A station measures its own location. Readings do not extrapolate well even a few streets away.",
      "Instruments differ in type and calibration, from reference-grade analysers to low-cost sensors.",
      "Stations go offline; a missing pin usually means no data, not clean air.",
      "Requires an OpenAQ key. Without one this layer is empty, which looks identical to a region with no monitors.",
    ],
  },
  {
    id: "crime",
    whatItShows: "A street-level crime recorded by a UK police force.",
    method: "Published by data.police.uk from force records under the Open Government Licence.",
    confidence: "official",
    coverage: "England, Wales and Northern Ireland only. Not Scotland, and not anywhere else in the world.",
    limitations: [
      "UK only, and released MONTHLY — this is historical data, never live.",
      "Locations are deliberately snapped to anonymised map points, so a pin is approximate by design and never a specific address.",
      "It records reported crime. Under-reporting varies enormously by offence type.",
    ],
  },
  {
    id: "cyber-c2",
    whatItShows: "A server observed acting as botnet command-and-control infrastructure, placed by IP geolocation.",
    method: "Reported by abuse.ch Feodo Tracker from malware analysis and sinkholing.",
    confidence: "reported",
    coverage: "The malware families abuse.ch tracks — a slice of the threat landscape, not all of it.",
    limitations: [
      "The position comes from IP geolocation, which is routinely wrong at city level and can be wrong at country level. It is the hosting location, not the operator's location.",
      "Attribution is to infrastructure, not to a country or an actor.",
      "Servers are taken down and re-registered constantly, so the picture churns.",
    ],
  },
  {
    id: "cyber-ransomware",
    whatItShows: "An organisation named on a ransomware group's public leak site, placed at the victim's reported location.",
    method: "Scraped from leak sites and aggregated by Ransomware.live.",
    confidence: "reported",
    coverage: "Groups that operate public leak sites. Attacks that are quietly paid, or never claimed, are invisible.",
    limitations: [
      "This is the ATTACKERS' claim, self-published to apply pressure. Some claims are false, exaggerated, or recycled from older breaches.",
      "It shows victims who did NOT pay quickly — the ones who did are systematically absent, so this is a biased sample of ransomware, not a census.",
      "Victim locations come from company records and are often the registered HQ rather than where the attack landed.",
    ],
  },

  // --- Human cost -----------------------------------------------------------
  {
    id: "displacement",
    whatItShows: "Forced-displacement figures for a country, from UNHCR's Refugee Data Finder.",
    method: "Compiled by UNHCR from government and agency reporting.",
    confidence: "official",
    coverage: "Global, at country level only.",
    limitations: [
      "Annual figures with a long lag — typically a year or more behind. This is not a live crisis feed.",
      "Country-level totals cannot show where inside a country people are.",
      "Internal displacement, statelessness and irregular movement are counted inconsistently between states.",
    ],
  },
  {
    id: "reliefweb",
    whatItShows: "An active humanitarian emergency on ReliefWeb's (UN OCHA) disaster register, or an IFRC emergency appeal, placed on its country.",
    method: "ReliefWeb's own weekly export of its curated disaster list (ongoing and alert entries), plus IFRC GO appeals that have not ended. An appeal for the same country, type and month as a ReliefWeb entry is dropped as a duplicate; early-action appeals set aside before a hazard are left out.",
    confidence: "official",
    coverage: "Global, focused on situations with an active humanitarian response.",
    limitations: [
      "The ReliefWeb export is refreshed weekly, so a new disaster can be up to about seven days late there. IFRC appeals arrive the same day and cover part of that gap.",
      "A register entry, not an event at a point: the mark is the country, and an entry stays ongoing for as long as the response runs.",
      "Publication follows the humanitarian system's attention, which lags onset and fades before a crisis ends.",
      "Country-level geocoding; sub-national precision is inconsistent.",
    ],
  },

  // --- Maritime -------------------------------------------------------------
  {
    id: "ais",
    whatItShows: "A vessel broadcasting AIS near a monitored maritime chokepoint, heard in the last 20 minutes.",
    method: "Measured from the ship's own AIS transponder, relayed by AISStream (a long-lived stream), Fintraffic's Digitraffic (the Gulf of Finland) and, with its free client set, BarentsWatch (the Barents Sea). A ship two feeds hear is shown once, at its newest report.",
    confidence: "measured",
    coverage: "Eleven chokepoint boxes. AISStream's volunteer receivers cover the busy European waters well and Hormuz, the Red Sea, Panama, the Taiwan Strait and the Bosphorus thinly; Digitraffic covers the Gulf of Finland in full.",
    limitations: [
      "A sample, not a census: not all shipping, and not a full picture of any one strait. A strait with few receivers looks emptier than it is, so vessel counts here must not be read as traffic volume.",
      "AIS can be switched off or spoofed, which is exactly what sanctioned and illicit shipping does — so the vessels most worth seeing are the ones most likely to be missing.",
      "Terrestrial AIS reception is limited to roughly the coastal horizon; mid-ocean gaps are normal.",
      "For the first two minutes after a server restart the AISStream part is still filling, and says so.",
      "Requires an AISStream key for nine of the eleven boxes. Without one only the Gulf of Finland shows, which looks the same as quiet water everywhere else.",
    ],
  },
];

const BY_ID = new Map(EXPLAINERS.map((e) => [e.id, e]));

/** Every explainer, in declaration order. */
export function allExplainers(): LayerExplainer[] {
  return EXPLAINERS;
}

/**
 * The explainer for a layer.
 *
 * Deliberately returns `undefined` rather than a "not documented yet" placeholder:
 * a fallback string is how the competitor ended up shipping a trust feature that
 * is blank on 60% of their layers. The unit test guarantees every REGISTERED layer
 * has one, so undefined in practice means an unknown id.
 */
export function explainerFor(id: string): LayerExplainer | undefined {
  return BY_ID.get(id);
}

/** Registered layer ids with no explainer. The build fails when this is non-empty. */
export function undocumentedLayerIds(): string[] {
  return SIGNALS.map((s) => s.id).filter((id) => !BY_ID.has(id));
}

/** Explainer ids that no longer match a registered layer (a renamed or deleted source). */
export function orphanedExplainerIds(): string[] {
  const registered = new Set(SIGNALS.map((s) => s.id));
  return EXPLAINERS.map((e) => e.id).filter((id) => !registered.has(id));
}

const CONFIDENCE_TEXT: Record<Confidence, string> = {
  measured: "Measured by an instrument",
  official: "Stated by an official body",
  reported: "Reported and curated",
  modelled: "Produced by a model",
  derived: "Computed by us from other layers",
};

export function confidenceLabel(c: Confidence): string {
  return CONFIDENCE_TEXT[c];
}

/**
 * The one-word class, for a chip that has to sit inside a layer row.
 *
 * WHY A SECOND LABEL. `confidenceLabel` is a sentence fragment written for the
 * expanded trust card, where there is room to read. Until now that card was the
 * ONLY place provenance appeared, which meant a visitor had to open a panel per
 * layer to learn that one dot is a seismometer and the next is a machine reading
 * a news wire. Nobody does that in the five seconds they give an unfamiliar map,
 * so in practice every layer read as equally authoritative — the single defect
 * users actually report about products in this category. This is the same fact,
 * short enough to render everywhere the layer is listed.
 */
export function confidenceChip(c: Confidence): string {
  return c;
}
