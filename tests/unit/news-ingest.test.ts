import { beforeEach, describe, expect, it } from "vitest";
import {
  INGEST_MAX_ITEMS,
  outletDisplayName,
  parseSnapshot,
  signIngest,
  toNewsItems,
  verifyIngest,
  type ScrapedItem,
} from "@/lib/news/ingest";
import {
  MAX_ITEMS,
  MAX_TEXT_ITEMS,
  ingestItems,
  resetScrapedStore,
  scrapedCursor,
  scrapedItems,
  scrapedStats,
} from "@/lib/news/scrapedStore";

const SECRET = "a-test-secret-that-is-long-enough-to-be-real";
const NOW = Date.parse("2026-09-16T09:00:00Z");

/** A wire item the scraper would send: BBC, with text. */
function wireItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "st_9f3c1a0b77de2415",
    outlet: "bbc",
    title: "Trump shadow looms large over Brics as Modi hosts Putin and Xi in Delhi",
    description: "As Brics leaders meet in Delhi, divisions within the bloc make a united response unlikely.",
    url: "https://www.bbc.com/news/articles/c07lv53l7jjo",
    published: "2026-09-11T09:38:23Z",
    updated: "2026-09-14T09:45:05Z",
    firstSeenAt: "2026-09-15T18:05:42Z",
    lastSeenAt: "2026-09-16T09:05:40Z",
    sections: ["world", "asia"],
    formatFlags: [],
    authors: ["Zane Irwin"],
    wordCount: 432,
    thumbnail: "https://ichef.bbci.co.uk/news/480/live/80be8820.jpg",
    hasText: true,
    textHash: "3b1f0000000000000000000000000000000000000000000000000000000000ff",
    itemHash: "aa11",
    text: "Leaders of the Brics group met in Delhi on Thursday.",
    keywords: ["Asia", "World"],
    placeHints: ["India"],
    ...over,
  };
}

function snapshot(items: Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, generatedAt: "2026-09-16T09:06:00Z", cursor: "ignored", items };
}

