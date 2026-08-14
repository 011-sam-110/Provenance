import { describe, it, expect } from "vitest";
import type { Camera } from "@/lib/types";
import {
  REGION_PAGE_SIZE,
  SITEMAP_MAX_URLS,
  absoluteUrl,
  cameraDescription,
  cameraPath,
  cameraTitle,
  countryName,
  countryPath,
  countryTitle,
  describeCadence,
  placeLabel,
  regionPageCount,
  regionPath,
  regionTitle,
  slugify,
} from "@/lib/seo/paths";
import {
  buildSitemap,
  camerasInCountry,
  camerasInRegion,
  groupByCountry,
  pageSlice,
  slugCollisions,
} from "@/lib/seo/directory";

function cam(patch: Partial<Camera> = {}): Camera {
  return {
    id: "tfl:JamCams_00002.00865",
    source: "tfl",
    country: "GB",
    region: "London",
    name: "A406 Billet Upass E",
    lat: 51.60067,
    lon: -0.01594,
    mediaType: "jpeg",
    refreshSeconds: 300,
    license: "OGL",
    attribution: "Powered by TfL Open Data",
    available: true,
    ...patch,
  };
}

/** Codepoints, not literals: the source file must stay ASCII (see paths.ts FOLD). */
const ETH = String.fromCodePoint(0x00f0);
const A_ACUTE = String.fromCodePoint(0x00e1);
const O_UMLAUT = String.fromCodePoint(0x00f6);

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("South Carolina")).toBe("south-carolina");
    expect(slugify("Lower Mainland")).toBe("lower-mainland");
  });

  it("collapses runs of punctuation and trims the ends", () => {
    expect(slugify("  A406 / Billet  Upass (E)  ")).toBe("a406-billet-upass-e");
  });

  it("folds accents to their base letter rather than deleting them", () => {
    // Deleting instead of folding turns this into "su-urland", a different URL.
    expect(slugify(`Su${ETH}urland`)).toBe("sudurland");
    expect(slugify(`H${A_ACUTE}${O_UMLAUT}n`)).toBe("haon");
  });

  it("is idempotent, so a slug re-slugified is unchanged", () => {
    const once = slugify("Lower Mainland");
    expect(slugify(once)).toBe(once);
  });

  it("returns an empty string when there is nothing sluggable", () => {
    expect(slugify("---")).toBe("");
  });
});

describe("paths", () => {
  it("percent-encodes the colon in a camera id, giving one canonical shape", () => {
    expect(cameraPath("tfl:JamCams_1")).toBe("/camera/tfl%3AJamCams_1");
  });

  it("puts page 1 at the bare region path so it does not exist at two URLs", () => {
    expect(regionPath("US", "Florida")).toBe("/cameras/us/florida");
    expect(regionPath("US", "Florida", 1)).toBe("/cameras/us/florida");
    expect(regionPath("US", "Florida", 2)).toBe("/cameras/us/florida/2");
  });

  it("lower-cases the country segment", () => {
    expect(countryPath("GB")).toBe("/cameras/gb");
  });

  it("joins an origin without doubling the slash", () => {
    expect(absoluteUrl("https://example.com/", "/cameras")).toBe("https://example.com/cameras");
    expect(absoluteUrl("https://example.com", "/cameras")).toBe("https://example.com/cameras");
  });

  it("counts region pages, never returning zero for an empty region", () => {
    expect(regionPageCount(0)).toBe(1);
    expect(regionPageCount(1)).toBe(1);
    expect(regionPageCount(REGION_PAGE_SIZE)).toBe(1);
    expect(regionPageCount(REGION_PAGE_SIZE + 1)).toBe(2);
    expect(regionPageCount(4838, 500)).toBe(10);
  });

  it("resolves country names from the shared centroid table, falling back to the code", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("br")).toBe("Brazil");
    expect(countryName("ZZ")).toBe("ZZ");
  });
});

