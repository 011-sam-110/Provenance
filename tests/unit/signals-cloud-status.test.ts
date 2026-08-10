import { describe, expect, it } from "vitest";
// `statuspage-github-operational.json` is a REAL capture of
// https://www.githubstatus.com/api/v2/summary.json (2026-08-10), trimmed to the
// page/status block and the first three components.
// `statuspage-degraded.json` is DERIVED from that same capture: identical shape,
// with the indicator and two component statuses changed to exercise the degraded
// path. GitHub was operational at capture time and we do not wait for an outage
// to test our handling of one — but nothing here is invented from scratch.
import operational from "@/tests/fixtures/statuspage-github-operational.json";
import degraded from "@/tests/fixtures/statuspage-degraded.json";
import {
  CLOUD_VENDORS,
  indicatorColor,
  indicatorMagnitude,
  normalizeCloudStatus,
  parseIndicator,
  type StatuspageSummary,
} from "@/lib/signals/cloud-status";

const vendor = CLOUD_VENDORS[0];

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
  // The layer's job is to be EMPTY until something is actually wrong. Fourteen
  // permanent green dots would be decoration, and would make a real outage harder
  // to spot rather than easier.
  it("emits nothing for a healthy vendor", () => {
    expect(normalizeCloudStatus(vendor, operational as StatuspageSummary)).toBeNull();
  });

  it("emits nothing when the indicator is missing or unrecognised", () => {
    expect(normalizeCloudStatus(vendor, {} as StatuspageSummary)).toBeNull();
    expect(normalizeCloudStatus(vendor, { status: { indicator: "weird" } })).toBeNull();
  });

  it("maps a degraded vendor to a feature carrying the vendor's own words", () => {
    const f = normalizeCloudStatus(vendor, degraded as StatuspageSummary)!;
    expect(f).not.toBeNull();
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
  });

  it("lists only the components that are actually degraded", () => {
    const f = normalizeCloudStatus(vendor, degraded as StatuspageSummary)!;
    expect(f.props?.affectedCount).toBe(2); // the third component is operational
    expect(String(f.props?.affectedComponents)).not.toMatch(/,\s*$/);
  });

  it("says so plainly when the vendor itemises nothing", () => {
    const f = normalizeCloudStatus(vendor, {
      status: { indicator: "minor", description: "Degraded Performance" },
    })!;
    expect(f.props?.affectedCount).toBe(0);
    expect(f.props?.affectedComponents).toBe("not itemised by the vendor");
  });

  it("pins at the vendor HQ, which is a placement of convenience, not a location", () => {
    const f = normalizeCloudStatus(vendor, degraded as StatuspageSummary)!;
    expect(f.lat).toBe(vendor.lat);
    expect(f.lon).toBe(vendor.lon);
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