describe("ingest signature", () => {
  it("accepts a body signed with the shared secret", async () => {
    const body = JSON.stringify(snapshot([wireItem()]));
    const signature = await signIngest(SECRET, NOW, body);
    const verdict = await verifyIngest({
      secret: SECRET,
      timestampHeader: String(NOW),
      signatureHeader: signature,
      body,
      nowMs: NOW + 1_000,
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("refuses a body edited after signing", async () => {
    const body = JSON.stringify(snapshot([wireItem()]));
    const signature = await signIngest(SECRET, NOW, body);
    const tampered = body.replace("Delhi", "Moscow");
    const verdict = await verifyIngest({
      secret: SECRET,
      timestampHeader: String(NOW),
      signatureHeader: signature,
      body: tampered,
      nowMs: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a replay outside the skew window", async () => {
    const body = "{}";
    const signature = await signIngest(SECRET, NOW, body);
    const verdict = await verifyIngest({
      secret: SECRET,
      timestampHeader: String(NOW),
      signatureHeader: signature,
      body,
      nowMs: NOW + 6 * 60 * 1000,
    });
    expect(verdict).toEqual({ ok: false, reason: "skew" });
  });

  it("refuses a signature made with a different secret", async () => {
    const body = "{}";
    const signature = await signIngest("some-other-secret", NOW, body);
    const verdict = await verifyIngest({
      secret: SECRET,
      timestampHeader: String(NOW),
      signatureHeader: signature,
      body,
      nowMs: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a timestamp that only looks numeric", async () => {
    const body = "{}";
    const verdict = await verifyIngest({
      secret: SECRET,
      timestampHeader: "1789000000000abc",
      signatureHeader: await signIngest(SECRET, NOW, body),
      body,
      nowMs: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "bad-timestamp" });
  });

  it("refuses when headers are absent", async () => {
    const verdict = await verifyIngest({
      secret: SECRET,
      timestampHeader: null,
      signatureHeader: null,
      body: "{}",
      nowMs: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "missing-headers" });
  });
});

describe("parseSnapshot", () => {
  it("maps a real wire item to the domain shape", () => {
    const result = parseSnapshot(snapshot([wireItem()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [item] = result.snapshot.items;
    expect(item.id).toBe("st_9f3c1a0b77de2415");
    expect(item.outlet).toBe("bbc");
    expect(item.ts).toBe(Date.parse("2026-09-11T09:38:23Z"));
    expect(item.tsExact).toBe(true);
    expect(item.text).toBe("Leaders of the Brics group met in Delhi on Thursday.");
    expect(item.placeHints).toEqual(["India"]);
  });

  it("orders a PBS item with no publication time by first-seen, not last-seen", () => {
    // PBS listing cards carry "Sep 14" with no year, so a story whose article page was
    // never fetched has no published time at all. lastSeenAt is rewritten every run,
    // so using it would float a week-old story to the top of the rail every hour.
    const result = parseSnapshot(
      snapshot([
        wireItem({
          outlet: "pbs",
          published: null,
          firstSeenAt: "2026-09-14T11:00:00Z",
          lastSeenAt: "2026-09-16T09:05:40Z",
        }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.items[0].ts).toBe(Date.parse("2026-09-14T11:00:00Z"));
    expect(result.snapshot.items[0].tsExact).toBe(false);
  });

  it("drops malformed rows but keeps the rest of the batch", () => {
    const result = parseSnapshot(
      snapshot([
        wireItem(),
        wireItem({ id: "st_2", title: "" }), // no title
        wireItem({ id: "st_3", url: "javascript:alert(1)" }), // not a web link
        wireItem({ id: "st_4", url: "https://www.reuters.com/world/one", outlet: "reuters" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.items.map((i) => i.id)).toEqual(["st_9f3c1a0b77de2415", "st_4"]);
  });

  it("reports the cursor we accepted, never the one the sender claimed", () => {
    const result = parseSnapshot({
      version: 1,
      generatedAt: "2026-09-16T09:06:00Z",
      cursor: "2099-01-01T00:00:00Z", // a sender claiming to be far ahead
      items: [
        wireItem({ id: "st_a", lastSeenAt: "2026-09-16T09:00:00Z" }),
        wireItem({ id: "st_b", lastSeenAt: "2026-09-16T09:05:40Z" }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.cursor).toBe("2026-09-16T09:05:40Z");
  });

  it("accepts an empty batch as a cursor probe", () => {
    const result = parseSnapshot(snapshot([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.items).toEqual([]);
  });

  it("refuses an unknown version rather than guessing", () => {
    expect(parseSnapshot({ version: 2, items: [] })).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
  });

  it("refuses a batch over the per-POST ceiling", () => {
    const items = Array.from({ length: INGEST_MAX_ITEMS + 1 }, (_, i) =>
      wireItem({ id: `st_${i}` }),
    );
    expect(parseSnapshot(snapshot(items))).toEqual({ ok: false, reason: "too-many-items" });
  });
});

describe("toNewsItems", () => {
  it("maps to the shape /api/news already merges, and carries no article text", () => {
    const parsed = parseSnapshot(snapshot([wireItem({ outlet: "reuters" })]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [news] = toNewsItems(parsed.snapshot.items);
    expect(news.source).toBe("Reuters");
    expect(news.url).toBe("https://www.bbc.com/news/articles/c07lv53l7jjo");
    expect(news.ts).toBe(Date.parse("2026-09-11T09:38:23Z"));
    // The licence question hangs on this one: article bodies are input, never output.
    expect(Object.keys(news)).not.toContain("text");
    expect(JSON.stringify(news)).not.toContain("Brics group met");
  });

  it("keeps an unknown outlet rather than dropping it", () => {
    expect(outletDisplayName("aljazeera")).toBe("aljazeera");
    expect(outletDisplayName("pbs")).toBe("PBS NewsHour");
  });
});

describe("scrapedStore", () => {
  beforeEach(() => resetScrapedStore());

  function domainItem(over: Partial<ScrapedItem> = {}): ScrapedItem {
    const parsed = parseSnapshot(snapshot([wireItem()]));
    if (!parsed.ok) throw new Error("fixture failed to parse");
    return { ...parsed.snapshot.items[0], ...over };
  }

  it("counts a re-post of an unchanged item as unchanged, so retries are free", () => {
    const item = domainItem();
    expect(ingestItems([item], NOW).accepted).toBe(1);
    const second = ingestItems([item], NOW);
    expect(second.accepted).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(scrapedStats().items).toBe(1);
  });

  it("lands a corrected headline on an item that has no text hash", () => {
    // NYT stores no article text by design, so textHash is null for every NYT row.
    // Keyed on textHash alone these rows would be permanently unchangeable.
    const nyt = domainItem({ id: "st_nyt", outlet: "nyt", textHash: null, text: null, itemHash: null });
    ingestItems([nyt], NOW);
    const corrected = { ...nyt, title: "Corrected headline" };
    expect(ingestItems([corrected], NOW).accepted).toBe(1);
    expect(scrapedItems()[0].title).toBe("Corrected headline");
  });

  it("prefers the sender's item hash when both sides have one", () => {
    const item = domainItem({ itemHash: "hash-1" });
    ingestItems([item], NOW);
    // Same hash, different title: the sender says nothing changed, so nothing did.
    const same = ingestItems([{ ...item, title: "Different but same hash" }], NOW);
    expect(same.unchanged).toBe(1);
    expect(ingestItems([{ ...item, itemHash: "hash-2" }], NOW).accepted).toBe(1);
  });

  it("does not let an update without text erase text we already hold", () => {
    // The scraper strips bodies from rows it has already sent, so a later headline
    // edit arrives with text: null. Losing the body would silently starve clustering.
    ingestItems([domainItem()], NOW);
    ingestItems([domainItem({ title: "Edited", text: null, itemHash: "changed" })], NOW);
    expect(scrapedItems()[0].text).toBe("Leaders of the Brics group met in Delhi on Thursday.");
  });

  it("advances the cursor past a story that was seen again but did not change", () => {
    const item = domainItem({ lastSeenAt: "2026-09-16T09:00:00Z" });
    ingestItems([item], NOW);
    ingestItems([{ ...item, lastSeenAt: "2026-09-16T10:00:00Z" }], NOW);
    expect(scrapedCursor()).toBe("2026-09-16T10:00:00Z");
  });

  it("reports an empty cursor before the first push, which the scraper reads as backfill", () => {
    expect(scrapedCursor()).toBe("");
  });

  it("caps how much it holds, and strips bodies before it drops stories", () => {
    const many = Array.from({ length: MAX_ITEMS + 50 }, (_, i) =>
      domainItem({
        id: `st_${i}`,
        ts: NOW - i * 1_000,
        itemHash: `h${i}`,
      }),
    );
    ingestItems(many, NOW);
    const stats = scrapedStats();
    expect(stats.items).toBe(MAX_ITEMS);
    expect(stats.withText).toBe(MAX_TEXT_ITEMS);
    // The newest survive; the oldest are the ones dropped.
    expect(scrapedItems(1)[0].id).toBe("st_0");
  });
});
