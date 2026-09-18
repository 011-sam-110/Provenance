import { expect, test } from "vitest";
import { normalizeTitle, titleTokens, overlap, clusterNews, buildWeights, evidence, MIN_WEIGHTED_BATCH } from "@/lib/news/cluster";
import type { NewsItem } from "@/lib/news";

const it = (title: string, source: string, ts: number, url = `https://x/${Math.random()}`): NewsItem => ({
  title,
  source,
  url,
  ts,
});

test("normalizeTitle strips publisher suffix + punctuation and lower-cases", () => {
  expect(normalizeTitle("Big story unfolds - BBC News")).toBe("big story unfolds");
  expect(normalizeTitle("Something happens | Reuters")).toBe("something happens");
  // Possessives and contractions lose the "’s" rather than fusing into "countrys"
  // — see normalizeTitle. "it" is a stop word, so the contraction case costs nothing.
  expect(normalizeTitle("It’s a Test, really!")).toBe("it a test really");
  expect(normalizeTitle("The country’s third shooting")).toBe("the country third shooting");
});

test("titleTokens drops short words + stop-words", () => {
  const t = titleTokens("The US strikes Iran after an attack");
  expect(t.has("strikes")).toBe(true);
  expect(t.has("iran")).toBe(true);
  expect(t.has("attack")).toBe(true);
  expect(t.has("the")).toBe(false);
  expect(t.has("us")).toBe(false); // 2 chars
  expect(t.has("after")).toBe(false); // stop word
});

test("overlap returns jaccard + shared count + overlap coefficient", () => {
  const a = new Set(["ukraine", "licence", "patriot", "build"]);
  const b = new Set(["ukraine", "licence", "patriot", "produce"]);
  const o = overlap(a, b);
  expect(o.shared).toBe(3);
  expect(o.score).toBeCloseTo(3 / 5, 5);
  expect(o.coeff).toBeCloseTo(3 / 4, 5); // shared / min-size
  expect(overlap(new Set(), a)).toEqual({ score: 0, shared: 0, coeff: 0 });
});

test("clusterNews groups a cross-source story and keeps unrelated ones apart", () => {
  const items: NewsItem[] = [
    it("US gives Ukraine licence to build Patriot missiles", "BBC", 100),
    it("Ukraine to get licence to produce Patriot systems", "France 24", 300),
    it("Patriot missiles: Ukraine granted licence to build", "Al Jazeera", 200),
    it("Bucknell coach charged in hazing death case", "NPR", 250),
  ];
  const clusters = clusterNews(items);
  expect(clusters).toHaveLength(2);

  const patriot = clusters.find((c) => c.sourceCount === 3)!;
  expect(patriot).toBeTruthy();
  expect(patriot.sources.sort()).toEqual(["Al Jazeera", "BBC", "France 24"]);
  // lead is the newest (France 24 @ 300)
  expect(patriot.lead.source).toBe("France 24");
  expect(patriot.latestTs).toBe(300);
  expect(patriot.earliestTs).toBe(100);

  const lone = clusters.find((c) => c.sourceCount === 1)!;
  expect(lone.lead.source).toBe("NPR");
});

test("differently-phrased cross-source headlines fuse via the overlap-coefficient rule", () => {
  const items: NewsItem[] = [
    it("Jordan air defences intercept and destroy multiple Iranian ballistic missiles fired overnight", "Al Jazeera", 400),
    it("Jordan downs three Iranian missiles", "France 24", 380),
  ];
  // Jaccard is only ~0.23 (the long headline dilutes the union), but the short
  // headline's core entities (jordan/iranian/missiles) are ≥60% contained — same event.
  const clusters = clusterNews(items);
  expect(clusters).toHaveLength(1);
  expect(clusters[0].sourceCount).toBe(2);
});

test("a single shared token does not fuse unrelated stories", () => {
  const items: NewsItem[] = [
    it("Iran holds parliamentary elections", "BBC", 100),
    it("Iran football team qualifies for final", "NPR", 90),
  ];
  const clusters = clusterNews(items);
  expect(clusters).toHaveLength(2); // only "iran" in common → not merged
});

test("clusterNews is dormant-safe on empty input", () => {
  expect(clusterNews([])).toEqual([]);
});

// ── Regressions from the live corpus (300 headlines / 10 sources, 2026-09-18) ──
// Each pair below was produced by the previous Jaccard clusterer or by a rejected
// tuning of this one. They are kept as tests because every one of them is a
// FALSE merge — two newsrooms shown as corroborating each other when they were
// reporting different events — which is the failure this product can least afford.

const DAY = 86_400_000;
const T0 = 1_758_000_000_000;

/**
 * A corpus big enough for measured token weights to switch on, in which the
 * filler words under test are common in roughly the proportions they are common
 * in a real pull.
 *
 * The proportions are not decoration. Salting every headline with "war" would
 * drive its weight to nearly zero and the tests below would pass against any
 * threshold at all — they would assert that an impossible merge does not happen.
 * These frequencies are taken from the live 545-headline corpus measured on
 * 2026-09-18: war 15, votes 6, first 10, time 8, drags 2.
 */
