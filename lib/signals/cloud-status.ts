import type { SignalFeature, SignalPrecision, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { POP_AIRPORTS, popAirport } from "@/lib/signals/pop-airports.data";
import {
  awsRegion,
  azureRegionIn,
  gcpRegion,
  ociRegion,
  regionFromLabel,
} from "@/lib/signals/cloud-regions.data";

// Cloud and developer-platform outages — keyless, from the vendors' own status pages.
//
// A large share of "the internet is broken" moments are one provider degrading:
// Cloudflare, AWS, GitHub, a payments API. Atlassian Statuspage exposes an
// identical, documented `/api/v2/summary.json` on every page it hosts, so one reader
// covers every vendor that uses it. The four big clouds and Fastly do not use it, so
// each has its own reader below: AWS's public current-events JSON, Google Cloud's and
// Google Workspace's incidents.json, Azure's status RSS, Oracle's region health JSON
// and Fastly's status RSS.
//
// PLACEMENT (changed 2026-10-16). Every pin used to sit at the vendor's head office.
// On that day it told three false stories: a Czech SMS fault pinned in San Francisco,
// Snowflake's GCP us-central1 (Iowa) fault pinned in San Mateo, and 65 named
// Cloudflare PoPs pinned as one dot in San Francisco. The data named the place in all
// three. So an incident is now placed where the vendor says it is: a PoP by its
// airport code, a cloud region by its id, an Azure region by the name in the title.
// Only an incident that names no place falls back to the head office, and its pin
// says so in `placement`.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const TIMEOUT_MS = 8_000;
/** An open incident older than this is flagged as long-running, not current news. */
export const LONG_RUNNING_MS = 14 * 24 * 3600_000;

export const CLOUD_STATUS_ATTRIBUTION = "Service status © each vendor's own status page";

/** A vendor whose Statuspage summary endpoint we poll. lat/lon is the HQ, nothing more. */
export interface CloudVendor {
  key: string;
  label: string;
  host: string;
  lat: number;
  lon: number;
}

export const CLOUD_VENDORS: CloudVendor[] = [
  { key: "github", label: "GitHub", host: "www.githubstatus.com", lat: 37.7823, lon: -122.4056 },
  { key: "cloudflare", label: "Cloudflare", host: "www.cloudflarestatus.com", lat: 37.7767, lon: -122.3942 },
  { key: "openai", label: "OpenAI", host: "status.openai.com", lat: 37.7623, lon: -122.4148 },
  { key: "datadog", label: "Datadog", host: "status.datadoghq.com", lat: 40.7419, lon: -74.0048 },
  // status.atlassian.com became an empty shell (0 components, 0 incidents, 2026-10-16)
  // when Atlassian split its status into one page per product, so the old row could
  // never show an outage. These three are the product pages, each 12 to 16 components.
  { key: "atlassian-jira", label: "Jira", host: "jira-software.status.atlassian.com", lat: -33.8696, lon: 151.2072 },
  { key: "atlassian-confluence", label: "Confluence", host: "confluence.status.atlassian.com", lat: -33.8696, lon: 151.2072 },
  { key: "atlassian-bitbucket", label: "Bitbucket", host: "bitbucket.status.atlassian.com", lat: -33.8696, lon: 151.2072 },
  { key: "npm", label: "npm registry", host: "status.npmjs.org", lat: 37.7823, lon: -122.4056 },
  { key: "digitalocean", label: "DigitalOcean", host: "status.digitalocean.com", lat: 40.7061, lon: -74.0087 },
  { key: "statuspage", label: "Atlassian Statuspage", host: "metastatuspage.com", lat: 44.9778, lon: -93.265 },
  { key: "discord", label: "Discord", host: "status.discord.com", lat: 37.7699, lon: -122.4477 },
  { key: "snowflake", label: "Snowflake", host: "status.snowflake.com", lat: 37.5407, lon: -122.2589 },
  { key: "mongodb", label: "MongoDB Atlas", host: "status.mongodb.com", lat: 40.7411, lon: -74.0022 },
  { key: "twilio", label: "Twilio", host: "status.twilio.com", lat: 37.7852, lon: -122.3966 },
  { key: "linode", label: "Akamai / Linode", host: "status.linode.com", lat: 40.7075, lon: -74.0113 },
  // Akamai's CDN and security platform (the Linode row above is its cloud compute).
  { key: "akamai", label: "Akamai", host: "www.akamaistatus.com", lat: 42.3626, lon: -71.0843 },
];

/** Head offices for the vendors read by their own formats. A fallback only. */
export const HQ = {
  aws: { label: "AWS", lat: 47.6223, lon: -122.3366 },
  gcp: { label: "Google Cloud", lat: 37.422, lon: -122.0841 },
  workspace: { label: "Google Workspace", lat: 37.422, lon: -122.0841 },
  azure: { label: "Microsoft Azure", lat: 47.6397, lon: -122.1288 },
  oci: { label: "Oracle Cloud", lat: 30.2433, lon: -97.7213 },
  fastly: { label: "Fastly", lat: 37.7811, lon: -122.3934 },
} as const;

/** The five indicator values Statuspage publishes. Anything else is treated as unknown. */
export type StatusIndicator = "none" | "minor" | "major" | "critical" | "maintenance";

export interface StatuspageComponent {
  id?: string;
  name?: string;
  status?: string;
  group?: boolean;
  group_id?: string | null;
}

export interface StatuspageSummary {
  page?: { name?: string; url?: string; updated_at?: string };
  status?: { indicator?: string; description?: string };
  components?: StatuspageComponent[];
  incidents?: { name?: string; status?: string; impact?: string; shortlink?: string; created_at?: string }[];
}

const INDICATORS: StatusIndicator[] = ["none", "minor", "major", "critical", "maintenance"];

export function parseIndicator(raw: string | undefined): StatusIndicator | null {
  return INDICATORS.includes(raw as StatusIndicator) ? (raw as StatusIndicator) : null;
}

/** Colour by severity. Operational vendors are dropped before this, but "none" is kept honest. */
export function indicatorColor(i: StatusIndicator): string {
  switch (i) {
    case "critical": return "#7f1d1d";
    case "major": return "#dc2626";
    case "minor": return "#f59e0b";
    case "maintenance": return "#0ea5e9";
    case "none": return "#16a34a";
  }
}

/** Marker size. Deliberately compressed: a critical outage is not 10x a minor one visually. */
export function indicatorMagnitude(i: StatusIndicator): number {
  switch (i) {
    case "critical": return 9;
    case "major": return 7;
    case "minor": return 4;
    case "maintenance": return 2;
    case "none": return 0;
  }
}

/** Where an incident is. `precision` is the feature's own level. */
export interface Placement {
  lat: number;
  lon: number;
  where: string;
  kind: "pop" | "region" | "head office";
  precision: SignalPrecision;
}

/** Pure: a PoP named by an airport code, e.g. "Arica, Chile - (ARI)", "Toronto (YYZ)", "AMS - Amsterdam". */
export function placeByPop(text: string, cityHint?: string): Placement | null {
  const m = /\(([A-Z]{3})\)\s*$/.exec(text) ?? /^([A-Z]{3})\s+-\s+/.exec(text);
  if (!m) return null;
  const row = popAirport(m[1]);
  if (!row) return null;
  const [city, , lat, lon] = row;
  const named = (cityHint ?? text.replace(/\s*-?\s*\([A-Z]{3}\)\s*$/, "").split(",")[0]).trim() || city;
  return { lat, lon, where: `${named} (${m[1]})`, kind: "pop", precision: "area" };
}

/**
 * Pure: a PoP named by its CITY, for vendors whose codes are not airport codes
 * (Fastly's "Singapore (QPG)", "Delhi (QAG)"). An exact city match first, then a
 * whole-word match ("Delhi" in "New Delhi"); the first airport row in code order wins.
 */
export function placeByCity(city: string | undefined, code?: string): Placement | null {
  const want = (city ?? "").trim().toLowerCase();
  if (want.length < 3) return null;
  const rows = Object.entries(POP_AIRPORTS);
  const hit =
    rows.find(([, r]) => r[0].toLowerCase() === want) ??
    rows.find(([, r]) => ` ${r[0].toLowerCase().replace(/[^a-z0-9]+/g, " ")} `.includes(` ${want} `));
  if (!hit) return null;
  const [, [, , lat, lon]] = hit;
  return { lat, lon, where: code ? `${city} (${code})` : city!, kind: "pop", precision: "area" };
}

/** Pure: a cloud region named in a status-page label, e.g. "GCP - US Central 1 (Iowa)". */
export function placeByRegionLabel(label: string): Placement | null {
  const reg = regionFromLabel(label);
  return reg ? { lat: reg.lat, lon: reg.lon, where: `${reg.cloud} ${reg.id} (${reg.place})`, kind: "region", precision: "area" } : null;
}

function hqPlacement(lat: number, lon: number): Placement {
  return { lat, lon, where: "head office", kind: "head office", precision: "facility" };
}

const PLACEMENT_NOTE: Record<Placement["kind"], string> = {
  pop: "the point of presence the vendor names (its airport code)",
  region: "the cloud region the vendor names",
  "head office": "vendor head office: the incident names no place, so this is NOT where it is",
};

function longRunning(createdAt: string | undefined, now: number): string | undefined {
  const t = Date.parse(createdAt ?? "");
  return Number.isFinite(t) && now - t > LONG_RUNNING_MS ? `open since ${new Date(t).toISOString().slice(0, 10)}` : undefined;
}

/**
 * Pure: is this summary the vendor's own page? A status host that has been merged
 * into another vendor's redirects to it, and fetch() follows the redirect, so the
 * second vendor's incident would be published again under the first vendor's name.
 * That happened: status.sendgrid.com 302s to status.twilio.com, and on 2026-10-16
 * prod showed Twilio's Czech SMS incident twice, once as "SendGrid" in Denver.
 * A page that names no URL is given the benefit of the doubt.
 */
export function pageMatchesVendor(vendor: CloudVendor, summary: StatuspageSummary): boolean {
  const url = summary.page?.url;
  if (!url) return true;
  try {
    return new URL(url).hostname.toLowerCase() === vendor.host.toLowerCase();
  } catch {
    return true;
  }
}

/**
 * Pure: one vendor's Statuspage summary → features, empty when it is operational.
 *
 * Only NON-operational vendors produce anything. A map with permanent green dots
 * on it is decoration — the layer's whole job is to be empty until something is
 * actually wrong, and "empty" is a first-class honest state here.
 *
 * One feature per PLACE the degraded components name (a PoP airport code, or a cloud
 * region in the component's group), so Cloudflare's 60 degraded PoPs are 60 pins
 * where they are. Components that name no place go on one head-office pin, which
 * says it is one. Every open incident is listed, not only the first.
 */
export function normalizeCloudStatus(vendor: CloudVendor, summary: StatuspageSummary, now: number = Date.now()): SignalFeature[] {
  const indicator = parseIndicator(summary.status?.indicator);
  if (indicator == null || indicator === "none") return [];

  const all = summary.components ?? [];
  const groupName = new Map(all.filter((c) => c.group && c.id).map((c) => [c.id as string, c.name ?? ""]));
  const broken = all.filter((c) => !c.group && c.status && c.status !== "operational" && c.name);

  const incidents = summary.incidents ?? [];
  const openNames = incidents.map((i) => i.name).filter((n): n is string => Boolean(n));
  const oldest = incidents
    .map((i) => i.created_at)
    .filter((t): t is string => Boolean(t))
    .sort()[0];
  const description = summary.status?.description?.trim() || indicator;
  const ts = oldest || summary.page?.updated_at;
  const link = incidents[0]?.shortlink || `https://${vendor.host}`;
  const stale = longRunning(oldest, now);

  const placed = new Map<string, { p: Placement; components: string[]; worst: string }>();
  const unplaced: string[] = [];
  for (const c of broken) {
    const group = c.group_id ? groupName.get(c.group_id) : undefined;
    const p = placeByPop(c.name!) ?? (group ? placeByRegionLabel(group) : null) ?? placeByRegionLabel(c.name!);
    if (!p) {
      unplaced.push(c.name!);
      continue;
    }
    const k = `${p.lat},${p.lon}`;
    const slot = placed.get(k) ?? { p, components: [], worst: c.status! };
    slot.components.push(c.name!);
    if (c.status === "major_outage") slot.worst = c.status;
    placed.set(k, slot);
  }

  const base = (p: Placement, components: string[], status: string) => ({
    vendor: vendor.label,
    severity: indicator,
    statusText: description,
    placement: PLACEMENT_NOTE[p.kind],
    affectedComponents: components.length ? components.join(", ") : "not itemised by the vendor",
    affectedCount: components.length,
    componentStatus: status.replace(/_/g, " "),
    openIncident: openNames[0] ?? "—",
    openIncidents: openNames.length ? openNames.slice(0, 5).join("; ") : "—",
    openIncidentCount: openNames.length,
    incidentStage: incidents[0]?.status ?? "—",
    ...(stale ? { longRunning: stale } : {}),
    magnitude: indicatorMagnitude(indicator),
  });

  const out: SignalFeature[] = [];
  for (const { p, components, worst } of placed.values()) {
    out.push({
      id: `cloud-status:${vendor.key}:${p.where.replace(/\s+/g, "-").toLowerCase()}`,
      lat: p.lat,
      lon: p.lon,
      precision: p.precision,
      title: `${vendor.label} — ${p.where}: ${worst.replace(/_/g, " ")}`,
      signalId: "cloud-status",
      color: indicatorColor(indicator),
      ts,
      link,
      props: base(p, components, worst),
    });
  }
  // Whatever names no place (or a vendor that itemises nothing) is one head-office pin.
  if (unplaced.length > 0 || out.length === 0) {
    const p = hqPlacement(vendor.lat, vendor.lon);
    out.push({
      id: `cloud-status:${vendor.key}`,
      lat: p.lat,
      lon: p.lon,
      precision: p.precision,
      title: `${vendor.label} — ${description}`,
      signalId: "cloud-status",
      color: indicatorColor(indicator),
      ts,
      link,
      props: base(p, unplaced, "see the vendor page"),
    });
  }
  return out;
}

// --- AWS -------------------------------------------------------------------

/** One open event from health.aws.amazon.com/public/currentevents. */
export interface AwsHealthEvent {
  date?: string;
  arn?: string;
  region_name?: string;
  /** "1" informational, "2" degradation, "3" disruption. */
  status?: string;
  service?: string;
  service_name?: string;
  summary?: string;
  impacted_services?: Record<string, { service_name?: string }>;
  event_log?: { summary?: string; message?: string; status?: number; timestamp?: number }[];
}

/** Pure: AWS's body is UTF-16 (with a byte-order mark). Decode either encoding. */
export function decodeAwsBody(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  // No BOM: a NUL in the first two bytes means UTF-16 big-endian ASCII text.
  if (b.length > 1 && b[0] === 0 && b[1] !== 0) return new TextDecoder("utf-16be").decode(b);
  return new TextDecoder("utf-8").decode(b);
}

/** Pure: the region id inside an AWS Health ARN, e.g. "me-central-1". */
export function awsRegionId(e: AwsHealthEvent): string | undefined {
  return /^arn:aws:health:([a-z0-9-]+):/.exec(e.arn ?? "")?.[1];
}

const AWS_SEVERITY: Record<string, StatusIndicator> = { "1": "minor", "2": "minor", "3": "major" };

/** Pure: AWS open events → one feature per event, in its region when the ARN names one. */
export function normalizeAwsEvents(events: AwsHealthEvent[], now: number = Date.now()): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const e of events) {
    const sev = AWS_SEVERITY[e.status ?? ""];
    if (!sev) continue;
    const regionId = awsRegionId(e);
    const reg = regionId ? awsRegion(regionId) : undefined;
    const p: Placement = reg
      ? { lat: reg.lat, lon: reg.lon, where: `${regionId} (${e.region_name || reg.place})`, kind: "region", precision: "area" }
      : hqPlacement(HQ.aws.lat, HQ.aws.lon);
    const started = Number(e.date) * 1000;
    const startedIso = Number.isFinite(started) && started > 0 ? new Date(started).toISOString() : undefined;
    const log = e.event_log ?? [];
    const last = log[log.length - 1];
    const services = Object.values(e.impacted_services ?? {}).map((s) => s.service_name).filter(Boolean) as string[];
    const stale = longRunning(startedIso, now);
    out.push({
      id: `cloud-status:aws:${(e.arn ?? "").split("/").pop() || regionId || "global"}`,
      lat: p.lat,
      lon: p.lon,
      precision: p.precision,
      title: `AWS — ${p.kind === "region" ? `${p.where}: ` : ""}${e.summary || e.service_name || "service event"}`,
      signalId: "cloud-status",
      color: indicatorColor(sev),
      ts: startedIso,
      link: "https://health.aws.amazon.com/health/status",
      props: {
        vendor: "AWS",
        severity: sev,
        statusText: e.status === "3" ? "Service disruption" : e.status === "2" ? "Service degradation" : "Informational",
        placement: PLACEMENT_NOTE[p.kind],
        affectedComponents: services.length ? `${services.slice(0, 8).join(", ")}${services.length > 8 ? ` and ${services.length - 8} more` : ""}` : e.service_name || "—",
        affectedCount: services.length,
        openIncident: e.summary || "—",
        latestUpdate: last?.message ? last.message.slice(0, 280) : "—",
        ...(last?.timestamp ? { updatedAt: new Date(last.timestamp * 1000).toISOString() } : {}),
        ...(stale ? { longRunning: stale } : {}),
        magnitude: indicatorMagnitude(sev),
      },
    });
  }
  return out;
}

