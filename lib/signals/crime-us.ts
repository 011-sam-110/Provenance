import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { capCrime } from "@/lib/signals/crime";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { readCoverage, withCoverage } from "@/lib/signals/coverage";

// US city crime — recorded incidents from the police departments' own open-data portals.
//
// WHY THIS LAYER EXISTS (audited 2026-10-16). The UK layer is monthly and 1.5 to 2.5
// months old by nature. Several US police departments publish incident-level records
// within a day, geocoded to the block, under an open licence. Eight passed the bar:
//
//   San Francisco PD   data.sfgov.org wg3w-h783        ODC PDDL
//   Seattle PD         cos-data.seattle.gov tazs-3rd5  public domain
//   Washington DC MPD  DC GIS MPD MapServer layer 39   CC BY 4.0
//   Montgomery Co. MD  data.montgomerycountymd.gov     public domain
//   Chicago PD         data.cityofchicago.org (crimes ijzp-q8t2, shootings gumc-mgzr)
//                      City of Chicago Data Terms of Use; the disclaimer rides on each row
//   Boston PD          data.boston.gov CKAN datastore  ODC PDDL
//   Kansas City MO PD  data.kcmo.org f7wj-ckmw         public domain
//
// Each is ONE request per refresh, for the last CRIME_US_DAYS days, newest first.
// Unlike the UK layer these rows are events with a time, so each feature has a `ts` and
// the time filter works on it. Personal fields some portals publish (race, sex, age,
// "involvement") are never requested.
//
// TIMES. The Socrata portals publish "floating" local times with no zone, so each is read
// in its city's own time zone. DC publishes epoch milliseconds. Boston says +00.

const UA = "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)";
/** Days of records asked for. Chicago's crimes table runs 7 days behind, so it gets twice this. */
export const CRIME_US_DAYS = 7;
/** Rows asked for from each provider. */
const PER_PROVIDER = 300;
/** Markers kept, shared equally across the cities (see capCrime). */
export const CRIME_US_CAP = 2000;

export const CHICAGO_DISCLAIMER =
  "This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one's own risk.";

export const CRIME_US_ATTRIBUTION =
  "Crime records: San Francisco PD (ODC PDDL) · Seattle PD (public domain) · DC MPD (CC BY 4.0) · Montgomery County MD PD (public domain) · Chicago PD (City of Chicago Data Terms) · Boston PD (ODC PDDL) · Kansas City MO PD (public domain)";

export type CrimeGroup = "person" | "property" | "society" | "other";

const GROUP_COLOR: Record<CrimeGroup, string> = {
  person: "#dc2626",
  property: "#ea580c",
  society: "#ca8a04",
  other: "#64748b",
};
const GROUP_LABEL: Record<CrimeGroup, string> = {
  person: "Crime against a person",
  property: "Crime against property",
  society: "Crime against society",
  other: "Other incident",
};

/** Pure: an offence name → its NIBRS-style group, by the words it uses. */
export function crimeGroup(offence: string): CrimeGroup {
  const o = offence.toUpperCase();
  if (/WEAPON(S)? LAW|WEAPONS? VIOLATION|DRUG|NARCOTIC|LIQUOR|GAMBL|PROSTITUT|DISORDERLY|\bDUI\b|DRIVING UNDER|PORNOGRAPH/.test(o)) return "society";
  if (/HOMICIDE|MURDER|MANSLAUGHTER|ASSAULT|BATTERY|ROBBERY|RAPE|SEX|KIDNAP|SHOOT|HUMAN TRAFFICK|INTIMIDAT|STALK|WEAPON/.test(o)) return "person";
  if (/THEFT|LARCENY|BURGLAR|STOLEN|ARSON|VANDAL|DAMAGE|SHOPLIFT|FRAUD|FORGER|EMBEZZL|TRESPASS|MOTOR VEHICLE|BREAKING|STEAL|EXTORTION|COUNTERFEIT/.test(o)) return "property";
  return "other";
}

/** Boston's table mixes service calls into its incidents; these are not crimes. */
const NOT_A_CRIME = /TOWED|SICK|ASSIST|INVESTIGATE|ACCIDENT|LOST|FOUND|MISSING|DEATH INVESTIGATION|SERVICE|VERBAL DISPUTE|LANDLORD|FIRE REPORT|PROPERTY - |AUTO (?:THEFT )?RECOVERY|WARRANT/;

