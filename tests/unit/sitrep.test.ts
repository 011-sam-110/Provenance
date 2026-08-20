import { expect, test } from "vitest";
import {
  coord,
  describeScope,
  isBlindState,
  layerLine,
  sitrepFilename,
  toSitrepMarkdown,
  utcStamp,
  type SitrepInput,
  type SitrepLayer,
} from "@/lib/export/sitrep";

const AT = Date.UTC(2026, 7, 20, 14, 35, 12, 480); // 2026-08-20T14:35:12.480Z

function layer(over: Partial<SitrepLayer> = {}): SitrepLayer {
  return {
    id: "earthquakes",
    title: "Earthquakes",
    state: "live",
    count: 12,
    providers: [{ label: "USGS", href: "https://earthquake.usgs.gov/" }],
    ...over,
  };
}

function input(over: Partial<SitrepInput> = {}): SitrepInput {
  return {
    generatedAt: AT,
    product: { name: "Provenance", url: "https://provenance-online.vercel.app" },
    scope: { mode: "world", label: "World" },
    view: { center: [-0.1276, 51.5072], zoom: 4.5 },
    layers: [layer()],
    ...over,
  };
}

test("utcStamp is second-precision UTC and drops milliseconds", () => {
  expect(utcStamp(AT)).toBe("2026-08-20T14:35:12Z");
});

test("coord fixes precision at 4dp rather than dumping float noise", () => {
  expect(coord(51.50722935)).toBe("51.5072");
  expect(coord(-0.1)).toBe("-0.1000");
});

test("sitrepFilename is sortable and filesystem-safe", () => {
  expect(sitrepFilename(AT)).toBe("provenance-sitrep-20260820T143512Z.md");
  expect(sitrepFilename(AT)).not.toMatch(/[:\\/]/);
});

// ---------------------------------------------------------------------------
// Rule 1: a layer we could not see is never silently dropped.
// ---------------------------------------------------------------------------

test("blind states are exactly the ones where we could not see, not the empty ones", () => {
  expect(isBlindState("down")).toBe(true);
  expect(isBlindState("stale")).toBe(true);
  expect(isBlindState("refused")).toBe(true);
  expect(isBlindState("locked")).toBe(true);
  // Saw nothing is NOT the same as could not see.
  expect(isBlindState("empty")).toBe(false);
  expect(isBlindState("live")).toBe(false);
  expect(isBlindState("dormant")).toBe(false);
});

test("a down layer appears in the report, under a heading that says why it matters", () => {
  const md = toSitrepMarkdown(
    input({ layers: [layer(), layer({ id: "acled", title: "ACLED conflict", state: "down", count: null })] }),
  );
  expect(md).toContain("## Layers that could not be seen");
  expect(md).toContain("ACLED conflict");
  expect(md).toContain("gap in coverage, not evidence of quiet");
  // and it is NOT listed among the layers that reported
  const reporting = md.slice(md.indexOf("## Layers reporting"), md.indexOf("## Layers that could not"));
  expect(reporting).not.toContain("ACLED conflict");
});

test("with nothing blind, the section says so rather than vanishing", () => {
  const md = toSitrepMarkdown(input());
  expect(md).toContain("## Layers that could not be seen");
  expect(md).toContain("Every layer switched on in this view was answering.");
});

// ---------------------------------------------------------------------------
// Rule 2: "we counted zero" and "we did not count" must never merge.
// ---------------------------------------------------------------------------

test("a null count prints as not counted, never as zero", () => {
  expect(layerLine(layer({ count: null }))).toContain("not counted");
  expect(layerLine(layer({ count: null }))).not.toContain("0 features");
  expect(layerLine(layer({ count: 0 }))).toContain("0 features in view");
});

test("counts are always qualified as in-view, never presented as world totals", () => {
  const md = toSitrepMarkdown(input());
  expect(md).toContain("12 features in view");
  expect(md).toContain("Counts are of features rendered in this view");
  expect(md).toContain("not counts of events in the world");
});

