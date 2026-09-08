/**
 * Stage B: operator portals that Provenance does NOT already read, to be asked whether
 * they publish live video.
 *
 * WHY THIS IS A LIST OF PORTAL ROOTS AND NOT A LIST OF API ENDPOINTS. Stage A asked
 * twelve known feeds at the exact endpoints their adapters use, which was right, because
 * the question was about feeds we already ingest. This stage has no adapter to copy an
 * endpoint from, and guessing API paths per operator is both unreliable and the kind of
 * thing that quietly turns a wrong guess into "this operator publishes no video". So the
 * sweep starts at the public portal a person would open and follows what the page itself
 * references — see scripts/liveness-sweep.mts. Anything found is therefore traceable to a
 * URL the operator actually serves to visitors.
 *
 * THE LEVEL-2 GAP THIS CLOSES. Stage A read page HTML but not the JavaScript those pages
 * load, and wrote that down as a known limit — DriveBC returned a 4 KB app shell, so its
 * zero was weaker than a portal that returned real content. Modern 511 sites put the
 * player configuration in a bundle, so HTML-only is close to useless here. The sweep
 * follows same-origin scripts and JSON one hop, which is where 511NY's answer was found:
 * myCameraTooltip.min.js contains no video handling of any kind, which is a much stronger
 * "stills only" than the homepage HTML could ever be.
 *
 * WHAT A ROW IS NOT. Presence here is a QUESTION, never a claim that the operator has
 * video, that the portal permits reuse, or that the feed should be ingested. Licensing is
 * decided per operator afterwards, by a person; a stream found here still has to clear the
 * operator-primary policy in docs/CAMERA_DISCOVERY.md, the bare-IP ban, and the rule that
 * we never forge a Referer past an access control. Several rows below are expected to be
 * refusals and are listed so the refusal is RECORDED rather than rediscovered.
 *
 * ALREADY ANSWERED, DELIBERATELY ABSENT: the four live feeds (caltrans, scdot, mup-rs,
 * putevi-rs) and the twelve Stage A measured (see lib/liveness/feeds.ts). Re-asking them
 * would spend requests on questions with written answers.
 */

export interface Candidate {
  /** Stable key for the sweep report. Not a registry key — nothing here is a feed yet. */
  key: string;
  label: string;
  /** ISO 3166-1 alpha-2, so a finding lands somewhere on the map. */
  country: string;
  region?: string;
  /**
   * Public pages to start from, most-likely-to-carry-a-player first. The sweep follows
   * same-origin assets these reference; it does not crawl the site.
   */
  roots: string[];
  /** Anything a reader needs in order to not misread this row's result. */
  note?: string;
}

/**
 * US state road authorities. Every domain below is the state's own public traveller
 * portal, which is what the operator-primary policy requires — no aggregators, and
 * notably no 511.org-style third-party rehosts.
 *
 * Three states carry a note because their answer is already partly known and the sweep
 * would otherwise look like it discovered something new.
 */