// --- Google Cloud and Google Workspace ------------------------------------------

export interface GoogleIncident {
  id?: string;
  begin?: string;
  end?: string | null;
  external_desc?: string;
  severity?: string;
  status_impact?: string;
  service_name?: string;
  uri?: string;
  currently_affected_locations?: { id?: string; title?: string }[];
}

const GOOGLE_SEVERITY: Record<string, StatusIndicator> = { high: "major", medium: "minor", low: "minor" };

/**
 * Pure: Google incidents.json → features for the incidents still open (no `end`).
 * A Google Cloud incident gets one pin per region it currently affects; "global" and
 * Workspace incidents name no region and go to the head office.
 */
export function normalizeGoogleIncidents(
  incidents: GoogleIncident[],
  which: "gcp" | "workspace",
  now: number = Date.now(),
): SignalFeature[] {
  const hq = HQ[which];
  const base = which === "gcp" ? "https://status.cloud.google.com/" : "https://www.google.com/appsstatus/dashboard/";
  const out: SignalFeature[] = [];
  for (const inc of incidents) {
    if (inc.end) continue;
    const sev = GOOGLE_SEVERITY[(inc.severity ?? "").toLowerCase()] ?? "minor";
    const regions = (inc.currently_affected_locations ?? [])
      .map((l) => ({ id: l.id ?? "", reg: gcpRegion(l.id ?? "") }))
      .filter((x) => x.reg);
    const places: Placement[] = regions.length
      ? regions.map(({ id, reg }) => ({ lat: reg!.lat, lon: reg!.lon, where: `${id} (${reg!.place})`, kind: "region" as const, precision: "area" as const }))
      : [hqPlacement(hq.lat, hq.lon)];
    const desc = (inc.external_desc ?? "").replace(/\*\*/g, "").split("\n").find((l) => l.trim() && !/^summary:?$/i.test(l.trim()))?.trim();
    const stale = longRunning(inc.begin, now);
    for (const p of places) {
      out.push({
        id: `cloud-status:${which}:${inc.id ?? "incident"}${p.kind === "region" ? `:${p.where.split(" ")[0]}` : ""}`,
        lat: p.lat,
        lon: p.lon,
        precision: p.precision,
        title: `${hq.label} — ${p.kind === "region" ? `${p.where}: ` : ""}${inc.service_name ?? "incident"}`,
        signalId: "cloud-status",
        color: indicatorColor(sev),
        ts: inc.begin,
        link: inc.uri ? `${base}${inc.uri}` : base,
        props: {
          vendor: hq.label,
          severity: sev,
          statusText: (inc.status_impact ?? "").replace(/_/g, " ").toLowerCase() || sev,
          placement: PLACEMENT_NOTE[p.kind],
          affectedComponents: inc.service_name ?? "—",
          affectedCount: 1,
          openIncident: (desc ?? "—").slice(0, 200),
          ...(stale ? { longRunning: stale } : {}),
          magnitude: indicatorMagnitude(sev),
        },
      });
    }
  }
  return out;
}

