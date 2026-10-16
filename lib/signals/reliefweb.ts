import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso3 } from "@/lib/signals/country-centroids.data";
import { parseCsv } from "@/lib/signals/airports";
import { degraded, observed } from "@/lib/signals/outcome";

// Humanitarian emergencies. Two operator-primary upstreams, both keyless:
//
//   1. ReliefWeb (UN OCHA): the register of active emergencies (conflict, flood,
//      drought, epidemic, cyclone, complex emergencies), each placed on its primary
//      country. Read from ReliefWeb's OWN weekly export on HDX, the "ReliefWeb
//      Disasters List" (CC BY 4.0), because the live API is closed: since 2025-11-01 it
//      answers 403 to any appname ReliefWeb has not approved, and it did not approve
//      ours. The export carries the same fields as the API (status, glide, primary
//      country ISO-3 and location, type code, url, dates). Its cost is freshness: it is
//      refreshed weekly (Wednesdays), so a new disaster can be up to ~7 days late.
//   2. IFRC GO appeals: the Red Cross / Red Crescent emergency appeals and DREFs,
//      updated the same day. They cover the export's week of lag. An appeal that
//      matches a ReliefWeb record (same country, same type, started within 45 days)
//      is dropped, so one emergency is one mark.
//
// The status filter keeps `ongoing` as well as `alert` and `current`: the export has
// no `current` at all (99 ongoing, 3 alert, 3613 past on 2026-10-16), so a filter on
// current|alert would have kept 3 rows.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** CKAN record of ReliefWeb's export. Resolved per refresh: resource ids can change. */
export const RELIEFWEB_HDX_PACKAGE =
  "https://data.humdata.org/api/3/action/package_show?id=reliefweb-disasters-list";
export const IFRC_APPEALS_URL = "https://goadmin.ifrc.org/api/v2/appeal/?status=0&limit=500";

export const RELIEFWEB_ATTRIBUTION =
  "ReliefWeb Disasters List (UN OCHA), CC BY 4.0, via HDX · IFRC GO emergency appeals";

/** Statuses that mean the emergency is still running. */
const ACTIVE_STATUSES = new Set(["ongoing", "alert", "current"]);

/** ReliefWeb disaster-type code → colour. */
export function disasterColor(code: string): string {
  switch (code.toUpperCase()) {
    case "EQ": return "#b45309"; // earthquake
    case "TC": return "#7e22ce"; // tropical cyclone
    case "FL": return "#2563eb"; // flood
    case "FF": return "#1d4ed8"; // flash flood
    case "DR": return "#a16207"; // drought
    case "EP": return "#0d9488"; // epidemic
    case "CE": return "#dc2626"; // complex emergency (conflict)
    case "AC": return "#ea580c"; // technological / other accident
    case "WF": return "#c2410c"; // wildfire
    case "VO": return "#9a3412"; // volcano
    default: return "#64748b";
  }
}

/** Active disasters get a bigger marker; alerts biggest. */
function statusMagnitude(status: string): number {
  switch (status) {
    case "alert": return 7;
    case "ongoing":
    case "current": return 5;
    default: return 3;
  }
}

/** First value of a multi-value export cell ("a, b" → "a"). */
const first = (v: string | undefined) => (v ?? "").split(",")[0].trim();

/** CSV text → objects keyed by the header row. */
export function csvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const head = rows[0] ?? [];
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(1)) {
    if (r.length === 1 && r[0] === "") continue;
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = r[i] ?? ""));
    out.push(o);
  }
  return out;
}

/**
 * Pure: ReliefWeb Disasters List CSV → SignalFeature[], one per ACTIVE disaster that
 * can be placed. Place = the export's primary-country location, else our centroid
 * for the ISO-3. A row with neither is skipped.
 */
