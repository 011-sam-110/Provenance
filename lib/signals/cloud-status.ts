import type { SignalFeature, SignalSource } from "@/lib/signals/types";

// Cloud and developer-platform outages — keyless, from the vendors' own status pages.
//
// A large share of "the internet is broken" moments are one provider degrading:
// Cloudflare, AWS, GitHub, a payments API. Neither competing monitor has this at
// all, and it needs no key: Atlassian Statuspage exposes an identical, documented
// `/api/v2/summary.json` on every page it hosts, so ONE adapter covers every vendor
// that uses it. Each host below was verified 200 with a parseable body on
// 2026-08-10; hosts that answered 302/404 (Anthropic, Google Cloud, Zoom, Hetzner,
// Heroku, GitLab) run something other than Statuspage and are deliberately absent
// rather than guessed at.
//
// PLACEMENT IS THE HONEST WEAKNESS. A cloud outage has no coordinates — it happens
// in regions, or everywhere. We pin each vendor at its headquarters purely so the
// layer can exist on a map, and the layer explainer says exactly that. We do NOT
// invent a region or draw an outage footprint.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const TIMEOUT_MS = 8_000;

export const CLOUD_STATUS_ATTRIBUTION = "Service status © each vendor's own Atlassian Statuspage";

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
  { key: "atlassian", label: "Atlassian", host: "status.atlassian.com", lat: -33.8696, lon: 151.2072 },
  { key: "npm", label: "npm registry", host: "status.npmjs.org", lat: 37.7823, lon: -122.4056 },
  { key: "digitalocean", label: "DigitalOcean", host: "status.digitalocean.com", lat: 40.7061, lon: -74.0087 },
  { key: "statuspage", label: "Atlassian Statuspage", host: "metastatuspage.com", lat: 44.9778, lon: -93.265 },
  { key: "discord", label: "Discord", host: "status.discord.com", lat: 37.7699, lon: -122.4477 },
  { key: "snowflake", label: "Snowflake", host: "status.snowflake.com", lat: 37.5407, lon: -122.2589 },
  { key: "mongodb", label: "MongoDB Atlas", host: "status.mongodb.com", lat: 40.7411, lon: -74.0022 },
  { key: "twilio", label: "Twilio", host: "status.twilio.com", lat: 37.7852, lon: -122.3966 },
  { key: "sendgrid", label: "SendGrid", host: "status.sendgrid.com", lat: 39.7392, lon: -104.9903 },
  { key: "linode", label: "Akamai / Linode", host: "status.linode.com", lat: 40.7075, lon: -74.0113 },
];

/** The five indicator values Statuspage publishes. Anything else is treated as unknown. */
export type StatusIndicator = "none" | "minor" | "major" | "critical" | "maintenance";

export interface StatuspageSummary {
  page?: { name?: string; url?: string; updated_at?: string };
  status?: { indicator?: string; description?: string };
  components?: { name?: string; status?: string; group?: boolean }[];
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

/**
 * Pure: one vendor's Statuspage summary → a feature, or null when the vendor is
 * fully operational.
 *
 * Only NON-operational vendors become features. A map with fourteen permanent
 * green dots on it is decoration — the layer's whole job is to be empty until
 * something is actually wrong, and "empty" is a first-class honest state here
 * (the freshness chip reads it as "none now", not as a dead feed).
 */
export function normalizeCloudStatus(vendor: CloudVendor, summary: StatuspageSummary): SignalFeature | null {
  const indicator = parseIndicator(summary.status?.indicator);
  if (indicator == null || indicator === "none") return null;

  const affected = (summary.components ?? [])
    .filter((c) => !c.group && c.status && c.status !== "operational")
    .map((c) => c.name)
    .filter((n): n is string => Boolean(n));

  const incident = (summary.incidents ?? [])[0];
  const description = summary.status?.description?.trim() || indicator;

  return {
    id: `cloud-status:${vendor.key}`,
    lat: vendor.lat,
    lon: vendor.lon,
    title: `${vendor.label} — ${description}`,
    signalId: "cloud-status",
    color: indicatorColor(indicator),
    ts: incident?.created_at || summary.page?.updated_at,
    link: incident?.shortlink || `https://${vendor.host}`,
    props: {
      vendor: vendor.label,
      severity: indicator,
      statusText: description,
      affectedComponents: affected.length ? affected.join(", ") : "not itemised by the vendor",
      affectedCount: affected.length,
      openIncident: incident?.name ?? "—",
      incidentStage: incident?.status ?? "—",
      magnitude: indicatorMagnitude(indicator),
    },
  };
}

async function fetchVendor(vendor: CloudVendor): Promise<SignalFeature | null> {
  try {
    const res = await fetch(`https://${vendor.host}/api/v2/summary.json`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    return normalizeCloudStatus(vendor, (await res.json()) as StatuspageSummary);
  } catch {
    // Dormant-safe per vendor: one unreachable status page must not blank the layer.
    return null;
  }
}

export const CLOUD_STATUS_SOURCE: SignalSource = {
  id: "cloud-status",
  label: "Cloud & platform outages",
  group: "Infrastructure",
  color: "#dc2626",
  refreshMs: 300_000,
  attribution: CLOUD_STATUS_ATTRIBUTION,
  sourceUrl: "https://www.githubstatus.com",
  metric: { field: "magnitude", domain: [0, 10] },
  async fetch(): Promise<SignalFeature[]> {
    const settled = await Promise.all(CLOUD_VENDORS.map(fetchVendor));
    return settled.filter((f): f is SignalFeature => f !== null);
  },
};