// --- RSS (Azure, Fastly) ---------------------------------------------------------

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: number;
}

const decodeEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** Pure: RSS 2.0 items, with HTML in the description reduced to text. */
export function parseRssItems(xml: string): RssItem[] {
  const out: RssItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const tag = (name: string) => {
      const t = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(m[1]);
      return t ? decodeEntities(t[1]).trim() : "";
    };
    const description = decodeEntities(tag("description").replace(/<[^>]+>/g, " ")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ title: tag("title"), link: tag("link"), description, pubDate: Date.parse(tag("pubDate")) });
  }
  return out;
}

/**
 * Pure: Azure's status RSS → one feature per item. The feed lists ACTIVE events
 * only (it was empty, and the page agreed, on 2026-10-16), so every item is current.
 * The region comes from the title; a title that names none goes to the head office.
 */
export function normalizeAzureRss(xml: string): SignalFeature[] {
  return parseRssItems(xml).map((it, i) => {
    const reg = azureRegionIn(`${it.title} ${it.description}`);
    const p: Placement = reg
      ? { lat: reg.lat, lon: reg.lon, where: reg.place, kind: "region", precision: "area" }
      : hqPlacement(HQ.azure.lat, HQ.azure.lon);
    return {
      id: `cloud-status:azure:${Number.isFinite(it.pubDate) ? it.pubDate : i}`,
      lat: p.lat,
      lon: p.lon,
      precision: p.precision,
      title: `Microsoft Azure — ${it.title || "active event"}`,
      signalId: "cloud-status",
      color: indicatorColor("major"),
      ...(Number.isFinite(it.pubDate) ? { ts: new Date(it.pubDate).toISOString() } : {}),
      link: it.link || "https://azure.status.microsoft/en-us/status/",
      props: {
        vendor: "Microsoft Azure",
        // Azure posts to this page only for broad events; the feed carries no level.
        severity: "major",
        statusText: "active event on Azure's status page",
        placement: PLACEMENT_NOTE[p.kind],
        affectedComponents: it.title || "—",
        affectedCount: 1,
        openIncident: it.description.slice(0, 200) || "—",
        magnitude: indicatorMagnitude("major"),
      },
    };
  });
}