export function normalizeReliefWebCsv(text: string): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const r of csvRecords(text)) {
    const status = (r.status ?? "").trim().toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) continue;
    const id = (r.id ?? "").trim() || (r.glide ?? "").trim();
    if (!id) continue;
    const iso3 = first(r["primary_country-iso3"]).toUpperCase();
    let lat = Number(first(r["primary_country-location-lat"]));
    let lon = Number(first(r["primary_country-location-lon"]));
    if (first(r["primary_country-location-lat"]) === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      const c = centroidByIso3(iso3);
      if (!c) continue;
      lat = c.lat;
      lon = c.lon;
    }
    const name = (r.name ?? "").trim();
    const country = first(r["primary_country-name"]) || "Unknown";
    const types = (r["type-name"] ?? "").trim();
    const code = first(r["primary_type-code"]);
    const changed = (r["date-changed"] ?? "").trim() || (r["date-created"] ?? "").trim();
    const glide = (r.glide ?? "").trim();
    out.push({
      id: `reliefweb:${id}`,
      lat,
      lon,
      title: name || `${country} emergency`,
      signalId: "reliefweb",
      ...(/^[A-Z]{3}$/.test(iso3) ? { countryIso3: iso3 } : {}),
      color: disasterColor(code),
      ...(changed ? { ts: changed } : {}),
      link: (r.url_alias ?? "").trim() || (r.url ?? "").trim() || undefined,
      props: {
        emergency: name || "—",
        country,
        status,
        types: types || "—",
        ...(code ? { typeCode: code } : {}),
        ...(glide ? { glide } : {}),
        ...(r["date-event"] ? { started: r["date-event"].trim() } : {}),
        updated: changed || "—",
        provider: "ReliefWeb",
        magnitude: statusMagnitude(status),
      },
    });
  }
  return out;
}

// --- IFRC GO appeals ---------------------------------------------------------

interface IfrcAppeal {
  id?: string | number;
  aid?: string;
  name?: string;
  code?: string;
  atype_display?: string;
  dtype?: { name?: string } | null;
  start_date?: string | null;
  end_date?: string | null;
  modified_at?: string | null;
  num_beneficiaries?: number | null;
  amount_requested?: number | null;
  amount_funded?: number | null;
  event?: number | null;
  country?: { iso3?: string | null; name?: string | null } | null;
}

/** "2026-10-16 20:30:32.17+00:00" → ISO 8601, or null when it does not parse. */
function isoOrNull(v: unknown): string | null {
  const t = Date.parse(String(v ?? "").trim().replace(" ", "T"));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** IFRC GO disaster-type name → ReliefWeb type code, so both upstreams share colours. */
const IFRC_TYPE_CODE: Record<string, string> = {
  flood: "FL",
  "flash flood": "FF",
  epidemic: "EP",
  drought: "DR",
  cyclone: "TC",
  earthquake: "EQ",
  "complex emergency": "CE",
  "civil unrest": "CE",
  fire: "WF",
  volcano: "VO",
  "chemical emergency": "AC",
  "transport accident": "AC",
  "biological emergency": "EP",
  landslide: "LS",
  "cold wave": "CW",
  "heat wave": "HT",
  storm: "SS",
  "storm surge": "SS",
  tsunami: "TS",
};

/**
 * Anticipatory appeals are money set aside BEFORE a hazard (early-action protocols,
 * "imminent" DREFs, election readiness). They are not emergencies in progress, so they
 * stay off a layer called "Humanitarian emergencies". IFRC GO has no field for this;
 * the appeal names carry it ("Nigeria - Drought sEAP", "Ecuador - Floods - Imminent").
 */
const ANTICIPATORY = /\b(s?EAP|imminent|readiness|preparedness|anticipatory)\b/i;

/** Days either side of an appeal's start in which a same-country, same-type ReliefWeb
 *  record counts as the same emergency. */
const DEDUPE_WINDOW_MS = 45 * 86_400_000;

/**
 * Pure: IFRC GO appeals → SignalFeature[]. Keeps appeals whose end date is still to
 * come (IFRC's own "Active" flag is stale: 196 of 360 had ended on 2026-10-16), that
 * name a country we can place, and that are not anticipatory.
 */
export function normalizeIfrcAppeals(json: { results?: IfrcAppeal[] }, now = Date.now()): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const a of json?.results ?? []) {
    const end = Date.parse(String(a.end_date ?? ""));
    if (!Number.isFinite(end) || end < now) continue;
    const name = (a.name ?? "").trim();
    if (ANTICIPATORY.test(name)) continue;
    const iso3 = String(a.country?.iso3 ?? "").trim().toUpperCase();
    const c = centroidByIso3(iso3);
    if (!c) continue;
    const id = String(a.id ?? a.aid ?? a.code ?? "").trim();
    if (!id) continue;
    const typeName = (a.dtype?.name ?? "").trim();
    const code = IFRC_TYPE_CODE[typeName.toLowerCase()] ?? "OT";
    const start = String(a.start_date ?? "").trim();
    out.push({
      id: `ifrc:${id}`,
      lat: c.lat,
      lon: c.lon,
      title: name || `${c.name} emergency appeal`,
      signalId: "reliefweb",
      countryIso3: c.iso3,
      color: disasterColor(code),
      ...(isoOrNull(a.modified_at) ? { ts: isoOrNull(a.modified_at)! } : {}),
      link: a.event ? `https://go.ifrc.org/emergencies/${a.event}` : "https://go.ifrc.org/appeals/all",
      props: {
        emergency: name || "—",
        country: a.country?.name?.trim() || c.name,
        status: "ongoing",
        types: typeName || "—",
        typeCode: code,
        ...(start ? { started: start } : {}),
        appeal: [a.atype_display, a.code].filter(Boolean).join(" ") || "—",
        ...(typeof a.num_beneficiaries === "number" && a.num_beneficiaries > 0 ? { beneficiaries: a.num_beneficiaries } : {}),
        ...(typeof a.amount_requested === "number" && a.amount_requested > 0 ? { requestedChf: a.amount_requested } : {}),
        updated: a.modified_at ?? "—",
        provider: "IFRC GO",
        magnitude: statusMagnitude("ongoing"),
      },
    });
  }
  return out;
}