describe("page copy", () => {
  it("leads the title with the camera's own name, then the place", () => {
    const t = cameraTitle(cam());
    expect(t.startsWith("A406 Billet Upass E - live traffic camera, London, United Kingdom")).toBe(true);
    expect(t).toContain("Provenance");
  });

  it("gives two different cameras two different titles", () => {
    // The whole point: 20k pages previously shared one site-wide title.
    expect(cameraTitle(cam())).not.toBe(cameraTitle(cam({ name: "M4 J4b", region: "Berkshire" })));
  });

  it("writes a description that stands alone when quoted out of context", () => {
    const d = cameraDescription(cam());
    expect(d).toContain("A406 Billet Upass E");
    expect(d).toContain("London, United Kingdom");
    expect(d).toContain("every 5 minutes");
    expect(d).toContain("Powered by TfL Open Data");
    // No unresolved back-references - the failure mode that makes a page unquotable.
    expect(d).not.toMatch(/\bthis feed\b|\bas above\b|\bthe above\b/i);
  });

  it("says cadence in plain English", () => {
    expect(describeCadence(30)).toBe("every 30 seconds");
    expect(describeCadence(60)).toBe("every minute");
    expect(describeCadence(300)).toBe("every 5 minutes");
  });

  it("falls back to the country alone when a camera has no region", () => {
    expect(placeLabel({ region: undefined, country: "IS" })).toBe("Iceland");
  });

  it("thousands-separates counts in country and region titles", () => {
    expect(countryTitle("US", 14989)).toContain("(14,989)");
    expect(regionTitle("US", "Florida", 4838, 1)).toContain("(4,838)");
    expect(regionTitle("US", "Florida", 4838, 1)).not.toContain("page");
    expect(regionTitle("US", "Florida", 4838, 3)).toContain("page 3");
  });
});