/** Words in a Fastly update that close an incident or a maintenance. */
const FASTLY_CLOSED = /\b(resolved|completed|fully restored|has been restored)\b/i;
/** A Fastly incident whose newest update is older than this is not current. */
export const FASTLY_WINDOW_MS = 48 * 3600_000;

/**
 * Pure: Fastly's status RSS → features for incidents still open. The feed has one
 * item per UPDATE, grouped here by incident link; the newest update decides whether
 * it is closed. The PoP comes from the airport code in the title ("Toronto (YYZ)").
 * Fastly also uses its own Q-codes ("Delhi (QAG)"), which no airport table holds, so
 * those are placed by the city in the title, and failing that at the head office,
 * which the pin then says.
 */
export function normalizeFastlyRss(xml: string, now: number = Date.now()): SignalFeature[] {
  const byIncident = new Map<string, RssItem[]>();
  for (const it of parseRssItems(xml)) {
    if (!Number.isFinite(it.pubDate) || it.pubDate > now) continue;
    const k = it.link || it.title;
    const list = byIncident.get(k) ?? [];
    list.push(it);
    byIncident.set(k, list);
  }
  const out: SignalFeature[] = [];
  for (const [link, items] of byIncident) {
    items.sort((a, b) => b.pubDate - a.pubDate);
    const newest = items[0];
    if (now - newest.pubDate > FASTLY_WINDOW_MS) continue;
    if (FASTLY_CLOSED.test(newest.description)) continue;
    const maintenance = /maintenance|migration|expansion/i.test(newest.title);
    const sev: StatusIndicator = maintenance ? "maintenance" : "minor";
    const code = /\(([A-Z]{3})\)/.exec(newest.title)?.[1];
    const city = code ? /([^:()]+?)\s*\([A-Z]{3}\)/.exec(newest.title)?.[1]?.replace(/^.*\b(for|in)\s+/i, "").trim() : undefined;
    const p = (code ? placeByPop(`(${code})`, city) : null) ?? placeByCity(city, code) ?? hqPlacement(HQ.fastly.lat, HQ.fastly.lon);
    const first = items[items.length - 1];
    out.push({
      id: `cloud-status:fastly:${link.split("/").pop() || newest.pubDate}`,
      lat: p.lat,
      lon: p.lon,
      precision: p.precision,
      title: `Fastly — ${newest.title}`,
      signalId: "cloud-status",
      color: indicatorColor(sev),
      ts: new Date(first.pubDate).toISOString(),
      link: link.startsWith("http") ? link : "https://www.fastlystatus.com/",
      props: {
        vendor: "Fastly",
        severity: sev,
        statusText: maintenance ? "scheduled maintenance" : "open incident",
        placement: PLACEMENT_NOTE[p.kind],
        affectedComponents: code ? `PoP ${code}` : "—",
        affectedCount: 1,
        openIncident: newest.description.slice(0, 200) || newest.title,
        updatedAt: new Date(newest.pubDate).toISOString(),
        magnitude: indicatorMagnitude(sev),
      },
    });
  }
  return out;
}