/**
 * Pure: ReliefWeb rows first, then every IFRC appeal that is not the same emergency.
 * Same = same country + same type code + ReliefWeb's event or creation date within
 * 45 days of the appeal's start. ReliefWeb is the source of record, so it wins.
 */
export function mergeEmergencies(relief: SignalFeature[], ifrc: SignalFeature[]): SignalFeature[] {
  const when = (f: SignalFeature) => Date.parse(String(f.props?.started ?? ""));
  const out = [...relief];
  for (const a of ifrc) {
    const t = when(a);
    const dup = relief.some(
      (r) =>
        r.countryIso3 === a.countryIso3 &&
        r.props?.typeCode === a.props?.typeCode &&
        Number.isFinite(t) &&
        Number.isFinite(when(r)) &&
        Math.abs(when(r) - t) <= DEDUPE_WINDOW_MS,
    );
    if (!dup) out.push(a);
  }
  return out;
}

// --- fetch -------------------------------------------------------------------

async function getText(url: string, ms: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(ms),
      cache: "no-store", // the CSV is ~8 MB, above Next's 2 MB data-cache item limit
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** The export's CSV resource URL, from its CKAN record. */
export function reliefWebCsvUrl(pkg: unknown): string | null {
  const res = (pkg as { result?: { resources?: { url?: string; format?: string; name?: string }[] } })?.result?.resources ?? [];
  const csv = res.find((r) => /csv/i.test(r.format ?? "") || /\.csv$/i.test(r.name ?? ""));
  return csv?.url && /^https:\/\//.test(csv.url) ? csv.url : null;
}

async function fetchReliefWeb(): Promise<SignalFeature[] | null> {
  const pkgText = await getText(RELIEFWEB_HDX_PACKAGE, 20_000);
  if (!pkgText) return null;
  let url: string | null = null;
  try {
    url = reliefWebCsvUrl(JSON.parse(pkgText));
  } catch {
    return null;
  }
  if (!url) return null;
  const csv = await getText(url, 45_000);
  return csv ? normalizeReliefWebCsv(csv) : null;
}

async function fetchIfrc(): Promise<SignalFeature[] | null> {
  const text = await getText(IFRC_APPEALS_URL, 20_000);
  if (!text) return null;
  try {
    return normalizeIfrcAppeals(JSON.parse(text));
  } catch {
    return null;
  }
}

export const RELIEFWEB_SOURCE: SignalSource = {
  id: "reliefweb",
  // Both upstreams place an emergency on its country, not at a point.
  precision: "country",
  label: "Humanitarian emergencies (ReliefWeb, IFRC)",
  group: "Human cost",
  color: "#dc2626",
  // The ReliefWeb export changes weekly and is ~8 MB; IFRC changes daily.
  refreshMs: 6 * 60 * 60 * 1000,
  attribution: RELIEFWEB_ATTRIBUTION,
  async fetch() {
    const [relief, ifrc] = await Promise.all([fetchReliefWeb(), fetchIfrc()]);
    if (!relief && !ifrc) return degraded("both upstreams failed");
    return observed(mergeEmergencies(relief ?? [], ifrc ?? []));
  },
};