describe("grouping", () => {
  const fleet = [
    cam({ id: "a", country: "GB", region: "London", name: "B" }),
    cam({ id: "b", country: "GB", region: "London", name: "A" }),
    cam({ id: "c", country: "GB", region: "Scotland", name: "C" }),
    cam({ id: "d", country: "US", region: "Florida", name: "D" }),
    cam({ id: "e", country: "US", region: "Florida", name: "E" }),
    cam({ id: "f", country: "US", region: "Georgia", name: "F" }),
    cam({ id: "g", country: "US", region: "Georgia", name: "G" }),
  ];

  it("orders countries by size and regions alphabetically", () => {
    const groups = groupByCountry(fleet);
    expect(groups.map((g) => g.iso2)).toEqual(["US", "GB"]);
    expect(groups[0].count).toBe(4);
    expect(groups[1].regions.map((r) => r.region)).toEqual(["London", "Scotland"]);
  });

  it("carries the slug and page count on every region", () => {
    const gb = groupByCountry(fleet).find((g) => g.iso2 === "GB")!;
    const london = gb.regions.find((r) => r.region === "London")!;
    expect(london.slug).toBe("london");
    expect(london.count).toBe(2);
    expect(london.pages).toBe(1);
  });

  it("matches a region by slug and reports the upstream's own wording", () => {
    const hit = camerasInRegion(fleet, "gb", "london");
    expect(hit?.region).toBe("London");
    expect(hit?.cameras.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("returns null for a slug that matches nothing, so the route can 404", () => {
    expect(camerasInRegion(fleet, "gb", "atlantis")).toBeNull();
    expect(camerasInRegion(fleet, "zz", "london")).toBeNull();
  });

  it("sorts a country's cameras stably regardless of input order", () => {
    const forward = camerasInCountry(fleet, "US").map((c) => c.id);
    const backward = camerasInCountry([...fleet].reverse(), "US").map((c) => c.id);
    expect(forward).toEqual(backward);
  });

  it("slices pages 1-based", () => {
    expect(pageSlice([1, 2, 3, 4, 5], 1, 2)).toEqual([1, 2]);
    expect(pageSlice([1, 2, 3, 4, 5], 3, 2)).toEqual([5]);
    expect(pageSlice([1, 2, 3, 4, 5], 9, 2)).toEqual([]);
  });

  it("reports two region names that would fight over one URL", () => {
    const clash = [
      cam({ id: "x", country: "US", region: "New York" }),
      cam({ id: "y", country: "US", region: "new-york" }),
    ];
    expect(slugCollisions(clash)).toEqual([
      { iso2: "US", slug: "new-york", regions: ["New York", "new-york"] },
    ]);
    expect(slugCollisions(fleet)).toEqual([]);
  });
});

describe("buildSitemap", () => {
  const fleet = [
    cam({ id: "a", country: "GB", region: "London", name: "A" }),
    cam({ id: "b", country: "GB", region: "London", name: "B" }),
    cam({ id: "c", country: "US", region: "Florida", name: "C" }),
  ];
  const ORIGIN = "https://example.com";

  it("includes the root, the directory, every country and every region", () => {
    const urls = buildSitemap(fleet, ORIGIN, ["/app"]).entries.map((e) => e.url);
    expect(urls).toContain("https://example.com/");
    expect(urls).toContain("https://example.com/app");
    expect(urls).toContain("https://example.com/cameras");
    expect(urls).toContain("https://example.com/cameras/gb");
    expect(urls).toContain("https://example.com/cameras/us");
    expect(urls).toContain("https://example.com/cameras/gb/london");
    expect(urls).toContain("https://example.com/cameras/us/florida");
  });

  it("includes one entry per available camera, canonically encoded", () => {
    const urls = buildSitemap(fleet, ORIGIN).entries.map((e) => e.url);
    expect(urls).toContain("https://example.com/camera/a");
    expect(urls.filter((u) => u.startsWith("https://example.com/camera/"))).toHaveLength(3);
  });

  it("leaves unavailable cameras out and says how many", () => {
    const withDead = [...fleet, cam({ id: "dead", available: false, name: "Z" })];
    const result = buildSitemap(withDead, ORIGIN);
    expect(result.skippedUnavailable).toBe(1);
    expect(result.entries.map((e) => e.url)).not.toContain("https://example.com/camera/dead");
  });

  it("only stamps lastModified when the feed actually told us one", () => {
    const stamped = buildSitemap(
      [cam({ id: "s", lastSampledAt: "2026-08-14T10:00:00.000Z" }), cam({ id: "u", name: "U" })],
      ORIGIN,
    );
    const byUrl = new Map(stamped.entries.map((e) => [e.url, e]));
    expect(byUrl.get("https://example.com/camera/s")?.lastModified?.toISOString()).toBe(
      "2026-08-14T10:00:00.000Z",
    );
    expect(byUrl.get("https://example.com/camera/u")?.lastModified).toBeUndefined();
  });

  it("ignores an unparseable lastSampledAt rather than emitting Invalid Date", () => {
    const result = buildSitemap([cam({ id: "bad", lastSampledAt: "not a date" })], ORIGIN);
    const entry = result.entries.find((e) => e.url.endsWith("/camera/bad"));
    expect(entry?.lastModified).toBeUndefined();
  });

  it("emits a page URL for every page of a paginated region", () => {
    const big = Array.from({ length: REGION_PAGE_SIZE * 2 + 1 }, (_, i) =>
      cam({ id: `big-${i}`, country: "US", region: "Florida", name: `C${i}` }),
    );
    const urls = buildSitemap(big, ORIGIN).entries.map((e) => e.url);
    expect(urls).toContain("https://example.com/cameras/us/florida");
    expect(urls).toContain("https://example.com/cameras/us/florida/2");
    expect(urls).toContain("https://example.com/cameras/us/florida/3");
    expect(urls).not.toContain("https://example.com/cameras/us/florida/4");
  });

  it("produces the same camera order however the registry was ordered", () => {
    const a = buildSitemap(fleet, ORIGIN).entries.map((e) => e.url);
    const b = buildSitemap([...fleet].reverse(), ORIGIN).entries.map((e) => e.url);
    expect(a).toEqual(b);
  });

  it("stays inside one sitemap file at today's scale, with headroom", () => {
    // Measured on prod 2026-08-14: 20,246 cameras -> ~20.3k URLs. This asserts the
    // single-file design is still correct and fails loudly, well before the protocol
    // limit, if the registry grows into needing generateSitemaps().
    const fleetSize = 25_000;
    const many = Array.from({ length: fleetSize }, (_, i) =>
      cam({ id: `c-${i}`, country: "US", region: `R${i % 40}`, name: `C${i}` }),
    );
    const result = buildSitemap(many, ORIGIN);
    expect(result.dropped).toBe(0);
    expect(result.total).toBeLessThan(SITEMAP_MAX_URLS);
  });

  it("reports a cap rather than truncating in silence", () => {
    // No silent caps: if the limit ever bites, the count says so.
    const over = Array.from({ length: SITEMAP_MAX_URLS + 10 }, (_, i) =>
      cam({ id: `o-${i}`, country: "US", region: "Florida", name: `C${i}` }),
    );
    const result = buildSitemap(over, ORIGIN);
    expect(result.dropped).toBeGreaterThan(0);
    expect(result.entries).toHaveLength(SITEMAP_MAX_URLS);
    expect(result.total).toBeGreaterThan(SITEMAP_MAX_URLS);
  });
});
