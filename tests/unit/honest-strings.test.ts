// Regression coverage for the "four user-visible strings that are false" fixes:
//   1. lib/sources/catalog.ts   — planes credited to their real current source
//                                 (adsb.lol), not the OpenSky feed removed on
//                                 licensing grounds (2026-08-31: this test itself
//                                 had asserted the stale direction — see below)
//   2. lib/sources/windy.ts     — the MAX_WEBCAMS cap is disclosed via
//                                 lib/signals/coverage.ts, not silent
//   3. lib/export.ts            — downloaded files carry OUR name, not the
//                                 competitor's (already fixed pre-existing; guarded here)
//   4. lib/events/alerting.ts   — outbound webhook source line carries OUR
//                                 brand, not the competitor's (already fixed pre-existing; guarded here)
//   5. lib/console/widgets/aviation.tsx + lib/console/help.ts — the aviation
//                                 widget's own help popover and trust card still
//                                 credited "OpenSky" (a single global snapshot, an
//                                 anonymous credit cap) two places after #1 fixed
//                                 the short catalog attribution string. Same root
//                                 cause, later found: OpenSky was removed from the
//                                 live fetch path entirely (lib/sources/opensky.ts),
//                                 adsb.lol's bounded grid sweep is the sole source.
import { afterEach, expect, test } from "vitest";
import { getCatalogSource } from "@/lib/sources/catalog";
import {
  fetchWebcams,
  planPageJobs,
  WINDY_REGIONS,
  PAGES_PER_REGION,
  LIMIT,
  type WindyWebcam,
} from "@/lib/sources/windy";
import { readCoverage } from "@/lib/signals/coverage";
import { exportFilename } from "@/lib/export";
import { postWebhook, type AlertHit } from "@/lib/events/alerting";
import { BRAND } from "@/lib/brand";
import { AVIATION_WIDGET } from "@/lib/console/widgets/aviation";
import { widgetExplainerFor } from "@/lib/console/help";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- 1. catalog.ts: planes attribution --------------------------------------
//
// This test used to assert the OPPOSITE of what was true: it required "OpenSky"
// and forbade "adsb.lol", which meant it was pinned to the bug rather than
// guarding against it. OpenSky's global snapshot was removed on licensing
// grounds and production has been served entirely by the adsb.lol grid sweep
// for months (app/api/planes/route.ts) — the catalog entry just kept crediting
// the feed that no longer runs. Fixed here alongside lib/sources/catalog.ts and
// components/shell/SourceCatalog.tsx's LAYER_META, which had the same string.

test("the planes catalog entry credits adsb.lol, its real current source", () => {
  const planes = getCatalogSource("planes");
  expect(planes).toBeDefined();
  expect(planes!.attribution.toLowerCase()).toContain("adsb.lol");
  expect(planes!.attribution).not.toContain("OpenSky");
});

// --- 1b. aviation widget help + trust card: same fix, two places found later ---
//
// #1 above fixed the short catalog attribution string. Two more places credited
// the same removed feed: the aviation widget's own "?" popover source line, and
// three sentences in its trust card describing OpenSky-specific mechanism (a
// single global /states/all snapshot, an anonymous credit cap) that do not
// describe how adsb.lol's bounded grid sweep actually works. Guard both so
// neither can drift back to naming the removed feed.

test("the aviation widget's help.source credits adsb.lol, not OpenSky", () => {
  const source = AVIATION_WIDGET.help?.source ?? "";
  expect(source.toLowerCase()).toContain("adsb.lol");
  expect(source).not.toContain("OpenSky");
});

