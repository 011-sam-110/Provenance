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