function filler(n: number): NewsItem[] {
  const salt = (i: number): string => {
    const words: string[] = [];
    if (i % 12 === 0) words.push("war");
    if (i % 30 === 0) words.push("votes");
    if (i % 18 === 0) words.push("first");
    if (i % 22 === 0) words.push("time");
    if (i % 90 === 0) words.push("drags");
    return words.join(" ");
  };
  const out: NewsItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      it(
        `Filler ${i} ${salt(i)} dispatch about subject ${i} in region ${i % 7} today`,
        `Filler Source ${i % 9}`,
        T0 - i * 60_000,
        `https://filler/${i}`,
      ),
    );
  }
  return out;
}

test("shared newsroom filler does not fuse two unrelated stories", () => {
  const cat = it("New cat species identified for first time in more than a century in Bolivia", "The Guardian", T0, "https://g/cat");
  const rates = it("US interest rates raised for first time in three years", "BBC", T0 - 3_600_000, "https://b/rates");
  const clusters = clusterNews([...filler(180), cat, rates]);
  const withCat = clusters.find((c) => c.items.some((i) => i.url === "https://g/cat"))!;
  expect(withCat.items.map((i) => i.url)).not.toContain("https://b/rates");
});

test("three shared common words do not fuse an election with a war vote", () => {
  // Fused at minMass 1.7 — "votes", "war" and "drags" are all cheap in a real feed.
  const russia = it("Russia votes in parliamentary election as war in Ukraine drags on", "France 24", T0, "https://f/ru");
  const house = it("US House votes for a third time to end the Iran war as conflict drags on", "Euronews", T0 - 7_200_000, "https://e/house");
  const clusters = clusterNews([...filler(180), russia, house]);
  const withRussia = clusters.find((c) => c.items.some((i) => i.url === "https://f/ru"))!;
  expect(withRussia.items.map((i) => i.url)).not.toContain("https://e/house");
});

test("a genuine cross-source co-report still fuses inside the same corpus", () => {
  // The control for the two tests above: same batch size, same code path, a pair
  // that SHOULD merge. Without it, a clusterer that merges nothing would pass.
  const a = it("UN experts say grounds to believe US committed war crimes in Iran strikes", "BBC", T0, "https://b/un");
  const b = it("UN mission says grounds to believe US committed war crimes in Iran", "France 24", T0 - 1_800_000, "https://f/un");
  const clusters = clusterNews([...filler(180), a, b]);
  const un = clusters.find((c) => c.items.some((i) => i.url === "https://b/un"))!;
  expect(un.sources.sort()).toEqual(["BBC", "France 24"]);
});

test("the same event reported a week apart is two stories, not one", () => {
  const now = it("Bomb attack at Pakistan mosque kills at least 15, injures 50", "Al Jazeera", T0, "https://a/p1");
  const old = it("Bomb attack at Pakistan mosque kills at least 15, injures 50", "BBC", T0 - 7 * DAY, "https://b/p2");
  expect(clusterNews([now, old])).toHaveLength(2);
  // ...and the window is the only thing keeping them apart, so disabling it fuses them.
  expect(clusterNews([now, old], { windowMs: 0 })).toHaveLength(1);
});

test("an undated headline is never rejected by the time window", () => {
  const dated = it("Indonesia gets its first aircraft carrier amid debate over cost", "The Guardian", T0, "https://g/id");
  const undated = it("Indonesia acquires first aircraft carrier amid military upgrade", "Al Jazeera", 0, "https://a/id");
  expect(clusterNews([dated, undated])).toHaveLength(1);
});

test("measured weights switch off below MIN_WEIGHTED_BATCH and a once-seen token anchors at 1.0", () => {
  expect(buildWeights(["one small batch of headlines"]).size).toBe(0);
  const corpus = filler(MIN_WEIGHTED_BATCH).map((i) => i.title);
  const w = buildWeights([...corpus, "quetzalcoatlus discovered in patagonia"]);
  expect(w.size).toBeGreaterThan(0);
  expect(w.get("quetzalcoatlus")).toBeCloseTo(1, 5); // df = 1 → the unit of the scale
  expect(w.get("war")!).toBeLessThan(0.6); // common across the batch → cheap evidence
});

test("evidence reads an empty weight map as uniform, so mass is a shared-token count", () => {
  const a = titleTokens("Ukraine granted licence to build Patriot missiles");
  const b = titleTokens("Ukraine to get licence to produce Patriot systems");
  const e = evidence(a, b, new Map());
  expect(e.shared).toBe(3); // ukraine, licence, patriot
  expect(e.mass).toBe(3);
  expect(e.ratio).toBeGreaterThan(0.16);
});
