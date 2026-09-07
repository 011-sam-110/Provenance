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
      "The score is only as complete as its inputs: with ACLED dormant the conflict factor is missing entirely, which caps every score well below 100. The factor count shown beside the score tells you how much of the formula actually ran.",
      "A low score means we found little signal, which is not the same as a country being stable.",
      "Weights are a judgement call, not a fitted model.",
    ],
  },

  // --- Natural hazards ------------------------------------------------------
  {
    id: "earthquakes",
    whatItShows: "An earthquake located by the USGS seismic network, sized by magnitude.",
    method: "Reported directly by USGS; magnitude and depth are theirs, unmodified.",
    confidence: "measured",
    coverage: "Global, but detection thresholds are far lower in densely instrumented regions (US, Japan, Europe) than in the open ocean.",
    limitations: [
      "Early magnitudes are automatic and get revised, sometimes by several tenths, in the hours after an event.",
      "A large magnitude in an unpopulated area matters less than a moderate one under a city — this layer shows the physics, not the impact.",
      "Small quakes in poorly instrumented regions are simply never recorded.",
    ],
  },
  {
    id: "emsc-quakes",
    whatItShows: "An earthquake located by EMSC-CSEM, the European-Mediterranean seismic network.",
    method: "Reported directly by EMSC; shown alongside USGS deliberately, because the two disagree.",
    confidence: "measured",
    coverage: "Global, with much denser coverage across Europe and the Mediterranean.",
    limitations: [
      "This layer overlaps USGS. The same earthquake appears twice, usually with slightly different magnitude, depth and epicentre — that disagreement is real and normal, not a bug.",
      "Early solutions are automatic and get revised.",
    ],
  },
  {
    id: "wildfires",
    whatItShows: "A wildfire event curated by NASA EONET from official incident reporting.",
    method: "Reported by EONET, which aggregates named events from agency sources.",
    confidence: "official",
    coverage: "Global, but weighted towards fires that an agency has formally named and reported.",
    limitations: [
      "EONET tracks named EVENTS, not burning pixels. A fire that no agency has declared will not appear here even while it burns.",
      "An event stays open until closed by the source, so a pin does not prove something is burning right now.",
      "For satellite heat detection use the Active fires (FIRMS) layer instead — the two answer different questions.",
    ],
  },
  {
    id: "volcanoes",
    whatItShows: "A volcano with activity currently reported by NASA EONET.",
    method: "Reported by EONET from observatory and agency sources.",
    confidence: "official",
    coverage: "Global, limited to volcanoes with an active reported event.",
    limitations: [
      "Presence means reported activity, not eruption. It carries no VEI, no plume height and no alert level.",
      "Most of the world's volcanoes are not monitored continuously; absence here says nothing about quiescence.",
    ],
  },
  {
    id: "floods",
    whatItShows: "A flood event curated by NASA EONET from agency reporting, pinned at the reported location.",
    method: "Reported by EONET from agency and media-verified sources.",
    confidence: "official",
    coverage: "Global, biased towards floods large enough to be formally reported.",
    limitations: [
      "A point marks an event, not the flooded area — there is no extent polygon here.",
      "Reporting lags the water, sometimes by days.",
      "Urban and flash flooding is systematically under-represented.",
    ],
  },
  {
    id: "severeStorms",
    whatItShows: "A severe storm system tracked by NASA EONET.",
    method: "Reported by EONET from meteorological agency sources.",
    confidence: "official",
    coverage: "Global, concentrated on named and tracked systems.",
    limitations: [
      "A point is the system's reported position, not its footprint or its forecast track.",
      "Intensity is not carried through, so a tropical depression and a major hurricane look alike here. For cyclone detail use the NHC layer.",
    ],
  },
  {
    id: "gdacs",
    whatItShows: "A disaster alert issued by GDACS, the UN OCHA / European Commission global alert system, with its own green/orange/red severity.",
    method: "GDACS models expected humanitarian impact from hazard magnitude plus exposed population and vulnerability. The colour is theirs.",
    confidence: "modelled",
    coverage: "Global, for the hazard types GDACS covers (quake, cyclone, flood, volcano, drought).",
    limitations: [
      "The alert level is a MODELLED estimate of likely impact issued within minutes — it is designed to trigger a response, not to describe what happened. Early alerts are frequently revised.",
      "Green does not mean nobody was harmed. It means the modelled impact fell below a threshold.",
      "Conflict, displacement and slow-onset crises are out of scope.",
    ],
  },
  {
    id: "tropical-cyclones",
    whatItShows: "An active tropical cyclone as reported by the NOAA National Hurricane Center.",
    method: "Reported directly by NHC advisories.",
    confidence: "official",
    coverage: "The Atlantic and Eastern Pacific basins — the NHC's area of responsibility. NOT global.",
    limitations: [
      "This is the single most misread layer on the map: an empty Western Pacific does NOT mean there are no typhoons. Those basins are the JTWC's and JMA's, and are not in this feed.",
      "A pin is the current centre position, not the forecast cone.",
      "Outside the northern-hemisphere season this layer is legitimately empty for months.",
    ],
  },
  {
    id: "fire-active",
    whatItShows: "A thermal anomaly detected from orbit by NASA FIRMS (VIIRS), i.e. something on the ground was hot when a satellite passed over.",
    method: "Measured by satellite radiometer and flagged by NASA's detection algorithm.",
    confidence: "measured",
    coverage: "Global, but sampled only on satellite overpasses — typically a few times per day per point.",
    limitations: [
      "It detects HEAT, not fire. Gas flares, industrial furnaces, volcanic vents and agricultural burning all appear as detections.",
      "Cloud cover hides fires completely. A gap in detections can be weather rather than an absence of fire.",
      "Between overpasses there is no observation at all, so timing is coarse.",
    ],
  },

  // --- Space weather / space -----------------------------------------------
  {
    id: "aurora",
    whatItShows: "The modelled probability of visible aurora at a location over the next ~30 minutes.",
    method: "NOAA SWPC's OVATION model, driven by live solar-wind measurements, sampled onto a grid.",
    confidence: "modelled",
    coverage: "Global grid, meaningful mainly at high latitudes.",
    limitations: [
      "A probability of visibility, not an observation. High probability under thick cloud means you will see nothing.",
      "The model is a short-range nowcast; beyond about half an hour it is not a forecast.",
      "Daylight is not accounted for in the probability itself.",
    ],
  },
  {
    id: "space-weather",
    whatItShows: "Current geomagnetic conditions — the planetary Kp index and any active NOAA storm alerts.",
    method: "Kp is derived from a global network of magnetometers; alerts are issued by NOAA SWPC.",
    confidence: "measured",
    coverage: "Planetary — a single global index, not a per-location value.",
    limitations: [
      "Kp is a 3-hourly planetary average. It cannot tell you conditions at your location right now.",
      "The index is quantised in thirds and saturates at 9, so it compresses the most extreme events.",
      "It says nothing about which specific systems (HF radio, GNSS, power grids) are actually being affected.",
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
      "Some entries carry only a date or a window, so a precise-looking countdown can be a placeholder.",
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
      "Routes are SCHEMATIC. The drawn line is indicative, not a surveyed position — real cables meander, and exact routes are commercially and militarily sensitive.",
      "This is infrastructure, not status: the layer cannot tell you whether a cable is currently cut or carrying traffic.",
      "Military and some private cables are absent by design.",
    ],
  },
  {
    id: "cable-landings",
    whatItShows: "A landing station where submarine cables come ashore.",
    method: "Curated by TeleGeography from operator disclosures.",
    confidence: "reported",
    coverage: "Global commercial cable systems.",
    limitations: [
      "The position marks a landing point, often generalised to a town rather than the building.",
      "Static infrastructure — no operational status, no capacity, no current traffic.",
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
    ],
  },
  {
    id: "nuclear",
    whatItShows: "A nuclear power station, as mapped by OpenStreetMap contributors.",
    method: "Crowd-mapped in OSM and extracted by tag.",
    confidence: "reported",
    coverage: "Global, with quality varying by how actively a region is mapped.",
    limitations: [
      "Static locations only. Nothing here indicates whether a plant is operating, shut down, decommissioned or under construction.",
      "OSM tagging is inconsistent: some entries are whole sites, some individual reactors, so counts should not be treated as reactor counts.",
      "No output, no safety status, no incident reporting.",
    ],
  },
  {
    id: "airports",
    whatItShows: "A major airport, from the OurAirports public-domain database.",
    method: "Community-maintained reference data, filtered to larger airports.",
    confidence: "reported",
    coverage: "Global.",
    limitations: [
      "Reference data, not operations: no delays, no closures, no ground stops, no runway status.",
      "The 'major' cut-off is a size classification, so some busy regional fields are excluded.",
      "Entries can lag real-world closures and openings.",
    ],
  },
  {
    id: "ports",
    whatItShows: "A major commercial seaport, from a curated list of the world's highest-throughput cargo and container ports.",
    method: "Curated from public busiest-port listings.",
    confidence: "reported",
    coverage: "The world's largest container and cargo ports — a top-N list, not every port.",
    limitations: [
      "A deliberately short curated list. Absence from this layer says nothing about a port's existence or importance.",
      "Static reference data: no congestion, no throughput, no current vessel counts.",
      "Coordinates mark the port area, not a berth.",
    ],
  },
  {
    id: "internet-outages",
    whatItShows: "A country or region where IODA has detected a drop in internet connectivity.",
    method: "IODA (CAIDA / Georgia Tech) infers outages from three independent signals: BGP routing withdrawals, unsolicited background traffic, and active probing.",
    confidence: "measured",
    coverage: "Global at country level; sub-national resolution varies a lot.",
    limitations: [
      "Detects reachability from the outside. A national shutdown and a major cable fault look similar; the cause is not in the data.",
      "Small or short outages fall below the detection threshold.",
      "Throttling — the internet being slow rather than absent — is largely invisible to it.",
      "IODA's own severity score is unitless and unbounded, and its practical scale moves: on 2026-08-10 one country scored 5.8e10 while the next-worst scored 2.9e4. We rank and band it on a log scale and show a 0–10 magnitude rather than the raw number, because the raw number is not comparable between countries or between weeks.",
    ],
  },
  {
    id: "cloud-status",
    whatItShows: "A cloud or developer platform that its OWN status page currently reports as degraded — GitHub, Cloudflare, OpenAI, Twilio and eleven others.",
    method: "Read straight from each vendor's Atlassian Statuspage summary endpoint. The severity is the vendor's own indicator, not our judgement.",
    confidence: "official",
    coverage: "Fourteen vendors that publish an Atlassian Statuspage. AWS, Google Cloud and Azure run their own bespoke formats and are NOT covered.",
    limitations: [
      "The pin sits at the vendor's HEADQUARTERS. A cloud outage has no location — this is a placement of convenience so the layer can exist on a map, and it must not be read as where the outage is.",
      "It is the vendor's self-assessment. Status pages are routinely slow to go red, and some incidents are never posted at all.",
      "An empty layer is the normal, healthy state: only non-operational vendors appear. Absence here is not proof that everything works.",
      "AWS, Google Cloud and Azure are the three biggest sources of internet-wide outages and none of them are in this feed.",
    ],
  },
  {
    id: "grid-load",
    whatItShows: "Electricity demand and generation for a European bidding zone.",
    method: "Published by ENTSO-E's Transparency Platform from transmission-system-operator submissions.",
    confidence: "official",
    coverage: "European ENTSO-E member zones only. Not global.",
    limitations: [
      "Europe only. There is no equivalent open feed for most of the world, so an empty map outside Europe is coverage, not calm.",
      "TSO submissions are revised after the fact; recent values are provisional.",
      "Bidding zones are market areas, not countries, and do not line up with borders.",
    ],
  },

  // --- Intel / conflict -----------------------------------------------------
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
      "For adjudicated, located incident records use the ACLED layer instead. This layer cannot substitute for it.",
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
    method: "The position is measured from the aircraft's own transponder. The military classification is not ours and is not measured: it is inherited unchanged from community-maintained registration lists, and we render their call as they made it.",
    confidence: "reported",
    coverage: "Wherever volunteer ADS-B receivers listen — good over Europe and North America, poor over oceans, deserts and much of Africa and Asia.",
    limitations: [
      "Aircraft on sensitive missions routinely switch their transponder off or broadcast a false identity. This layer shows what is willing to be seen.",
      "Classification is community-maintained and imperfect: government, contractor and test aircraft are inconsistently labelled.",
      "Gaps are receiver coverage, not empty sky.",
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
    whatItShows: "A humanitarian situation report or emergency published by UN OCHA's ReliefWeb.",
    method: "Editorially curated by ReliefWeb from agency and NGO reporting.",
    confidence: "official",
    coverage: "Global, focused on situations with an active humanitarian response.",
    limitations: [
      "A document, not an event. A pin marks that something was PUBLISHED about a place, not that something happened there today.",
      "Publication follows the humanitarian system's attention, which lags onset and fades before a crisis ends.",
      "Country-level geocoding; sub-national precision is inconsistent.",
    ],
  },

  // --- Maritime -------------------------------------------------------------
  {
    id: "ais",
    whatItShows: "A vessel broadcasting AIS near a monitored maritime chokepoint.",
    method: "Measured from the ship's own AIS transponder, relayed by AISStream.",
    confidence: "measured",
    coverage: "A sample near selected chokepoints — NOT all shipping, and not a full picture of any one strait.",
    limitations: [
      "A sample, not a census. Vessel counts here must not be read as traffic volume.",
      "AIS can be switched off or spoofed, which is exactly what sanctioned and illicit shipping does — so the vessels most worth seeing are the ones most likely to be missing.",
      "Terrestrial AIS reception is limited to roughly the coastal horizon; mid-ocean gaps are normal.",
      "Requires an AISStream key. Without one this layer is empty, which looks the same as a quiet strait.",
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