const US: Candidate[] = [
  { key: "al-algo", label: "ALGO Traffic (Alabama DOT)", country: "US", region: "Alabama", roots: ["https://algotraffic.com/"] },
  { key: "ak-511", label: "Alaska 511 (Alaska DOT&PF)", country: "US", region: "Alaska", roots: ["https://511.alaska.gov/"] },
  { key: "az-511", label: "AZ511 (Arizona DOT)", country: "US", region: "Arizona", roots: ["https://az511.com/"] },
  { key: "ar-idrive", label: "IDriveArkansas (ARDOT)", country: "US", region: "Arkansas", roots: ["https://www.idrivearkansas.com/"] },
  { key: "co-cotrip", label: "COtrip (Colorado DOT)", country: "US", region: "Colorado", roots: ["https://www.cotrip.org/"] },
  { key: "ct-roads", label: "CTroads (Connecticut DOT)", country: "US", region: "Connecticut", roots: ["https://ctroads.org/"] },
  { key: "de-deldot", label: "DelDOT Traffic (Delaware DOT)", country: "US", region: "Delaware", roots: ["https://deldot.gov/map/"] },
  { key: "ga-511", label: "511 Georgia (GDOT NaviGAtor)", country: "US", region: "Georgia", roots: ["https://511ga.org/"] },
  { key: "hi-akamai", label: "GoAkamai (Hawaii DOT)", country: "US", region: "Hawaii", roots: ["https://goakamai.org/"] },
  { key: "id-511", label: "Idaho 511 (ITD)", country: "US", region: "Idaho", roots: ["https://511.idaho.gov/"] },
  { key: "il-gettingaround", label: "Getting Around Illinois (IDOT)", country: "US", region: "Illinois", roots: ["https://www.gettingaroundillinois.com/"] },
  { key: "in-511", label: "INDOT TrafficWise", country: "US", region: "Indiana", roots: ["https://511in.org/"] },
  { key: "ia-511", label: "Iowa 511 (Iowa DOT)", country: "US", region: "Iowa", roots: ["https://511ia.org/"] },
  { key: "ks-kandrive", label: "KanDrive (Kansas DOT)", country: "US", region: "Kansas", roots: ["https://www.kandrive.gov/"] },
  { key: "ky-goky", label: "GoKY (Kentucky TC)", country: "US", region: "Kentucky", roots: ["https://goky.ky.gov/"] },
  { key: "la-511", label: "511LA (Louisiana DOTD)", country: "US", region: "Louisiana", roots: ["https://www.511la.org/"], note: "Louisiana DOTD is already a system inside the castlerock feed; a live stream here would be new even though the agency is not." },
  { key: "md-chart", label: "CHART (Maryland DOT SHA)", country: "US", region: "Maryland", roots: ["https://chart.maryland.gov/"] },
  { key: "ma-511", label: "Mass511 (MassDOT)", country: "US", region: "Massachusetts", roots: ["https://mass511.com/"] },
  { key: "mi-drive", label: "Mi Drive (Michigan DOT)", country: "US", region: "Michigan", roots: ["https://mdotjboss.state.mi.us/MiDrive/map"] },
  { key: "mn-511", label: "511MN (Minnesota DOT)", country: "US", region: "Minnesota", roots: ["https://511mn.org/"] },
  { key: "ms-mdot", label: "MDOT Traffic (Mississippi DOT)", country: "US", region: "Mississippi", roots: ["https://www.mdottraffic.com/"] },
  { key: "mo-modot", label: "MoDOT Traveler Information", country: "US", region: "Missouri", roots: ["https://traveler.modot.org/map/"] },
  { key: "ne-511", label: "Nebraska 511 (NDOT)", country: "US", region: "Nebraska", roots: ["https://511.nebraska.gov/"] },
  { key: "nv-roads", label: "NVRoads (Nevada DOT)", country: "US", region: "Nevada", roots: ["https://www.nvroads.com/"] },
  { key: "nj-511", label: "511NJ (NJDOT)", country: "US", region: "New Jersey", roots: ["https://www.511nj.org/"] },
  { key: "nm-roads", label: "NMRoads (New Mexico DOT)", country: "US", region: "New Mexico", roots: ["https://nmroads.com/"] },
  { key: "nc-drive", label: "DriveNC (NCDOT)", country: "US", region: "North Carolina", roots: ["https://drivenc.gov/"] },
  { key: "nd-travel", label: "ND Roads (North Dakota DOT)", country: "US", region: "North Dakota", roots: ["https://travel.dot.nd.gov/"] },
  { key: "oh-ohgo", label: "OHGO (Ohio DOT)", country: "US", region: "Ohio", roots: ["https://www.ohgo.com/"] },
  { key: "ok-traffic", label: "OK Traffic (Oklahoma DOT)", country: "US", region: "Oklahoma", roots: ["https://oktraffic.org/"] },
  { key: "pa-511", label: "511PA (PennDOT)", country: "US", region: "Pennsylvania", roots: ["https://www.511pa.com/"] },
  { key: "ne-newengland", label: "New England 511 (ME/NH/RI/VT)", country: "US", region: "New England", roots: ["https://newengland511.org/"], note: "One portal for four states; a hit here is four agencies, which also means the licence question is four questions." },
  { key: "tn-smartway", label: "SmartWay (Tennessee DOT)", country: "US", region: "Tennessee", roots: ["https://smartway.tn.gov/traffic"] },
  { key: "tx-drive", label: "DriveTexas (TxDOT)", country: "US", region: "Texas", roots: ["https://drivetexas.org/"] },
  { key: "ut-udot", label: "UDOT Traffic (Utah DOT)", country: "US", region: "Utah", roots: ["https://udottraffic.utah.gov/"] },
  { key: "va-511", label: "511Virginia (VDOT)", country: "US", region: "Virginia", roots: ["https://www.511virginia.org/"] },
  { key: "wa-wsdot", label: "WSDOT Traffic (Washington State DOT)", country: "US", region: "Washington", roots: ["https://wsdot.com/travel/real-time/map"] },
  { key: "wv-511", label: "WV511 (West Virginia DOT)", country: "US", region: "West Virginia", roots: ["https://www.wv511.org/"] },
  { key: "wi-511", label: "511WI (Wisconsin DOT)", country: "US", region: "Wisconsin", roots: ["https://511wi.gov/"] },
  { key: "wy-road", label: "WYDOT Travel Information", country: "US", region: "Wyoming", roots: ["https://www.wyoroad.info/"] },
];

/**
 * Non-US national and city road authorities.
 *
 * Chosen because each is the operator of its own network rather than a reseller, and
 * because between them they cover road authorities on five continents — a live find
 * outside North America is worth more to this product than another US state, since the
 * registry is already 11 countries and heavily US-weighted.
 */
