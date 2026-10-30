// War news: relay feed `war-news` -> map features and the widget's summary.
//
// Two kinds of input. The REAL capture (tests/fixtures/relay/war-news.json) was taken on
// provenance-1 on 2026-10-30 while DeepSeek answered 402 (no credit): every row in it is
// an English post the model has not read (`checked: false`), which is itself a case the
// layer must handle. The SYNTHETIC rows below are written here, by hand, to cover what that
// capture cannot: translated, placed, opinion and facility posts. They are labelled as such
// and never used as a fixture.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RELAY_FEEDS, type RelayData } from "@/lib/relay/feeds";
import { putRelay, resetRelayStore, type RelaySnapshot } from "@/lib/relay/store";
import { readOutcome } from "@/lib/signals/outcome";
import { readSummary } from "@/lib/signals/summary";
import {
  WAR_NEWS_SOURCE,
  ZONE_ALL,
  ZONE_NONE,
  defaultWarNewsZone,
  readWarNewsSummary,
  warNewsAge,
  warNewsByline,
  warNewsFeatureId,
  warNewsFrom,
  warNewsHiddenLine,
  warNewsView,
  warNewsZoneLabel,
} from "@/lib/signals/war-news";

type Data = RelayData<"war-news">;
type Row = Data["items"][number];

const env = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "relay", "war-news.json"), "utf8"));
const captured: Data = RELAY_FEEDS["war-news"].schema.parse(env.data);
const capturedAt = Date.parse(env.fetchedAt);

function snap(data: Data, fetchedAt = capturedAt): RelaySnapshot<Data> {
  return { data, fetchedAt, receivedAt: fetchedAt + 1000 };
}

// SYNTHETIC rows, written for these tests.
function row(over: Partial<Row>): Row {
  return {
    id: "aaaaaaaaaaaaaaaa",
    outlet: "Kyiv Post",
    channel: "rss",
    side: "ua",
    url: "https://www.kyivpost.com/post/1",
    title: "A headline",
    summary: null,
    lang: "en",
    translated: false,
    original: null,
    publishedAt: "2026-10-29T21:00:00Z",
    zone: "ukraine",
    place: null,
    opinion: false,
    checked: true,
    ...over,
  };
}
const kharkiv = { name: "Kharkiv, Kharkiv Oblast, Ukraine", lat: 49.9808, lon: 36.2527, precision: "area" as const };
const synthetic: Data = {
  items: [
    row({ id: "a000000000000001", place: kharkiv }),
    row({
      id: "a000000000000002", outlet: "Creamy Caprice", channel: "telegram", side: "ru", url: "https://t.me/creamy_caprice/1",
      lang: "ru", translated: true, original: "Позиционные боевые действия в районе Красного Лимана.",
      title: "Positional fighting near Krasny Liman", publishedAt: "2026-10-29T22:00:00Z",
      place: { name: "Chuhuiv Air Base, Ukraine", lat: 49.83, lon: 36.63, precision: "facility" },
    }),
    row({ id: "a000000000000003", outlet: "Roy TV (Maxim Kalashnikov)", channel: "telegram", side: "ru", url: "https://t.me/roy_tv_mk/1", opinion: true, place: kharkiv }),
    row({ id: "a000000000000004", outlet: "Liveuamap", channel: "telegram", side: "independent", url: "https://t.me/liveuamap/1", zone: "middle-east" }),
    row({ id: "a000000000000005", outlet: "Meduza", side: "independent", url: "https://meduza.io/en/1", zone: null }),
    row({ id: "a000000000000006", outlet: "Censor.net", url: "https://censor.net/en/1", zone: null, checked: false }),
    row({ id: "a000000000000007", outlet: "Gwara Media", url: "https://gwaramedia.com/en/1" }),
  ],
  outlets: captured.outlets,
  pending: { count: 3, reason: "this run's model budget of $0.05 was used" },
};

afterEach(() => resetRelayStore());

