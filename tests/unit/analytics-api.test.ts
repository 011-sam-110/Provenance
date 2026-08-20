// The Vercel Web Analytics client: URL construction, failure typing, and the two
// live response values that mean something other than what they look like.
//
// Every fixture here is a REAL response or a REAL error body, captured from
// api.vercel.com on 2026-08-19 against projectId prj_PEFRuo9AZYtxN9WmY3a1cyiWlGRQ.
// The refusal strings are quoted on screen, so if one drifts the page starts
// misquoting Vercel — which is exactly the kind of small lie this repo pins down.

import { describe, it, expect } from "vitest";
import {
  ANALYTICS_ENV,
  buildQueryUrl,
  countVisits,
  dimensionLabel,
  extractApiMessage,
  isOthersBucket,
  type AggregateRow,
} from "@/lib/analytics/vercelApi";
import { MEASURED_REFUSALS, MAX_DISTINCT_PER_QUERY } from "@/lib/analytics/limits";

const CREDS = { projectId: "prj_test", teamId: "team_test" };
const RANGE = { since: new Date("2026-07-20T00:00:00Z"), until: new Date("2026-08-19T00:00:00Z") };

describe("buildQueryUrl", () => {
  it("targets the documented endpoint and carries the identifying params", () => {
    const u = new URL(buildQueryUrl("visits/count", CREDS, RANGE));
    expect(u.origin + u.pathname).toBe("https://api.vercel.com/v1/query/web-analytics/visits/count");
    expect(u.searchParams.get("projectId")).toBe("prj_test");
    expect(u.searchParams.get("teamId")).toBe("team_test");
    expect(u.searchParams.get("since")).toBe("2026-07-20T00:00:00.000Z");
  });

  // A wrong `by` encoding does not error. It returns a differently-shaped result that
  // renders as a perfectly plausible chart of the wrong thing, so it is pinned.
  it("repeats `by` once per dimension rather than joining them", () => {
    const u = new URL(buildQueryUrl("visits/aggregate", CREDS, { ...RANGE, by: ["country", "deviceType"] }));
    expect(u.searchParams.getAll("by")).toEqual(["country", "deviceType"]);
    expect(u.search).toContain("by=country&by=deviceType");
  });

  it("omits by, filter and limit entirely when they were not asked for", () => {
    const u = new URL(buildQueryUrl("visits/count", CREDS, RANGE));
    expect(u.searchParams.has("by")).toBe(false);
    expect(u.searchParams.has("filter")).toBe(false);
    expect(u.searchParams.has("limit")).toBe(false);
  });

  it("passes an OData filter through unmangled, brackets and quotes included", () => {
    const u = new URL(buildQueryUrl("visits/aggregate", CREDS, { ...RANGE, filter: "route eq '/camera/[id]'" }));
    expect(u.searchParams.get("filter")).toBe("route eq '/camera/[id]'");
  });

  it("clamps limit to the API ceiling instead of sending a value that would be rejected", () => {
    const u = new URL(buildQueryUrl("visits/aggregate", CREDS, { ...RANGE, by: ["route"], limit: 5000 }));
    expect(u.searchParams.get("limit")).toBe(String(MAX_DISTINCT_PER_QUERY));
  });
});

describe("extractApiMessage", () => {
  // The three bodies below are verbatim from live 402/400 responses on 2026-08-19.
  it("lifts the message out of a real 402 for custom events", () => {
    const body = { error: { code: "payment_required", message: "Accessing Analytics custom events requires an Enterprise or Pro plan." } };
    expect(extractApiMessage(body, 402)).toBe("Accessing Analytics custom events requires an Enterprise or Pro plan.");
  });

  it("lifts the message out of a real 400 for the retention window", () => {
    const body = { error: { code: "bad_request", message: "Invalid request: the hobby plan only grants access to the latest 31 days of data." } };
    expect(extractApiMessage(body, 400)).toContain("latest 31 days of data");
  });

  it("says so plainly when there is no message, rather than inventing one", () => {
    expect(extractApiMessage(null, 500)).toBe("HTTP 500 with no error message in the response body.");
    expect(extractApiMessage({ error: {} }, 503)).toBe("HTTP 503 with no error message in the response body.");
  });
});