// --- Oracle Cloud ------------------------------------------------------------------

export interface OciHealth {
  regionHealthReports?: {
    regionName?: string;
    regionCanonicalName?: string;
    serviceHealthReports?: { serviceName?: string; serviceStatus?: string; incidents?: unknown[] }[];
  }[];
}

/**
 * Pure: Oracle's region health → one feature per region with a service that is not
 * at "NormalPerformance" or has an incident. All 4,615 service reports in 90 regions
 * were normal on 2026-10-16, so the status words for a fault are not known from a
 * capture: anything naming an outage or a disruption is major, anything else minor.
 */
export function normalizeOciHealth(json: OciHealth): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const r of json.regionHealthReports ?? []) {
    const bad = (r.serviceHealthReports ?? []).filter(
      (s) => (s.serviceStatus && s.serviceStatus !== "NormalPerformance") || (s.incidents?.length ?? 0) > 0,
    );
    if (bad.length === 0) continue;
    const canonical = r.regionCanonicalName ?? "";
    const reg = ociRegion(canonical);
    const p: Placement = reg
      ? { lat: reg.lat, lon: reg.lon, where: `${canonical} (${reg.place})`, kind: "region", precision: "area" }
      : hqPlacement(HQ.oci.lat, HQ.oci.lon);
    const sev: StatusIndicator = bad.some((s) => /outage|disrupt|down/i.test(s.serviceStatus ?? "")) ? "major" : "minor";
    const names = bad.map((s) => s.serviceName).filter(Boolean) as string[];
    out.push({
      id: `cloud-status:oci:${canonical || "unknown"}`,
      lat: p.lat,
      lon: p.lon,
      precision: p.precision,
      title: `Oracle Cloud — ${r.regionName?.trim() || canonical}: ${bad.length} service${bad.length === 1 ? "" : "s"} affected`,
      signalId: "cloud-status",
      color: indicatorColor(sev),
      link: "https://ocistatus.oraclecloud.com/",
      props: {
        vendor: "Oracle Cloud",
        severity: sev,
        statusText: [...new Set(bad.map((s) => s.serviceStatus).filter(Boolean))].join(", ") || "incident",
        placement: PLACEMENT_NOTE[p.kind],
        affectedComponents: names.slice(0, 8).join(", ") || "—",
        affectedCount: names.length,
        magnitude: indicatorMagnitude(sev),
      },
    });
  }
  return out;
}

