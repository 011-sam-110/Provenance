import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseRss } from "@/lib/news";
import { FEEDS } from "@/lib/news/feed";
import { NEWS_ATTRIBUTION, sourceMeta } from "@/lib/news/sources";

// The fifteen feeds added on 2026-10-16, plus NPR's world feed that replaced 1001. Each
// fixture is the publisher's own XML as served that day, cut to its first three items,
// so a format the hand-rolled parser cannot read fails here and not silently on prod.
const DIR = "tests/fixtures/news-feeds";
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".xml"));

test("there is a captured fixture for every feed added on 2026-10-16", () => {
  expect(fixtures).toHaveLength(16);
});

test.each(fixtures)("%s parses into dated headlines with absolute links", (file) => {
  const items = parseRss(readFileSync(`${DIR}/${file}`, "utf8"), file);
  expect(items).toHaveLength(3);
  for (const it of items) {
    expect(it.title.length).toBeGreaterThan(5);
    expect(it.url).toMatch(/^https?:\/\//);
    // A dateless item would slip past the age window; none of these feeds has one.
    expect(it.ts).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
  }
});

test("every feed's source name is attributed — no outlet degrades to Other", () => {
  for (const feed of FEEDS) {
    const m = sourceMeta(feed.source);
    expect(m.domain, feed.source).not.toBeNull();
    expect(m.region, feed.source).not.toBe("Other");
    expect(m.owner, feed.source).not.toBeNull();
  }
});

test("the feed set reaches every inhabited continent", () => {
  // Until 2026-10-16 no outlet from Africa, Latin America or Oceania was in the set,
  // so the blindspot readout could never find a story those regions carried.
  const regions = new Set(FEEDS.map((f) => sourceMeta(f.source).region));
  for (const r of ["Africa", "Latin America", "Oceania", "Asia", "Europe", "North America", "US", "UK", "Middle East"]) {
    expect(regions.has(r), r).toBe(true);
  }
});

test("the attribution line states the real feed count and names the new outlets", () => {
  expect(NEWS_ATTRIBUTION.startsWith(`${FEEDS.length} world RSS feeds (`)).toBe(true);
  const added = [
    "Africanews", "RNZ", "MercoPress", "Buenos Aires Times", "CBC", "Yonhap", "Kyiv Independent",
    "PBS NewsHour", "ABC Australia", "UN News", "RFI", "ANSA", "Focus Taiwan", "Premium Times", "SABC News",
  ];
  for (const name of added) {
    expect(FEEDS.some((f) => f.source === name), name).toBe(true);
    expect(NEWS_ATTRIBUTION).toContain(name);
  }
});

test("every feed URL is unique and https", () => {
  const urls = FEEDS.map((f) => f.url);
  expect(new Set(urls).size).toBe(urls.length);
  for (const u of urls) expect(u).toMatch(/^https:\/\//);
});