describe("war news: the real capture (a model outage)", () => {
  const { features, summary } = warNewsFrom(snap(captured));

  it("draws nothing the model has not read, and lists every post", () => {
    expect(features).toEqual([]);
    expect(summary.posts).toHaveLength(captured.items.length);
    expect(summary.unchecked).toBe(captured.items.length);
    expect(summary.byZone).toEqual([]);
  });

  it("says what the model has not read and why", () => {
    expect(summary.pending).toEqual({ count: 727, reason: "the model account is out of credit" });
  });

  it("lists every outlet, with the one that refused and the two with no feed", () => {
    const byName = Object.fromEntries(summary.outlets.map((o) => [o.name, o]));
    expect(summary.outlets).toHaveLength(21);
    expect(byName["Militaryland"].status).toBe("failed");
    expect(byName["Militaryland"].detail).toBe("HTTP 429");
    expect(byName["RBC-Ukraine"].status).toBe("no-feed");
    expect(byName["TVP World"].status).toBe("no-feed");
    expect(byName["Roy TV (Maxim Kalashnikov)"].opinion).toBe(true);
  });

  it("puts the newest post first", () => {
    const times = summary.posts.map((p) => Date.parse(p.publishedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("survives the trip to the client and back through the reader", () => {
    expect(readWarNewsSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });
});

describe("war news: placed, translated and opinion posts (synthetic rows)", () => {
  const { features, summary } = warNewsFrom(snap(synthetic));

  it("draws only placed, read, non-opinion posts, each at its own precision", () => {
    expect(features.map((f) => f.id).sort()).toEqual([warNewsFeatureId("a000000000000001"), warNewsFeatureId("a000000000000002")]);
    const town = features.find((f) => f.id === warNewsFeatureId("a000000000000001"))!;
    expect(town).toMatchObject({ lat: 49.9808, lon: 36.2527, precision: "area", link: "https://www.kyivpost.com/post/1", signalId: "war-news" });
    const site = features.find((f) => f.id === warNewsFeatureId("a000000000000002"))!;
    expect(site.precision).toBe("facility");
  });

  it("never draws an opinion post, whatever place it names", () => {
    expect(features.some((f) => f.id === warNewsFeatureId("a000000000000003"))).toBe(false);
    expect(summary.posts.find((p) => p.id === "a000000000000003")).toMatchObject({ mapped: false, opinion: true });
  });

  it("says the side in words and marks a translation on the map's detail", () => {
    const site = features.find((f) => f.id === warNewsFeatureId("a000000000000002"))!;
    expect(site.props).toMatchObject({ side: "Russian outlet", outlet: "Creamy Caprice (Telegram)", translated: "Translated from Russian", warZone: "Ukraine" });
    const town = features.find((f) => f.id === warNewsFeatureId("a000000000000001"))!;
    expect(town.props).not.toHaveProperty("translated");
  });

  it("counts by side, and by zone with the largest first and no zone last", () => {
    expect(summary.bySide).toEqual({ ua: 3, ru: 2, independent: 2 });
    expect(summary.byZone).toEqual([
      { zone: "ukraine", count: 4 },
      { zone: "middle-east", count: 1 },
      { zone: null, count: 1 },
    ]);
    expect(summary.unchecked).toBe(1);
  });

  it("keeps the original text of a translated post", () => {
    const post = summary.posts.find((p) => p.id === "a000000000000002")!;
    expect(post).toMatchObject({ translated: true, lang: "ru", original: "Позиционные боевые действия в районе Красного Лимана." });
  });
});

describe("war news: the summary reader", () => {
  const { summary } = warNewsFrom(snap(synthetic));

  it("refuses a summary that is not the one this layer writes", () => {
    expect(readWarNewsSummary(undefined)).toBeNull();
    expect(readWarNewsSummary({ heldKm2: 117148 })).toBeNull();
    expect(readWarNewsSummary({ ...summary, posts: [{ ...summary.posts[0], side: "both" }] })).toBeNull();
    expect(readWarNewsSummary({ ...summary, posts: [{ ...summary.posts[0], url: "http://x.test" }] })).toBeNull();
    expect(readWarNewsSummary({ ...summary, pending: { count: "3" } })).toBeNull();
  });

  it("names zones in words", () => {
    expect(warNewsZoneLabel("ukraine")).toBe("Ukraine");
    expect(warNewsZoneLabel("middle-east")).toBe("Middle East");
    expect(warNewsZoneLabel("nagorno-karabakh")).toBe("Nagorno karabakh");
    expect(warNewsZoneLabel(null)).toBe("No war zone");
  });
});

describe("war news: the source reads the relay", () => {
  it("says it has nothing before the first push", async () => {
    const out = await WAR_NEWS_SOURCE.fetch();
    expect(out).toEqual([]);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "not pushed from provenance-1 yet" });
  });

  it("serves the features with the summary, dated when provenance-1 read the outlets", async () => {
    const now = Date.now();
    putRelay("war-news", synthetic, now - 60_000, now);
    const out = await WAR_NEWS_SOURCE.fetch();
    expect(out).toHaveLength(2);
    expect(readOutcome(out)).toMatchObject({ ok: true, at: now - 60_000 });
    const summary = readWarNewsSummary(readSummary(out));
    expect(summary?.posts).toHaveLength(synthetic.items.length);
  });

  it("refuses a push older than the feed's age limit rather than serve it as current", async () => {
    const now = Date.now();
    putRelay("war-news", synthetic, now - RELAY_FEEDS["war-news"].maxAgeMs - 60_000, now);
    const out = await WAR_NEWS_SOURCE.fetch();
    expect(out).toEqual([]);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "the last push from provenance-1 is too old" });
  });
});

describe("war news: the widget's filters", () => {
  const { summary } = warNewsFrom(snap(synthetic));
  const now = Date.parse("2026-10-30T00:00:00Z");

  it("opens on Ukraine when the feed has posts there, else on every zone", () => {
    expect(defaultWarNewsZone(summary)).toBe("ukraine");
    expect(defaultWarNewsZone({ byZone: [{ zone: "middle-east", count: 4 }] })).toBe(ZONE_ALL);
    expect(defaultWarNewsZone(warNewsFrom(snap(captured)).summary)).toBe(ZONE_ALL);
  });

  it("says how many posts the zone filter hides, and why", () => {
    const view = warNewsView(summary.posts, { side: "all", zone: "ukraine" });
    expect(view.shown.map((p) => p.id)).toEqual(["a000000000000002", "a000000000000001", "a000000000000003", "a000000000000007"]);
    expect(view.hidden).toEqual({ otherWars: 1, noWar: 1, unchecked: 1 });
    expect(warNewsHiddenLine(view)).toBe(
      "3 posts are hidden by the zone filter: 1 about other wars (Middle East), 1 about no war, 1 not checked yet.",
    );
    expect(warNewsHiddenLine(warNewsView(summary.posts, { side: "all", zone: ZONE_ALL }))).toBeNull();
  });

  it("filters by side and by words, and counts hidden posts only inside that side", () => {
    const ru = warNewsView(summary.posts, { side: "ru", zone: "ukraine" });
    expect(ru.shown.every((p) => p.side === "ru")).toBe(true);
    expect(ru.hidden).toEqual({ otherWars: 0, noWar: 0, unchecked: 0 });
    const found = warNewsView(summary.posts, { side: "all", zone: ZONE_ALL, query: "  ЛИМАНА " });
    expect(found.shown.map((p) => p.id)).toEqual(["a000000000000002"]);
    expect(warNewsView(summary.posts, { side: "all", zone: ZONE_NONE }).shown.map((p) => p.id)).toEqual(["a000000000000005"]);
  });

  it("writes each row's byline with what a reader must not miss", () => {
    const post = (id: string) => summary.posts.find((p) => p.id === id)!;
    expect(warNewsByline(post("a000000000000002"))).toBe("Creamy Caprice, Telegram. Translated from Russian");
    expect(warNewsByline(post("a000000000000003"))).toBe("Roy TV (Maxim Kalashnikov), Telegram. Opinion");
    expect(warNewsByline(post("a000000000000006"))).toBe("Censor.net");
  });

  it("gives a post's age in minutes, hours, then days", () => {
    expect(warNewsAge("2026-10-29T23:30:00Z", now)).toBe("30m");
    expect(warNewsAge("2026-10-29T21:00:00Z", now)).toBe("3h");
    expect(warNewsAge("2026-10-26T00:00:00Z", now)).toBe("4d");
    expect(warNewsAge("2026-10-31T00:00:00Z", now)).toBe("");
  });
});