// --- fetchers ------------------------------------------------------------------------

/**
 * One reader's result. `ok` is about the FETCH, `features` about the vendor: a
 * healthy vendor is `{ ok: true, features: [] }` and an unreachable status page is
 * `{ ok: false, features: [] }`. The outer fetch cannot declare an outcome it
 * cannot see.
 */
interface Read {
  ok: boolean;
  features: SignalFeature[];
}

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 120 },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function fetchVendor(vendor: CloudVendor): Promise<Read> {
  try {
    const res = await get(`https://${vendor.host}/api/v2/summary.json`, "application/json");
    if (!res) return { ok: false, features: [] };
    const summary = (await res.json()) as StatuspageSummary;
    // Another vendor's page under this vendor's name is a failed read, not an outage.
    if (!pageMatchesVendor(vendor, summary)) return { ok: false, features: [] };
    return { ok: true, features: normalizeCloudStatus(vendor, summary) };
  } catch {
    // Dormant-safe per vendor: one unreachable status page must not blank the layer.
    return { ok: false, features: [] };
  }
}

async function readWith(url: string, accept: string, parse: (res: Response) => Promise<SignalFeature[]>): Promise<Read> {
  try {
    const res = await get(url, accept);
    if (!res) return { ok: false, features: [] };
    return { ok: true, features: await parse(res) };
  } catch {
    return { ok: false, features: [] };
  }
}