// If one of these drifts, the dashboard is putting words in Vercel's mouth inside
// quotation marks. That is worth a red test.
describe("the refusals the UI quotes", () => {
  // Keyed by what was asked, not by status: two of the three refusals are both 402,
  // and keying by status silently collapsed them when this test was first written.
  it("still matches what the API actually said", () => {
    const messages = MEASURED_REFUSALS.map((r) => r.message);
    expect(messages).toContain("Accessing Analytics custom events requires an Enterprise or Pro plan.");
    expect(messages).toContain("UTM dimensions require an Enterprise plan or the Web Analytics Plus add-on.");
    expect(messages).toContain("Invalid request: the hobby plan only grants access to the latest 31 days of data.");
  });

  it("keeps all three, each with the status it was received under", () => {
    expect(MEASURED_REFUSALS).toHaveLength(3);
    expect(MEASURED_REFUSALS.filter((r) => r.status === 402)).toHaveLength(2);
    expect(MEASURED_REFUSALS.filter((r) => r.status === 400)).toHaveLength(1);
  });

  it("dates every quote, so nobody has to guess how stale it is", () => {
    for (const r of MEASURED_REFUSALS) expect(r.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("reading a grouped row", () => {
  // Both of these are real values from the live referrer and country responses.
  const direct: AggregateRow = { referrerHostname: "", visitors: 1463, pageviews: 2780 };
  const reddit: AggregateRow = { referrerHostname: "reddit.com", visitors: 534, pageviews: 614 };
  const overflow: AggregateRow = { country: "Others", visitors: 736, pageviews: 1781 };

  it("does not present an absent referrer as an unnamed website", () => {
    expect(dimensionLabel(direct, "referrerHostname")).toBe("(none)");
    expect(dimensionLabel(reddit, "referrerHostname")).toBe("reddit.com");
  });

  it("recognises the API's overflow bucket so it is never read as a place", () => {
    expect(isOthersBucket(overflow, "country")).toBe(true);
    expect(isOthersBucket(reddit, "referrerHostname")).toBe(false);
  });
});

describe("with no credentials", () => {
  // The whole point of the typed failure: an unconfigured dashboard must be unable to
  // produce a number. Zeroes here would draw a chart asserting the site has no traffic.
  it("reports which variables are missing and returns no data at all", async () => {
    const r = await countVisits(RANGE, {});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.failure.kind).toBe("no-credentials");
    if (r.failure.kind !== "no-credentials") throw new Error("unreachable");
    expect(r.failure.missing).toEqual([...ANALYTICS_ENV]);
    expect(r).not.toHaveProperty("data");
  });

  it("treats a blank string as missing, the way keyRequirements does", async () => {
    const r = await countVisits(RANGE, {
      VERCEL_ANALYTICS_TOKEN: "   ",
      VERCEL_ANALYTICS_PROJECT_ID: "prj_x",
      VERCEL_ANALYTICS_TEAM_ID: "team_x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    if (r.failure.kind !== "no-credentials") throw new Error("expected no-credentials");
    expect(r.failure.missing).toEqual(["VERCEL_ANALYTICS_TOKEN"]);
  });

  it("never puts a credential in the failure it hands the UI", async () => {
    const r = await countVisits(RANGE, {
      VERCEL_ANALYTICS_TOKEN: "sekrit-token-value",
      VERCEL_ANALYTICS_PROJECT_ID: "prj_x",
      VERCEL_ANALYTICS_TEAM_ID: "",
    });
    expect(JSON.stringify(r)).not.toContain("sekrit-token-value");
  });
});