test("the aviation trust card describes adsb.lol's real mechanism, not OpenSky's", () => {
  const e = widgetExplainerFor("aviation");
  expect(e).toBeDefined();
  const text = [e!.method, e!.coverage, ...e!.limitations].join(" ");
  expect(text).not.toContain("OpenSky");
  expect(text.toLowerCase()).toContain("adsb.lol");
  // The false "single global snapshot" claim must not survive as a description
  // of how data is currently gathered — it's a bounded grid sweep instead.
  expect(e!.method).toMatch(/grid sweep/i);
  expect(e!.coverage).toMatch(/grid sweep/i);
  // The false "OpenSky anonymous credit cap" reason for the shared cadence must
  // not survive; the real constraint is adsb.lol's own rate limit.
  expect(e!.limitations.join(" ")).toMatch(/adsb\.lol rate-limits/i);
  // These structural facts are unchanged by the fix and must still hold.
  expect(e!.limitations.join(" ")).toMatch(/no military flag/i);
  expect(e!.limitations.join(" ")).toMatch(/refreshed roughly every four minutes/i);
});

// --- 2. windy.ts: undisclosed cap --------------------------------------------

/** Stub global fetch so every Windy region/page request returns `rowsPerPage`
 *  freshly-numbered webcams (globally unique ids across the whole run). */
function stubWindyFetch(rowsPerPage: number) {
  let counter = 0;
  globalThis.fetch = (async () => {
    const webcams: WindyWebcam[] = Array.from({ length: rowsPerPage }, () => {
      counter += 1;
      return {
        webcamId: counter,
        status: "active",
        location: { latitude: 0, longitude: (counter % 360) - 180 },
      } satisfies WindyWebcam;
    });
    return new Response(JSON.stringify({ webcams }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// Derived from the registry, not hard-coded: regions carry per-region `pages`
// overrides now, so "14 × 2" is no longer the request count and any literal here
// would break every time a region is added rather than testing the disclosure.
const REQUESTS = planPageJobs(WINDY_REGIONS, PAGES_PER_REGION, LIMIT).length;

test("fetchWebcams discloses the cap when the merged sample exceeds it", async () => {
  // 100 unique rows per request, which is comfortably over the 2,000 safety cap.
  stubWindyFetch(100);
  const result = await fetchWebcams("fake-test-key");
  expect(result.length).toBe(2000);

  const coverage = readCoverage(result);
  expect(coverage).toBeDefined();
  expect(coverage!.capped).toBe(true);
  expect(coverage!.available).toBe(REQUESTS * 100);
  expect(coverage!.cap).toBe(2000);
  expect(coverage!.noun).toBe("webcams");
});

test("fetchWebcams does NOT claim a cap when the sample is under it", async () => {
  // 1 row per request — well under the cap however many regions are registered.
  stubWindyFetch(1);
  const result = await fetchWebcams("fake-test-key");
  expect(result.length).toBe(REQUESTS);

  const coverage = readCoverage(result);
  expect(coverage).toBeDefined();
  expect(coverage!.capped).toBe(false);
  expect(coverage!.available).toBe(REQUESTS);
});

test("fetchWebcams stays dormant-safe with no key configured (no network call)", async () => {
  globalThis.fetch = (() => {
    throw new Error("fetchWebcams must not call fetch when no key is configured");
  }) as unknown as typeof fetch;
  const result = await fetchWebcams(undefined);
  expect(result).toEqual([]);
});

// --- 3. export.ts: filename prefix (regression guard) -----------------------

test("exportFilename carries our own product prefix, never the competitor's", () => {
  const name = exportFilename("cameras", Date.now());
  expect(name.startsWith("opendata-")).toBe(true);
  expect(name.toLowerCase()).not.toContain("worldmonitor");
});

// --- 4. alerting.ts: outbound webhook source (regression guard) -------------

test("postWebhook sends our own brand as the alert source, never the competitor's", async () => {
  let captured: { source?: string } | null = null;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    captured = JSON.parse((init?.body as string) ?? "{}");
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  const hit: AlertHit = {
    eventId: "e1",
    title: "Test event",
    tier: "S3",
    type: "quake",
    assetId: "a1",
    assetName: "HQ",
    distanceKm: 12.3,
  };
  await postWebhook("https://example.com/hook", hit);

  expect(captured).not.toBeNull();
  expect(captured!.source).toBe(`${BRAND.name} · Disasters & Events`);
  expect(captured!.source?.toLowerCase()).not.toContain("world monitor");
});