/** The non-Statuspage readers, by name, so the count in the explainer stays honest. */
export const OTHER_READERS = ["aws", "gcp", "workspace", "azure", "oci", "fastly"] as const;

function otherReaders(): Promise<Read>[] {
  return [
    readWith("https://health.aws.amazon.com/public/currentevents", "application/json", async (res) =>
      normalizeAwsEvents(JSON.parse(decodeAwsBody(await res.arrayBuffer())) as AwsHealthEvent[]),
    ),
    readWith("https://status.cloud.google.com/incidents.json", "application/json", async (res) =>
      normalizeGoogleIncidents((await res.json()) as GoogleIncident[], "gcp"),
    ),
    readWith("https://www.google.com/appsstatus/dashboard/incidents.json", "application/json", async (res) =>
      normalizeGoogleIncidents((await res.json()) as GoogleIncident[], "workspace"),
    ),
    readWith("https://azure.status.microsoft/en-us/status/feed/", "application/rss+xml", async (res) => normalizeAzureRss(await res.text())),
    readWith("https://ocistatus.oraclecloud.com/api/v2/components_v2.json", "application/json", async (res) =>
      normalizeOciHealth((await res.json()) as OciHealth),
    ),
    readWith("https://www.fastlystatus.com/rss", "application/rss+xml", async (res) => normalizeFastlyRss(await res.text())),
  ];
}

