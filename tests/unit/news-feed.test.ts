import { afterEach, expect, test, vi } from "vitest";
import { FEEDS, FEED_USER_AGENT, mergedNews } from "@/lib/news/feed";

// mergedNews() keeps a 5-minute cache on globalThis. Each test passes its own clock,
// an hour past the last one, so no test is served another test's payload.
let clock = Date.parse("2026-10-16T12:00:00Z");
const nextClock = () => (clock += 60 * 60 * 1000);

afterEach(() => {
  vi.unstubAllGlobals();
});

test("every feed is fetched with the browser User-Agent", async () => {
  // CBC lets the old "TrafficNerd/2.0" UA time out and answers a browser UA at once
  // (measured 2026-10-16). A bot UA on any one feed would quietly lose that feed.
  const seen = new Map<string, string | null>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      seen.set(String(url), new Headers(init?.headers).get("User-Agent"));
      return new Response("<rss></rss>", { status: 200 });
    }),
  );
  await mergedNews(nextClock());
  for (const feed of FEEDS) {
    expect(seen.get(feed.url), feed.source).toBe(FEED_USER_AGENT);
  }
  expect(FEED_USER_AGENT).toMatch(/^Mozilla\/5\.0 /);
  expect(FEED_USER_AGENT).not.toMatch(/TrafficNerd/);
});

test("a stale or future-dated item never reaches the merged stream", async () => {
  const now = nextClock();
  const rfc = (ms: number) => new Date(ms).toUTCString();
  const rss = `<rss><channel>
    <item><title>Fresh story</title><link>https://example.test/fresh</link><pubDate>${rfc(now - 3_600_000)}</pubDate></item>
    <item><title>Story from last year</title><link>https://example.test/old</link><pubDate>${rfc(now - 400 * 86_400_000)}</pubDate></item>
    <item><title>Story from tomorrow</title><link>https://example.test/future</link><pubDate>${rfc(now + 86_400_000)}</pubDate></item>
  </channel></rss>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(rss, { status: 200 })),
  );
  const { items } = await mergedNews(now);
  const titles = new Set(items.map((i) => i.title));
  expect(titles.has("Fresh story")).toBe(true);
  expect(titles.has("Story from last year")).toBe(false);
  expect(titles.has("Story from tomorrow")).toBe(false);
});