test("the total only sums layers that actually reported", () => {
  const md = toSitrepMarkdown(
    input({
      layers: [
        layer({ count: 12 }),
        layer({ id: "floods", title: "Floods", count: 3 }),
        // Blind layers contribute nothing to a total that claims to be observed.
        layer({ id: "acled", title: "ACLED", state: "down", count: 999 }),
      ],
    }),
  );
  expect(md).toContain("15 across 2 reporting layers");
  expect(md).not.toContain("1014");
});

test("a singular count reads as one feature, one layer", () => {
  const md = toSitrepMarkdown(input({ layers: [layer({ count: 1 })] }));
  expect(md).toContain("1 feature in view");
  expect(md).toContain("across 1 reporting layer");
});

// ---------------------------------------------------------------------------
// Rule 3: no analysis, and it says so.
// ---------------------------------------------------------------------------

test("the document never grows an assessment, summary or ranking heading", () => {
  const md = toSitrepMarkdown(
    input({ layers: [layer(), layer({ id: "floods", title: "Floods", state: "down", count: null })] }),
  );
  for (const banned of ["## Assessment", "## Summary", "## Analysis", "## Key judgements", "## Conclusion"]) {
    expect(md).not.toContain(banned);
  }
  expect(md).toContain("No analysis has been applied");
  expect(md).toContain("not thereby related");
  expect(md).toContain("not an assessment");
});

test("every document is dated in its title, its view block and its expiry note", () => {
  const md = toSitrepMarkdown(input());
  expect(md.match(/2026-08-20T14:35:12Z/g)?.length).toBeGreaterThanOrEqual(3);
  expect(md).toContain("It expires.");
});

// ---------------------------------------------------------------------------
// Attribution — the product is called Provenance; a source line is the point.
// ---------------------------------------------------------------------------

test("a licence rides into the source line with its deed URL", () => {
  const line = layerLine(
    layer({
      providers: [
        {
          label: "UNHCR",
          href: "https://data.unhcr.org/",
          licence: { label: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
        },
      ],
    }),
  );
  expect(line).toContain("UNHCR (https://data.unhcr.org/, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/)");
});

test("a layer with no provider says so rather than inventing one", () => {
  expect(layerLine(layer({ providers: [] }))).toContain("no published source on record");
});

test("a composite layer lists every contributing provider", () => {
  const line = layerLine(
    layer({
      providers: [
        { label: "GDELT", href: "https://www.gdeltproject.org/" },
        { label: "ACLED", href: "https://acleddata.com/" },
      ],
    }),
  );
  expect(line).toContain("GDELT (https://www.gdeltproject.org/)");
  expect(line).toContain("ACLED (https://acleddata.com/)");
});

// ---------------------------------------------------------------------------
// Scope — an unbounded scope must confess that it is unbounded.
// ---------------------------------------------------------------------------

test("describeScope states the filter, and admits when there is none", () => {
  expect(describeScope({ mode: "world", label: "World" })).toContain("no geographic filter");
  expect(
    describeScope({ mode: "region", label: "Brighton", radiusKm: 250, center: { lat: 50.82, lon: -0.14 } }),
  ).toBe("Brighton - within 250 km of 50.8200, -0.1400");
  expect(describeScope({ mode: "aoi", label: "Drawn area", bbox: [-1, 50, 1, 52] })).toBe(
    "Drawn area - area -1.0000, 50.0000, 1.0000, 52.0000 (W, S, E, N)",
  );
  // A malformed scope admits everything (see lib/shell/scope withinScope) - so the
  // document must not imply the numbers were filtered.
  expect(describeScope({ mode: "region", label: "Brighton" })).toContain("unbounded");
  expect(describeScope({ mode: "aoi", label: "Drawn area" })).toContain("unbounded");
});

test("the view block relocates the map: centre as lat, lon and the zoom", () => {
  const md = toSitrepMarkdown(input({ view: { center: [-0.1276, 51.5072], zoom: 4.5, basemap: "Dark" } }));
  expect(md).toContain("Map centre: 51.5072, -0.1276 at zoom 4.50");
  expect(md).toContain("Basemap: Dark");
});

test("an empty board still produces a valid document with an honest layers section", () => {
  const md = toSitrepMarkdown(input({ layers: [] }));
  expect(md).toContain("No layer in this view was answering at capture time.");
  expect(md).toContain("0 across 0 reporting layers");
});