/**
 * Pure: a zone-less local time ("2026-10-15T23:24:00.000") in `timeZone` → epoch ms.
 * Finds the zone's offset at that moment with Intl, so daylight saving is right.
 */
export function localToEpoch(local: string, timeZone: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) return undefined;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t));
    const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - t;
  };
  // Two passes settle the offset across a daylight-saving change.
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return Number.isFinite(t) ? t : undefined;
}

/** One normalised record before it becomes a feature. */
export interface CityCrime {
  id: string;
  city: string;
  offence: string;
  detail?: string;
  block?: string;
  lat: number;
  lon: number;
  /** Epoch ms of the occurrence. */
  at: number;
  agency: string;
  dataset: string;
  disclaimer?: string;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Pure: a point is usable when it is a real coordinate (portals send 0,0 for "unknown"). */
function placed(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

export interface Provider {
  key: string;
  city: string;
  agency: string;
  dataset: string;
  timeZone: string;
  /** The request for records since `sinceLocal` (YYYY-MM-DD in the city's zone). */
  url(sinceLocal: string): string;
  /** Pure: the response body → records. */
  read(body: unknown): CityCrime[];
}

const soql = (base: string, q: Record<string, string>) =>
  `${base}?${Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;

const rows = (body: unknown): Record<string, unknown>[] => (Array.isArray(body) ? (body as Record<string, unknown>[]) : []);

export const PROVIDERS: Provider[] = [
  {
    key: "sf",
    city: "San Francisco",
    agency: "San Francisco Police Department",
    dataset: "https://data.sfgov.org/d/wg3w-h783",
    timeZone: "America/Los_Angeles",
    // data.sfgov.org redirects here; asking the new host saves a slow redirect.
    url: (since) =>
      soql("https://data.sf.gov/resource/wg3w-h783.json", {
        $select: "row_id,incident_datetime,incident_category,incident_description,intersection,latitude,longitude",
        $where: `incident_datetime > '${since}T00:00:00' AND latitude IS NOT NULL`,
        $order: "incident_datetime DESC",
        $limit: String(PER_PROVIDER),
      }),
    read: (body) =>
      rows(body).map((r) => ({
        id: `sf:${str(r.row_id)}`,
        city: "San Francisco",
        offence: str(r.incident_category) || "Incident",
        detail: str(r.incident_description) || undefined,
        block: str(r.intersection).replace(/\s*\\\s*/g, " & ") || undefined,
        lat: num(r.latitude),
        lon: num(r.longitude),
        at: localToEpoch(str(r.incident_datetime), "America/Los_Angeles") ?? NaN,
        agency: "San Francisco Police Department",
        dataset: "https://data.sfgov.org/d/wg3w-h783",
      })),
  },
  {
    key: "seattle",
    city: "Seattle",
    agency: "Seattle Police Department",
    dataset: "https://cos-data.seattle.gov/d/tazs-3rd5",
    timeZone: "America/Los_Angeles",
    url: (since) =>
      soql("https://cos-data.seattle.gov/resource/tazs-3rd5.json", {
        $select: "offense_id,offense_date,offense_sub_category,nibrs_offense_code_description,nibrs_crime_against_category,block_address,latitude,longitude",
        $where: `offense_date > '${since}T00:00:00'`,
        $order: "offense_date DESC",
        $limit: String(PER_PROVIDER),
      }),
    read: (body) =>
      rows(body).map((r) => ({
        id: `seattle:${str(r.offense_id)}`,
        city: "Seattle",
        offence: str(r.nibrs_offense_code_description) || str(r.offense_sub_category) || "Offence",
        detail: str(r.nibrs_crime_against_category) ? `Against ${str(r.nibrs_crime_against_category).toLowerCase()}` : undefined,
        block: str(r.block_address) || undefined,
        lat: num(r.latitude),
        lon: num(r.longitude),
        at: localToEpoch(str(r.offense_date), "America/Los_Angeles") ?? NaN,
        agency: "Seattle Police Department",
        dataset: "https://cos-data.seattle.gov/d/tazs-3rd5",
      })),
  },
  {
    key: "dc",
    city: "Washington DC",
    agency: "Metropolitan Police Department",
    dataset: "https://opendata.dc.gov/datasets/crime-incidents-in-the-last-30-days",
    timeZone: "America/New_York",
    url: () =>
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39/query?where=1%3D1" +
      "&outFields=CCN,REPORT_DAT,START_DATE,OFFENSE,METHOD,BLOCK,LATITUDE,LONGITUDE" +
      `&orderByFields=REPORT_DAT%20DESC&resultRecordCount=${PER_PROVIDER}&f=json`,
    read: (body) => {
      const feats = (body as { features?: { attributes?: Record<string, unknown> }[] })?.features;
      if (!Array.isArray(feats)) return [];
      return feats.map(({ attributes: a = {} }) => ({
        id: `dc:${str(a.CCN)}`,
        city: "Washington DC",
        offence: str(a.OFFENSE) || "Offence",
        detail: str(a.METHOD) && str(a.METHOD) !== "OTHERS" ? `Method: ${str(a.METHOD).toLowerCase()}` : undefined,
        block: str(a.BLOCK) || undefined,
        lat: num(a.LATITUDE),
        lon: num(a.LONGITUDE),
        at: num(a.START_DATE) || num(a.REPORT_DAT),
        agency: "Metropolitan Police Department",
        dataset: "https://opendata.dc.gov/datasets/crime-incidents-in-the-last-30-days",
      }));
    },
  },
  {
    key: "montgomery",
    city: "Montgomery County MD",
    agency: "Montgomery County Police Department",
    dataset: "https://data.montgomerycountymd.gov/d/icn6-v9z3",
    timeZone: "America/New_York",
    url: (since) =>
      soql("https://data.montgomerycountymd.gov/resource/icn6-v9z3.json", {
        $select: "incident_id,start_date,crimename1,crimename2,crimename3,location,city,latitude,longitude",
        $where: `start_date > '${since}T00:00:00'`,
        $order: "start_date DESC",
        $limit: String(PER_PROVIDER),
      }),
    read: (body) =>
      rows(body).map((r) => ({
        id: `montgomery:${str(r.incident_id)}`,
        city: "Montgomery County MD",
        offence: str(r.crimename2) || str(r.crimename3) || "Offence",
        detail: str(r.crimename3) || undefined,
        block: [str(r.location).replace(/\s+/g, " "), str(r.city)].filter(Boolean).join(", ") || undefined,
        lat: num(r.latitude),
        lon: num(r.longitude),
        at: localToEpoch(str(r.start_date), "America/New_York") ?? NaN,
        agency: "Montgomery County Police Department",
        dataset: "https://data.montgomerycountymd.gov/d/icn6-v9z3",
      })),
  },
  {
    key: "chicago-shootings",
    city: "Chicago",
    agency: "Chicago Police Department",
    dataset: "https://data.cityofchicago.org/d/gumc-mgzr",
    timeZone: "America/Chicago",
    url: (since) =>
      soql("https://data.cityofchicago.org/resource/gumc-mgzr.json", {
        $select: "case_number,date,victimization_primary,gunshot_injury_i,block,latitude,longitude",
        $where: `date > '${since}T00:00:00' AND latitude IS NOT NULL`,
        $order: "date DESC",
        $limit: String(PER_PROVIDER),
      }),
    read: (body) =>
      rows(body).map((r) => ({
        // Same id scheme as the crimes table, so a case in both is one marker (this one).
        id: `chicago:${str(r.case_number)}`,
        city: "Chicago",
        offence: str(r.victimization_primary) === "HOMICIDE" ? "HOMICIDE" : str(r.gunshot_injury_i) === "YES" ? "SHOOTING" : str(r.victimization_primary) || "Violent crime",
        detail: str(r.gunshot_injury_i) === "YES" ? "Gunshot injury" : undefined,
        block: str(r.block) || undefined,
        lat: num(r.latitude),
        lon: num(r.longitude),
        at: localToEpoch(str(r.date), "America/Chicago") ?? NaN,
        agency: "Chicago Police Department",
        dataset: "https://data.cityofchicago.org/d/gumc-mgzr",
        disclaimer: CHICAGO_DISCLAIMER,
      })),
  },
  {
    key: "chicago",
    city: "Chicago",
    agency: "Chicago Police Department",
    dataset: "https://data.cityofchicago.org/d/ijzp-q8t2",
    timeZone: "America/Chicago",
    url: (since) => {
      // This table runs about seven days behind, so it is asked for twice the window.
      const d = new Date(Date.parse(`${since}T00:00:00Z`) - CRIME_US_DAYS * 86_400_000).toISOString().slice(0, 10);
      return soql("https://data.cityofchicago.org/resource/ijzp-q8t2.json", {
        $select: "case_number,date,primary_type,description,block,latitude,longitude",
        $where: `date > '${d}T00:00:00' AND latitude IS NOT NULL`,
        $order: "date DESC",
        $limit: String(PER_PROVIDER),
      });
    },
    read: (body) =>
      rows(body).map((r) => ({
        id: `chicago:${str(r.case_number)}`,
        city: "Chicago",
        offence: str(r.primary_type) || "Offence",
        detail: str(r.description) || undefined,
        block: str(r.block) || undefined,
        lat: num(r.latitude),
        lon: num(r.longitude),
        at: localToEpoch(str(r.date), "America/Chicago") ?? NaN,
        agency: "Chicago Police Department",
        dataset: "https://data.cityofchicago.org/d/ijzp-q8t2",
        disclaimer: CHICAGO_DISCLAIMER,
      })),
  },
  {
    key: "boston",
    city: "Boston",
    agency: "Boston Police Department",
    dataset: "https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system",
    timeZone: "America/New_York",
    url: (since) =>
      "https://data.boston.gov/api/3/action/datastore_search_sql?sql=" +
      encodeURIComponent(
        `SELECT "INCIDENT_NUMBER","OFFENSE_DESCRIPTION","STREET","OCCURRED_ON_DATE","Lat","Long","SHOOTING" ` +
          `FROM "b973d8cb-eeb2-4e7e-99da-c92938efc9c0" WHERE "Lat" IS NOT NULL AND "OCCURRED_ON_DATE" > '${since}' ` +
          `ORDER BY "OCCURRED_ON_DATE" DESC LIMIT ${PER_PROVIDER}`,
      ),
    read: (body) => {
      const recs = (body as { result?: { records?: Record<string, unknown>[] } })?.result?.records;
      if (!Array.isArray(recs)) return [];
      return recs
        .filter((r) => !NOT_A_CRIME.test(str(r.OFFENSE_DESCRIPTION).toUpperCase()))
        .map((r) => ({
          // One incident can carry several offences, one row each.
          id: `boston:${str(r.INCIDENT_NUMBER)}:${str(r.OFFENSE_DESCRIPTION).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}`,
          city: "Boston",
          offence: str(r.SHOOTING) === "1" ? "SHOOTING" : str(r.OFFENSE_DESCRIPTION) || "Offence",
          detail: str(r.SHOOTING) === "1" ? str(r.OFFENSE_DESCRIPTION) || undefined : undefined,
          // STREET can carry the whole postal address on several lines; keep the street.
          block: str(r.STREET).split(/\r?\n/)[0]?.trim() || undefined,
          lat: num(r.Lat),
          lon: num(r.Long),
          at: Date.parse(str(r.OCCURRED_ON_DATE).replace(" ", "T").replace(/\+00$/, "Z")),
          agency: "Boston Police Department",
          dataset: "https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system",
        }));
    },
  },
  {
    key: "kansas-city",
    city: "Kansas City MO",
    agency: "Kansas City Missouri Police Department",
    dataset: "https://data.kcmo.org/d/f7wj-ckmw",
    timeZone: "America/Chicago",
    // One row per person involved in a report: only report-level fields are asked for,
    // and the rows are folded to one per report below. Race, sex and involvement are
    // never requested.
    url: (since) =>
      soql("https://data.kcmo.org/resource/f7wj-ckmw.json", {
        $select: "report,report_date,offense,description,address,location,firearmusedflag",
        $where: `report_date > '${since}T00:00:00'`,
        $order: "report_date DESC",
        $limit: String(PER_PROVIDER),
      }),
    read: (body) =>
      rows(body).map((r) => {
        const coords = (r.location as { coordinates?: unknown[] } | undefined)?.coordinates;
        return {
          id: `kansas-city:${str(r.report)}`,
          city: "Kansas City MO",
          offence: str(r.description) || str(r.offense) || "Offence",
          detail: r.firearmusedflag === true ? "Firearm used" : str(r.offense) || undefined,
          block: str(r.address).replace(/\s+/g, " ") || undefined,
          lat: Array.isArray(coords) ? num(coords[1]) : NaN,
          lon: Array.isArray(coords) ? num(coords[0]) : NaN,
          at: localToEpoch(str(r.report_date), "America/Chicago") ?? NaN,
          agency: "Kansas City Missouri Police Department",
          dataset: "https://data.kcmo.org/d/f7wj-ckmw",
        };
      }),
  },
];

const titleCase = (s: string) =>
  s.length > 3 && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;

/**
 * Pure: records → features, one per record id (the first wins, so a provider listed
 * earlier, such as Chicago's shootings table, beats a later duplicate). Records with no
 * real coordinate, no time, or a time outside the window are dropped.
 */
export function normalizeCityCrime(records: CityCrime[], now: number = Date.now(), days = CRIME_US_DAYS * 2): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.id || seen.has(r.id)) continue;
    if (!placed(r.lat, r.lon) || !Number.isFinite(r.at)) continue;
    if (r.at > now + 3_600_000 || now - r.at > days * 86_400_000) continue;
    seen.add(r.id);
    const group = crimeGroup(`${r.offence} ${r.detail ?? ""}`);
    const offence = titleCase(r.offence);
    out.push({
      id: `crime-us:${r.id}`,
      lat: r.lat,
      lon: r.lon,
      title: `${offence} — ${r.block ? `${titleCase(r.block)}, ` : ""}${r.city}`,
      signalId: "crime-us",
      color: GROUP_COLOR[group],
      ts: new Date(r.at).toISOString(),
      link: r.dataset,
      props: {
        city: r.city,
        offence,
        detail: r.detail ? titleCase(r.detail) : undefined,
        category: GROUP_LABEL[group],
        block: r.block ? titleCase(r.block) : undefined,
        reportedBy: r.agency,
        ...(r.disclaimer ? { disclaimer: r.disclaimer } : {}),
      },
    });
  }
  return out;
}

/** The local date `days` before `now` in `timeZone`, as YYYY-MM-DD. */
export function sinceLocal(now: number, timeZone: string, days = CRIME_US_DAYS): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(now - days * 86_400_000),
  );
}

export const US_CITY_CRIME_SOURCE: SignalSource = {
  id: "crime-us",
  // Every portal places a record on its block or a nearby intersection, not the address.
  precision: "area",
  kind: "event",
  label: "US city crime",
  group: "Civic safety",
  color: "#b91c1c",
  refreshMs: 60 * 60 * 1000,
  attribution: CRIME_US_ATTRIBUTION,
  async fetch() {
    const now = Date.now();
    const results = await Promise.all(
      PROVIDERS.map(async (p) => {
        try {
          const res = await fetch(p.url(sinceLocal(now, p.timeZone)), {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(25_000),
          });
          if (!res.ok) return null;
          return p.read(await res.json());
        } catch {
          return null;
        }
      }),
    );
    const failed = PROVIDERS.filter((_, i) => results[i] === null).map((p) => p.key);
    if (failed.length === PROVIDERS.length) return degraded("all city portals failed");
    let features = capCrime(normalizeCityCrime(results.flatMap((r) => r ?? []), now), CRIME_US_CAP);
    // A portal that returned its full PER_PROVIDER rows had more to give, so the total
    // is a lower bound, and the coverage record must say so.
    const rec = readCoverage(features);
    if (rec && results.some((r) => r && r.length >= PER_PROVIDER)) {
      const { returned: _returned, ...rest } = rec;
      features = withCoverage(features, { ...rest, availableExact: false, capped: true });
    }
    if (failed.length > 0) {
      const named = `${failed.length} of ${PROVIDERS.length} portals failed: ${failed.join(", ")}`;
      return degradedWith(features, named.length <= 80 ? named : `${failed.length} of ${PROVIDERS.length} portals failed`, now);
    }
    return observed(features, now);
  },
};
