import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// `statuspage-github-operational.json` is a REAL capture of
// https://www.githubstatus.com/api/v2/summary.json (2026-08-10), trimmed to the
// page/status block and the first three components.
// `statuspage-degraded.json` is DERIVED from that same capture: identical shape,
// with the indicator and two component statuses changed to exercise the degraded
// path. GitHub was operational at capture time and we do not wait for an outage
// to test our handling of one — but nothing here is invented from scratch.
import operational from "@/tests/fixtures/statuspage-github-operational.json";
import degraded from "@/tests/fixtures/statuspage-degraded.json";
// REAL captures, 2026-10-16 ~20:57 UTC, TRIMMED to the page and status blocks, every
// open incident, every non-operational component, the groups those sit in, and three
// operational components. Cloudflare was "major" with 60 degraded components (59 PoPs
// and WARP); Snowflake was
// "minor" with two components degraded in group "GCP - US Central 1 (Iowa)".
import cloudflare from "@/tests/fixtures/statuspage-cloudflare-major.json";
import snowflake from "@/tests/fixtures/statuspage-snowflake-minor.json";
// REAL capture of health.aws.amazon.com/public/currentevents (same evening): two open
// "Region Availability" events, me-central-1 (UAE) and me-south-1 (Bahrain). Trimmed:
// each event keeps only its last log entry (cut to 300 characters) and five of its
// impacted services. Stored as UTF-8; the live body is UTF-16 (see decodeAwsBody).
import aws from "@/tests/fixtures/aws-health-currentevents.json";
// REAL capture of status.cloud.google.com/incidents.json, the three newest incidents,
// all closed (each has an `end`), with `updates` removed.
import gcp from "@/tests/fixtures/gcp-incidents.json";
// REAL capture of Oracle's components_v2.json, trimmed to two regions × three
// services. Everything was NormalPerformance; the degraded case below is DERIVED.
import oci from "@/tests/fixtures/oci-components-v2.json";
import {
  CLOUD_VENDORS,
  decodeAwsBody,
  indicatorColor,
  indicatorMagnitude,
  normalizeAwsEvents,
  normalizeAzureRss,
  normalizeCloudStatus,
  normalizeFastlyRss,
  normalizeGoogleIncidents,
  normalizeOciHealth,
  pageMatchesVendor,
  parseIndicator,
  parseRssItems,
  placeByCity,
  placeByPop,
  placeByRegionLabel,
  type AwsHealthEvent,
  type GoogleIncident,
  type OciHealth,
  type StatuspageSummary,
} from "@/lib/signals/cloud-status";
import { azureRegionIn, regionFromLabel } from "@/lib/signals/cloud-regions.data";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
// REAL capture of www.fastlystatus.com/rss (2026-10-16 ~20:57 UTC), the first 12 items.
const fastlyRss = fixture("fastly-status.rss.xml");
// REAL capture of Azure's status RSS on the same evening: valid, and EMPTY.
const azureEmpty = fixture("azure-status-empty.rss.xml");

const vendor = CLOUD_VENDORS[0];
const NOW = Date.parse("2026-10-16T21:00:00Z");
const byKey = (k: string) => CLOUD_VENDORS.find((v) => v.key === k)!;

describe("parseIndicator", () => {
  it("accepts the five documented indicators and rejects anything else", () => {
    for (const v of ["none", "minor", "major", "critical", "maintenance"]) {
      expect(parseIndicator(v)).toBe(v);
    }
    expect(parseIndicator("catastrophic")).toBeNull();
    expect(parseIndicator(undefined)).toBeNull();
    expect(parseIndicator("")).toBeNull();
  });
});