export const CLOUD_STATUS_SOURCE: SignalSource = {
  id: "cloud-status",
  // The default for a pin with no place: the vendor, at its head office. A PoP or a
  // cloud region the vendor names sets its own "area" precision.
  precision: "facility",
  label: "Cloud & platform outages",
  group: "Infrastructure",
  color: "#dc2626",
  refreshMs: 300_000,
  attribution: CLOUD_STATUS_ATTRIBUTION,
  sourceUrl: "https://www.githubstatus.com",
  metric: { field: "magnitude", domain: [0, 10] },
  async fetch(): Promise<SignalFeature[]> {
    const settled = await Promise.all([...CLOUD_VENDORS.map(fetchVendor), ...otherReaders()]);
    const features = settled.flatMap((r) => r.features);
    const unreachable = settled.filter((r) => !r.ok).length;
    // Empty is a REAL answer here (every vendor operational), so only a status page
    // we could not read counts as degraded. A partial failure keeps the vendors that
    // did answer — losing a live outage marker because an unrelated page timed out
    // would be the worse error of the two.
    // TOTAL failure is degraded; PARTIAL failure is not. This layer fans out to 22
    // independent status pages, and those are flaky by nature — one of them
    // hiccupping is the normal weather here, not an outage of this layer.
    //
    // Marking the whole layer ok:false on a single unreachable vendor would render
    // it "down" on the public ledger while 21 of 22 pages were read perfectly
    // well. That is its own false claim, and a worse one than it looks: a row that
    // shows red most days is a row people learn to skip, which costs us the days it
    // means something. Same reasoning as keeping licence notices off every layer.
    //
    // Partial coverage already has a mechanism in this repo, and it is not `ok` —
    // it is the coverage record, which exists to say "this is N of M". `ok`
    // answers a narrower question: could we read this source at all. So a partial
    // read stays observed.
    if (unreachable === settled.length) return degraded("no vendor status page answered");
    return observed(features);
  },
};
