import { describe, it, expect } from "vitest";
import type { Camera } from "@/lib/types";
import {
  buildSitemap,
  buildSitemapShards,
  findShard,
  CORE_SHARD_ID,
} from "@/lib/seo/directory";
import {
  renderSitemapIndex,
  renderUrlset,
  sitemapHeaders,
  w3cDate,
  xmlEscape,
  SITEMAP_STYLESHEET_PATH,
} from "@/lib/seo/xml";

const ORIGIN = "https://provenance-online.vercel.app";

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

describe("xmlEscape — an unescaped ampersand invalidates the whole document", () => {
  it("escapes the five XML entities", () => {
    expect(xmlEscape(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapes ampersands in a URL, which is the case that actually bites", () => {
    // A crawler's parser rejects the FILE, not the offending line, so one raw `&`
    // silently costs every URL in the sitemap.
    expect(xmlEscape("https://x.test/a?b=1&c=2")).toBe("https://x.test/a?b=1&amp;c=2");
  });

  it("leaves already-percent-encoded characters alone", () => {
    expect(xmlEscape("https://x.test/camera/tfl%3AJamCams_1")).toBe(
      "https://x.test/camera/tfl%3AJamCams_1",
    );
  });
});

describe("w3cDate", () => {
  it("emits ISO-8601 for a valid date", () => {
    expect(w3cDate(new Date("2026-08-14T12:00:00.000Z"))).toBe("2026-08-14T12:00:00.000Z");
  });

  it("returns null for undefined or an unparseable value, so the caller omits <lastmod>", () => {
    // Emitting `<lastmod>Invalid Date</lastmod>` is a schema violation; saying
    // nothing is honest and valid.
    expect(w3cDate(undefined)).toBeNull();
    expect(w3cDate("not a date")).toBeNull();
    expect(w3cDate(new Date("nope"))).toBeNull();
  });
});

describe("renderUrlset", () => {
  it("declares the stylesheet above the root element, where the PI must sit", () => {
    const xml = renderUrlset([{ url: `${ORIGIN}/` }]);
    const pi = xml.indexOf("<?xml-stylesheet");
    const root = xml.indexOf("<urlset");
    expect(pi).toBeGreaterThan(-1);
    expect(pi).toBeLessThan(root);
    expect(xml).toContain(SITEMAP_STYLESHEET_PATH);
  });

  it("starts with the XML declaration and nothing before it", () => {
    expect(renderUrlset([]).startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("omits optional elements rather than emitting empty ones", () => {
    const xml = renderUrlset([{ url: `${ORIGIN}/x` }]);
    expect(xml).toContain(`<loc>${ORIGIN}/x</loc>`);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
  });

  it("clamps priority into the protocol's 0.0-1.0 and prints it stably", () => {
    // An out-of-range priority is a schema violation, and a drifting float makes
    // every regeneration look like a content change.
    const xml = renderUrlset([
      { url: `${ORIGIN}/a`, priority: 5 },
      { url: `${ORIGIN}/b`, priority: -1 },
      { url: `${ORIGIN}/c`, priority: 0.55 },
    ]);
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<priority>0.0</priority>");
    expect(xml).toContain("<priority>0.6</priority>");
  });

  it("can be rendered without a stylesheet", () => {
    expect(renderUrlset([{ url: ORIGIN }], { stylesheet: null })).not.toContain("xml-stylesheet");
  });
});

describe("renderSitemapIndex", () => {
  it("emits a sitemapindex with one entry per child", () => {
    const xml = renderSitemapIndex([
      { url: `${ORIGIN}/sitemap/core.xml` },
      { url: `${ORIGIN}/sitemap/cameras-gb.xml` },
    ]);
    expect(xml).toContain("<sitemapindex");
    expect(xml.match(/<sitemap>/g)).toHaveLength(2);
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/cameras-gb.xml</loc>`);
    expect(xml).not.toContain("<url>");
  });
});

describe("sitemapHeaders", () => {
  it("serves XML, not HTML — a text/html sitemap is refused outright", () => {
    const h = sitemapHeaders() as Record<string, string>;
    expect(h["Content-Type"]).toContain("application/xml");
  });
});

describe("buildSitemapShards — sharding must be a REGROUPING, never a filter", () => {
  const cameras = [
    cam({ id: "tfl:1", country: "GB", region: "London", name: "A" }),
    cam({ id: "tfl:2", country: "GB", region: "London", name: "B" }),
    cam({ id: "caltrans:1", country: "US", region: "California", name: "C" }),
    cam({ id: "castlerock:1", country: "US", region: "Florida", name: "D" }),
    cam({ id: "castlerock:2", country: "US", region: "Florida", name: "E" }),
    cam({ id: "drivebc:1", country: "CA", region: "British Columbia", name: "F" }),
  ];

  it("loses nothing: the union of all shards equals the flat sitemap exactly", () => {
    // This is the load-bearing test. Dropping a shard is silent — every remaining
    // file still returns a valid 200 while thousands of pages stop being advertised.
    const flat = buildSitemap(cameras, ORIGIN, ["/app", "/locate"]);
    const { shards } = buildSitemapShards(cameras, ORIGIN, ["/app", "/locate"]);

    const sharded = shards.flatMap((s) => s.entries.map((e) => e.url)).sort();
    expect(sharded).toEqual(flat.entries.map((e) => e.url).sort());
  });

  it("duplicates nothing: every URL appears in exactly one shard", () => {
    const { shards } = buildSitemapShards(cameras, ORIGIN);
    const all = shards.flatMap((s) => s.entries.map((e) => e.url));
    expect(new Set(all).size).toBe(all.length);
  });

  it("puts camera pages in a country shard and everything else in core", () => {
    const { shards } = buildSitemapShards(cameras, ORIGIN, ["/app"]);
    const ids = shards.map((s) => s.id);
    expect(ids).toContain(CORE_SHARD_ID);
    expect(ids).toContain("cameras-us");
    expect(ids).toContain("cameras-gb");
    expect(ids).toContain("cameras-ca");

    const core = findShard(shards, CORE_SHARD_ID)!;
    expect(core.entries.every((e) => !e.url.includes("/camera/"))).toBe(true);
    expect(core.entries.some((e) => e.url === `${ORIGIN}/cameras`)).toBe(true);

    const us = findShard(shards, "cameras-us")!;
    expect(us.entries).toHaveLength(3);
    expect(us.entries.every((e) => e.url.includes("/camera/"))).toBe(true);
  });

  it("orders country shards biggest first, so the index reads as a summary", () => {
    const { shards } = buildSitemapShards(cameras, ORIGIN);
    const countries = shards.filter((s) => s.id !== CORE_SHARD_ID);
    expect(countries.map((s) => s.id)).toEqual(["cameras-us", "cameras-gb", "cameras-ca"]);
  });

  it("never advertises an unavailable camera, matching buildSitemap", () => {
    const withDead = [...cameras, cam({ id: "tfl:dead", country: "GB", available: false })];
    const { shards } = buildSitemapShards(withDead, ORIGIN);
    const all = shards.flatMap((s) => s.entries.map((e) => e.url));
    expect(all.some((u) => u.includes("dead"))).toBe(false);
  });

  it("emits shard ids that are safe in a URL path", () => {
    const { shards } = buildSitemapShards(cameras, ORIGIN);
    for (const s of shards) {
      expect(s.id, `${s.id} is not path-safe`).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(s.id)).toBe(s.id);
    }
  });

  it("survives an empty registry with a core shard rather than throwing", () => {
    const { shards } = buildSitemapShards([], ORIGIN, ["/app"]);
    expect(findShard(shards, CORE_SHARD_ID)!.entries.length).toBeGreaterThan(0);
    expect(shards.filter((s) => s.id.startsWith("cameras-"))).toHaveLength(0);
  });
});

describe("findShard", () => {
  it("returns null for an unknown id so the route can 404 instead of serving empty", () => {
    const { shards } = buildSitemapShards([cam()], ORIGIN);
    expect(findShard(shards, "cameras-zz")).toBeNull();
    // An empty urlset would let a typo in the index look like a genuinely empty
    // country rather than a broken link.
    expect(findShard(shards, "")).toBeNull();
  });

  it("is case-insensitive on the id", () => {
    const { shards } = buildSitemapShards([cam()], ORIGIN);
    expect(findShard(shards, "CAMERAS-GB")?.id).toBe("cameras-gb");
  });
});