describe("normalizeCloudStatus", () => {
  // The layer's job is to be EMPTY until something is actually wrong. Permanent
  // green dots would be decoration, and would make a real outage harder to spot.
  it("emits nothing for a healthy vendor", () => {
    expect(normalizeCloudStatus(vendor, operational as StatuspageSummary)).toEqual([]);
  });

  it("emits nothing when the indicator is missing or unrecognised", () => {
    expect(normalizeCloudStatus(vendor, {} as StatuspageSummary)).toEqual([]);
    expect(normalizeCloudStatus(vendor, { status: { indicator: "weird" } })).toEqual([]);
  });

  it("maps a degraded vendor that names no place to one head-office pin that says so", () => {
    const out = normalizeCloudStatus(vendor, degraded as StatuspageSummary, NOW);
    expect(out).toHaveLength(1);
    const f = out[0];
    expect(f.id).toBe("cloud-status:github");
    expect(f.signalId).toBe("cloud-status");
    expect(f.title).toBe("GitHub — Partial Service Disruption");
    // The severity is theirs, not ours.
    expect(f.props?.severity).toBe("major");
    expect(f.props?.statusText).toBe("Partial Service Disruption");
    expect(f.props?.openIncident).toBe("Elevated error rates for Git operations");
    expect(f.props?.incidentStage).toBe("investigating");
    expect(f.link).toBe("https://stspg.io/EXAMPLE");
    expect(f.ts).toBe("2026-08-10T09:14:00.000Z");
    expect(f.lat).toBe(vendor.lat);
    expect(f.precision).toBe("facility");
    expect(String(f.props?.placement)).toMatch(/NOT where it is/);
  });

  it("lists only the components that are actually degraded", () => {
    const f = normalizeCloudStatus(vendor, degraded as StatuspageSummary, NOW)[0];
    expect(f.props?.affectedCount).toBe(2); // the third component is operational
    expect(String(f.props?.affectedComponents)).not.toMatch(/,\s*$/);
  });

  it("says so plainly when the vendor itemises nothing", () => {
    const f = normalizeCloudStatus(vendor, {
      status: { indicator: "minor", description: "Degraded Performance" },
    })[0];
    expect(f.props?.affectedCount).toBe(0);
    expect(f.props?.affectedComponents).toBe("not itemised by the vendor");
  });

  it("pins each degraded Cloudflare PoP at its own airport, not at the head office", () => {
    const out = normalizeCloudStatus(byKey("cloudflare"), cloudflare as StatuspageSummary, NOW);
    const pops = out.filter((f) => f.props?.placement === "the point of presence the vendor names (its airport code)");
    // 59 degraded PoPs in the capture; every one has an airport row.
    expect(pops).toHaveLength(59);
    const arica = pops.find((f) => String(f.title).startsWith("Cloudflare — Arica (ARI)"))!;
    expect(arica.title).toBe("Cloudflare — Arica (ARI): major outage");
    expect(arica.precision).toBe("area");
    expect(arica.lat).toBeCloseTo(-18.35, 1);
    // The one component that names no place (WARP) is the only thing left on the
    // head office, and that pin says so.
    const hq = out.find((f) => f.id === "cloud-status:cloudflare")!;
    expect(hq.props?.affectedComponents).toBe("WARP");
    expect(out).toHaveLength(60);
    // The WARP incident has been open since 2026-08-27: it is marked, not hidden.
    expect(arica.props?.longRunning).toBe("open since 2026-08-27");
  });

  it("pins Snowflake's degraded components in the cloud region their group names", () => {
    const out = normalizeCloudStatus(byKey("snowflake"), snowflake as StatuspageSummary, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Snowflake — GCP us-central1 (Iowa): degraded performance");
    expect(out[0].props?.affectedCount).toBe(2);
    expect(out[0].lat).toBeCloseTo(41.26, 1);
  });
});

describe("severity presentation", () => {
  it("orders magnitude by severity without exaggerating the spread", () => {
    expect(indicatorMagnitude("critical")).toBeGreaterThan(indicatorMagnitude("major"));
    expect(indicatorMagnitude("major")).toBeGreaterThan(indicatorMagnitude("minor"));
    expect(indicatorMagnitude("minor")).toBeGreaterThan(indicatorMagnitude("maintenance"));
    expect(indicatorMagnitude("none")).toBe(0);
    // Maintenance is planned, so it must never outrank a real fault.
    expect(indicatorMagnitude("maintenance")).toBeLessThan(indicatorMagnitude("minor"));
  });

  it("gives every indicator a distinct colour", () => {
    const colours = (["none", "minor", "major", "critical", "maintenance"] as const).map(indicatorColor);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe("the vendor list", () => {
  it("has unique keys and hosts, and plausible coordinates", () => {
    expect(new Set(CLOUD_VENDORS.map((v) => v.key)).size).toBe(CLOUD_VENDORS.length);
    expect(new Set(CLOUD_VENDORS.map((v) => v.host)).size).toBe(CLOUD_VENDORS.length);
    for (const v of CLOUD_VENDORS) {
      expect(Math.abs(v.lat), `${v.key} latitude`).toBeLessThanOrEqual(90);
      expect(Math.abs(v.lon), `${v.key} longitude`).toBeLessThanOrEqual(180);
      expect(v.lat === 0 && v.lon === 0, `${v.key} is at null island`).toBe(false);
    }
  });
});

describe("a status host that redirects to another vendor", () => {
  // status.sendgrid.com 302s to status.twilio.com (measured 2026-10-16), and fetch()
  // follows it, so prod showed Twilio's incident a second time as "SendGrid".
  const twilioPage = { page: { name: "Twilio", url: "https://status.twilio.com" }, status: { indicator: "minor" } };

  it("is refused when the page names another host", () => {
    const sendgrid = { key: "sendgrid", label: "SendGrid", host: "status.sendgrid.com", lat: 39.7, lon: -105 };
    expect(pageMatchesVendor(sendgrid, twilioPage)).toBe(false);
  });

  it("is accepted when the page is the vendor's own", () => {
    expect(pageMatchesVendor(byKey("twilio"), twilioPage)).toBe(true);
    expect(pageMatchesVendor(vendor, operational as StatuspageSummary)).toBe(true);
  });

  it("is no longer polled, and the hollow Atlassian page is replaced by its product pages", () => {
    const hosts = CLOUD_VENDORS.map((v) => v.host);
    expect(hosts).not.toContain("status.sendgrid.com");
    expect(hosts).not.toContain("status.atlassian.com");
    expect(hosts).toEqual(
      expect.arrayContaining([
        "jira-software.status.atlassian.com",
        "confluence.status.atlassian.com",
        "bitbucket.status.atlassian.com",
        "www.akamaistatus.com",
      ]),
    );
  });
});

describe("placement helpers", () => {
  it("reads both PoP spellings", () => {
    expect(placeByPop("Sydney, NSW, Australia - (SYD)")?.where).toBe("Sydney (SYD)");
    expect(placeByPop("Toronto (YYZ)")?.where).toBe("Toronto (YYZ)");
    expect(placeByPop("Git Operations")).toBeNull();
    expect(placeByPop("Nowhere (ZZZ)")).toBeNull();
  });

  it("finds a PoP by city when its code is not an airport code", () => {
    expect(placeByCity("Singapore", "QPG")?.where).toBe("Singapore (QPG)");
    expect(placeByCity("Delhi", "QAG")?.lat).toBeCloseTo(28.56, 1);
    expect(placeByCity("Atlantis")).toBeNull();
  });

  it("reads cloud regions the way status pages write them", () => {
    expect(regionFromLabel("GCP - US Central 1 (Iowa)")?.id).toBe("us-central1");
    expect(regionFromLabel("AWS - US West 2 (Oregon)")?.id).toBe("us-west-2");
    expect(regionFromLabel("Azure - East US 2 (Virginia)")?.place).toBe("East US 2");
    expect(placeByRegionLabel("Snowpark")).toBeNull();
  });

  it("prefers the longer Azure region name", () => {
    expect(azureRegionIn("Virtual Machines - East US 2")?.place).toBe("East US 2");
    expect(azureRegionIn("Storage - East US")?.place).toBe("East US");
    expect(azureRegionIn("Azure Front Door - Multiple regions")).toBeUndefined();
  });
});

describe("AWS", () => {
  it("decodes the UTF-16 body AWS sends", () => {
    const text = '[{"arn":"x"}]';
    const be = new Uint8Array(2 + text.length * 2);
    be[0] = 0xfe;
    be[1] = 0xff;
    for (let i = 0; i < text.length; i++) be[2 + i * 2 + 1] = text.charCodeAt(i);
    expect(JSON.parse(decodeAwsBody(be.buffer))).toEqual([{ arn: "x" }]);
    expect(decodeAwsBody(new TextEncoder().encode(text).buffer as ArrayBuffer)).toBe(text);
  });

  it("pins each open event in the region its ARN names", () => {
    const out = normalizeAwsEvents(aws as unknown as AwsHealthEvent[], NOW);
    expect(out.map((f) => f.title)).toEqual([
      "AWS — me-central-1 (UAE): Region Availability",
      "AWS — me-south-1 (Bahrain): Region Availability",
    ]);
    expect(out.every((f) => f.props?.severity === "major" && f.precision === "area")).toBe(true);
    expect(out[0].props?.longRunning).toBe("open since 2026-03-01");
    expect(out[1].lat).toBeCloseTo(26.07, 1);
  });
});

describe("Google", () => {
  it("emits nothing for incidents that have ended", () => {
    expect(normalizeGoogleIncidents(gcp as GoogleIncident[], "gcp", NOW)).toEqual([]);
  });

  it("pins an open incident in each region it currently affects", () => {
    const open = { ...(gcp as GoogleIncident[])[0], end: null, currently_affected_locations: [{ id: "us-central1" }, { id: "europe-west4" }] };
    const out = normalizeGoogleIncidents([open], "gcp", NOW);
    expect(out.map((f) => f.title)).toEqual([
      "Google Cloud — us-central1 (Iowa): Google Cloud Storage",
      "Google Cloud — europe-west4 (Netherlands): Google Cloud Storage",
    ]);
    expect(new Set(out.map((f) => f.id)).size).toBe(2);
  });

  it("puts a Workspace incident, which names no region, at the head office", () => {
    const out = normalizeGoogleIncidents([{ id: "w1", begin: "2026-10-16T20:00:00Z", end: null, severity: "low", service_name: "Gmail" }], "workspace", NOW);
    expect(out).toHaveLength(1);
    expect(out[0].precision).toBe("facility");
    expect(out[0].title).toBe("Google Workspace — Gmail");
  });
});

describe("RSS readers", () => {
  it("reads Azure's empty feed as no events", () => {
    expect(parseRssItems(azureEmpty)).toEqual([]);
    expect(normalizeAzureRss(azureEmpty)).toEqual([]);
  });

  it("places an Azure event by the region in its title", () => {
    // DERIVED: the empty capture above with one item in standard RSS 2.0 form.
    const xml = azureEmpty.replace(
      "</channel>",
      "<item><title>Virtual Machines - West Europe</title><link>https://azure.status.microsoft/en-us/status/</link><description>Customers may see errors.</description><pubDate>Fri, 16 Oct 2026 20:00:00 Z</pubDate></item></channel>",
    );
    const out = normalizeAzureRss(xml);
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBeCloseTo(52.37, 1);
    expect(out[0].precision).toBe("area");
  });

  it("drops Fastly incidents whose newest update closes them", () => {
    // At capture time every incident in the 12 items was resolved or completed.
    expect(normalizeFastlyRss(fastlyRss, NOW)).toEqual([]);
  });

  it("shows a Fastly incident while it is open, at its PoP", () => {
    // Replay the feed as of 2026-10-13 02:55 UTC: Singapore (QPG) had one update,
    // "We are investigating elevated errors".
    const out = normalizeFastlyRss(fastlyRss, Date.parse("2026-10-13T02:55:00Z"));
    const sg = out.find((f) => String(f.title).includes("Singapore"))!;
    expect(sg.title).toBe("Fastly — Elevated Errors for Singapore (QPG)");
    expect(sg.precision).toBe("area");
    expect(sg.lat).toBeCloseTo(1.35, 1);
    expect(sg.props?.severity).toBe("minor");
  });
});

describe("Oracle Cloud", () => {
  it("emits nothing when every service is at normal performance", () => {
    expect(normalizeOciHealth(oci as OciHealth)).toEqual([]);
  });

  it("pins a region with a degraded service at that region", () => {
    // DERIVED: the capture with one service status changed.
    const d = JSON.parse(JSON.stringify(oci)) as OciHealth;
    d.regionHealthReports![0].serviceHealthReports![1].serviceStatus = "ServiceDisruption";
    const out = normalizeOciHealth(d);
    expect(out).toHaveLength(1);
    expect(out[0].props?.severity).toBe("major");
    expect(out[0].precision).toBe("area");
  });
});