const INTL: Candidate[] = [
  { key: "tw-freeway", label: "Freeway Bureau (Taiwan MOTC)", country: "TW", roots: ["https://1968.freeway.gov.tw/"], note: "Taiwan's freeway CCTV is widely served as MJPEG rather than HLS. MJPEG counts as live for this product PROVIDED it is operator-hosted, which is the whole reason the sweep classifies mjpeg as playable." },
  { key: "hk-td", label: "Transport Department (Hong Kong)", country: "HK", roots: ["https://www.td.gov.hk/en/special_news/trafficnews.htm"] },
  { key: "sg-lta", label: "LTA DataMall (Singapore)", country: "SG", roots: ["https://datamall.lta.gov.sg/content/datamall/en.html"], note: "Expected to need a key. Recorded so the refusal is written down." },
  { key: "ie-tii", label: "Transport Infrastructure Ireland", country: "IE", roots: ["https://www.tiitraffic.ie/"] },
  { key: "uk-ne", label: "National Highways (England)", country: "GB", roots: ["https://nationalhighways.co.uk/travel-updates/live-traffic-cameras/"] },
  { key: "pl-gddkia", label: "GDDKiA (Poland)", country: "PL", roots: ["https://www.gddkia.gov.pl/", "https://obserwatoriumbrd.pl/"] },
  { key: "cz-rsd", label: "Reditelstvi silnic a dalnic (Czechia)", country: "CZ", roots: ["https://www.dopravniinfo.cz/"] },
  { key: "at-asfinag", label: "ASFINAG (Austria)", country: "AT", roots: ["https://www.asfinag.at/verkehr-sicherheit/webcams/"] },
  { key: "ch-astra", label: "ASTRA / TCS (Switzerland)", country: "CH", roots: ["https://www.tcs.ch/de/tools/verkehrsinformationen/webcams.php"] },
  { key: "no-vegvesen", label: "Statens vegvesen (Norway)", country: "NO", roots: ["https://www.vegvesen.no/trafikkbeta/"] },
  { key: "se-trafikverket", label: "Trafikverket (Sweden)", country: "SE", roots: ["https://trafikinfo.trafikverket.se/"] },
  { key: "es-dgt", label: "DGT (Spain)", country: "ES", roots: ["https://infocar.dgt.es/etraffic/"] },
  { key: "pt-ip", label: "Infraestruturas de Portugal", country: "PT", roots: ["https://www.infraestruturasdeportugal.pt/pt-pt/rede-rodoviaria/camaras"] },
  { key: "gr-attica", label: "Attiki Odos (Greece)", country: "GR", roots: ["https://www.aodos.gr/"] },
  { key: "il-netivei", label: "Netivei Israel", country: "IL", roots: ["https://www.iroads.co.il/"] },
  { key: "za-sanral", label: "SANRAL i-Traffic (South Africa)", country: "ZA", roots: ["https://www.i-traffic.co.za/"] },
  { key: "au-nsw", label: "Transport for NSW (Australia)", country: "AU", region: "New South Wales", roots: ["https://www.livetraffic.com/"] },
  { key: "au-qld", label: "QLDTraffic (Australia)", country: "AU", region: "Queensland", roots: ["https://qldtraffic.qld.gov.au/"] },
  { key: "au-vic", label: "VicTraffic (Australia)", country: "AU", region: "Victoria", roots: ["https://traffic.vicroads.vic.gov.au/"] },
  { key: "cl-mop", label: "Ministerio de Obras Publicas (Chile)", country: "CL", roots: ["https://www.mop.cl/"] },
  { key: "ar-caba", label: "Buenos Aires city traffic cameras", country: "AR", roots: ["https://buenosaires.gob.ar/movilidad/camaras-de-transito"] },
  { key: "mx-cdmx", label: "CDMX C5 (Mexico City)", country: "MX", roots: ["https://www.c5.cdmx.gob.mx/"] },
  { key: "in-delhi", label: "Delhi Traffic Police", country: "IN", roots: ["https://traffic.delhipolice.gov.in/"], note: "Delhi is an outstanding coverage request; see the coverage-requests note. Listed so the answer is measured rather than assumed." },
  { key: "jp-mlit", label: "MLIT road cameras (Japan)", country: "JP", roots: ["https://www.mlit.go.jp/road/"] },
  { key: "kr-its", label: "ITS National Transport Information Center (Korea)", country: "KR", roots: ["https://www.its.go.kr/"], note: "Korea publishes CCTV through an open API that issues keys; a key-gated stream is a refusal for now, not a dead feed." },
];

export const CANDIDATES: readonly Candidate[] = [...US, ...INTL];

export function candidateByKey(key: string): Candidate | undefined {
  return CANDIDATES.find((c) => c.key === key);
}
