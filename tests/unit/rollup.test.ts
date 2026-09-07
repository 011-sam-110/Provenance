// The counting rules for the access-log rollups.
//
// These pin the DEFINITIONS, not the plumbing. Every number on /admin/analytics comes
// out of foldRow, and the difference between a dashboard that means something and one
// that flatters is entirely in what gets called a pageview. A crawler working through
// 18,766 camera pages, a browser fetching 124 static files per load, and a scanner
// probing /wp-login are all "requests"; none of them is a person reading a page.
//
// So the rules that matter are the exclusions, and they are tested as exclusions rather
// than by asserting a total — a total moves whenever traffic does, which is exactly the
// kind of assertion that gets deleted the first time it fails.

import { describe, expect, it } from "vitest";
import {
  DURATION_EDGES_MS,
  capMap,
  classify,
  dayKey,
  deviceOf,
  emptyDay,
  foldRow,
  hourOf,
  isBot,
  mergeDay,
  normalisePath,
  referrerHost,
  topN,
  type AccessRow,
} from "@/lib/analytics/rollup";

const HUMAN =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";

function row(over: Partial<AccessRow> & { uri?: string; ua?: string; country?: string } = {}): AccessRow {
  const { uri = "/", ua = HUMAN, country = "GB", ...rest } = over;
  return {
    ts: 1_788_800_000,
    logger: "http.log.access.log0",
    status: 200,
    size: 1234,
    duration: 0.05,
    request: {
      client_ip: "86.20.0.0",
      remote_ip: "172.70.0.0",
      method: "GET",
      host: "provenance-online.com",
      uri,
      headers: {
        "User-Agent": [ua],
        ...(country ? { "Cf-Ipcountry": [country] } : {}),
      },
    },
    ...rest,
  };
}

const ctx = { selfHost: "provenance-online.com" };

describe("normalisePath", () => {
  it("drops the query string, which is where the cardinality lives", () => {
    // /app carries lat, lon, zoom and a layer list. Keyed by full URI, every single
    // visit would be its own row and the top-pages panel would be empty.
    expect(normalisePath("/app?lat=33.18&lon=-117.08&z=7.3&layers=planes")).toBe("/app");
  });

  it("decodes percent-escapes, because camera ids are full of colons", () => {
    expect(normalisePath("/camera/castlerock%3Aon%3A82")).toBe("/camera/castlerock:on:82");
    // A malformed escape must not throw and take the whole run down with it.
    expect(normalisePath("/camera/%zz")).toBe("/camera/%zz");
  });

  it("drops the fragment and the trailing slash, and never returns an empty path", () => {
    expect(normalisePath("/cameras#top")).toBe("/cameras");
    expect(normalisePath("/cameras/")).toBe("/cameras");
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("")).toBe("/");
  });
});

describe("classify", () => {
  it("never calls an API response a pageview", () => {
    // /api/planes returned 1.3 MB in a single response. Counted as a pageview it would
    // dominate every panel while representing no reader at all.
    expect(classify("/api/planes", 200, false)).toBe("api");
    expect(classify("/api/signals/aurora", 200, false)).toBe("api");
    expect(classify("/api", 200, false)).toBe("api");
  });

  it("never calls a static file a pageview", () => {
    // PR #174 measured 1,083,357 static requests in one day, 124 per page load.
    expect(classify("/_next/static/chunks/main.js", 200, false)).toBe("asset");
    expect(classify("/icon-512.png", 200, false)).toBe("asset");
    expect(classify("/fonts/inter.woff2", 200, false)).toBe("asset");
  });

  it("never calls a data file a pageview", () => {
    // EVERY PATH HERE WAS REPORTED AS A PAGEVIEW by the first run of the rollup job
    // over 11,513 real rows. It claimed 5,043 pageviews; the true figure was about 310.
    // These are fetched BY a page, which is also why they made the referrer panel say
    // the site's biggest traffic source was itself.
    for (const p of [
      "/manifest.webmanifest",
      "/sky/naked-eye.json",
      "/geo/countries-110m.geojson",
      "/webcams/manifest.json",
      "/webcams/t/r013310.json",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(classify(p, 200, false), p).toBe("asset");
    }
  });

  it("still treats a page whose slug happens to contain a dot as a page", () => {
    // The asset rule is extension-based, and camera ids are not sanitised into it.
    expect(classify("/camera/ab.cd", 200, false)).toBe("page");
  });

  it("classifies probes for a server this is not", () => {
    for (const p of ["/server-status", "/wp-login.php", "/.env", "/.git/config", "/v2/_catalog", "/phpmyadmin"]) {
      expect(classify(p, 404, false), p).toBe("scanner");
    }
  });

  it("counts a .php request as a probe even when it somehow returns 200", () => {
    // This application has never served a PHP file, so the status is irrelevant.
    expect(classify("/index.php", 200, false)).toBe("scanner");
  });

  it("does not count a declared robot as a pageview", () => {
    expect(classify("/camera/abc", 200, true)).toBe("other");
    expect(classify("/camera/abc", 200, false)).toBe("page");
  });

  it("counts a 304 as a pageview and a 404 as not one", () => {
    // A repeat visitor whose cache was still valid opened the page just as much as
    // anyone else; a 404 is a reader who saw nothing.
    expect(classify("/cameras", 304, false)).toBe("page");
    expect(classify("/cameras", 404, false)).toBe("other");
    expect(classify("/cameras", 500, false)).toBe("other");
  });
});

describe("isBot and deviceOf", () => {
  it("recognises the crawlers and tooling that actually show up in this log", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "l9scan/2.0",
      "curl/8.5.0",
      "python-requests/2.32.3",
      "Go-http-client/2.0",
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0",
      "Discordbot/2.0",
    ]) {
      expect(isBot(ua), ua).toBe(true);
    }
    expect(isBot(HUMAN)).toBe(false);
    expect(isBot(PHONE)).toBe(false);
  });

  it("separates phone from tablet from desktop", () => {
    expect(deviceOf(PHONE)).toBe("mobile");
    expect(deviceOf(HUMAN)).toBe("desktop");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe("tablet");
    // Android WITHOUT "Mobile" is the tablet signal; with it, a phone.
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141 Safari/537.36")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/141 Safari/537.36")).toBe(
      "mobile",
    );
    expect(deviceOf("Googlebot/2.1")).toBe("bot");
  });
});

describe("referrerHost", () => {
  it("folds our own host into (self), because internal navigation is not a channel", () => {
    expect(referrerHost("https://provenance-online.com/app", "provenance-online.com")).toBe("(self)");
    expect(referrerHost("https://www.provenance-online.com/x", "provenance-online.com")).toBe("(self)");
  });

  it("reports a real referrer by hostname only", () => {
    expect(referrerHost("https://www.reddit.com/r/OSINT/comments/abc/", "provenance-online.com")).toBe(
      "www.reddit.com",
    );
  });

  it("treats an absent referrer as (direct) and a broken one as (unparseable)", () => {
    expect(referrerHost(undefined, "provenance-online.com")).toBe("(direct)");
    expect(referrerHost("", "provenance-online.com")).toBe("(direct)");
    expect(referrerHost("not a url", "provenance-online.com")).toBe("(unparseable)");
  });
});

describe("dayKey and hourOf", () => {
  it("splits days on the UTC boundary", () => {
    // 2026-09-07T23:59:59Z and one second later are different days, and the rollup job
    // reads a single log file across that boundary.
    expect(dayKey(Date.parse("2026-09-07T23:59:59Z") / 1000)).toBe("2026-09-07");
    expect(dayKey(Date.parse("2026-09-08T00:00:01Z") / 1000)).toBe("2026-09-08");
  });

  it("reads the hour in UTC, not in the box's local zone", () => {
    expect(hourOf(Date.parse("2026-09-07T13:45:00Z") / 1000)).toBe(13);
  });
});

describe("foldRow", () => {
  it("counts a page request as one pageview, in the right hour and path", () => {
    const day = emptyDay("2026-09-07");
    expect(foldRow(day, row({ uri: "/cameras?page=2", ts: Date.parse("2026-09-07T13:00:00Z") / 1000 }), ctx)).toBe(
      true,
    );
    expect(day.pageviews).toBe(1);
    expect(day.requests).toBe(1);
    expect(day.byPath["/cameras"]).toBe(1);
    expect(day.byHour[13]).toBe(1);
    expect(day.byCountry["GB"]).toBe(1);
    expect(day.byDevice["desktop"]).toBe(1);
    expect(day.byStatus["200"]).toBe(1);
  });

  it("counts an API request without touching pageviews, and records its bytes", () => {
    const day = emptyDay("2026-09-07");
    foldRow(day, row({ uri: "/api/planes", size: 1_300_000 }), ctx);
    expect(day.pageviews).toBe(0);
    expect(day.byPath).toEqual({});
    expect(day.apiRequests).toBe(1);
    expect(day.apiBytes).toBe(1_300_000);
    expect(day.byApiBytes["/api/planes"]).toBe(1_300_000);
    // Still a request, and still bytes off the box's bandwidth.
    expect(day.requests).toBe(1);
    expect(day.bytes).toBe(1_300_000);
  });

  it("keeps scanners out of every traffic figure but still counts them", () => {
    const day = emptyDay("2026-09-07");
    foldRow(day, row({ uri: "/wp-login.php", status: 404 }), ctx);
    expect(day.pageviews).toBe(0);
    expect(day.scannerRequests).toBe(1);
    expect(day.byPath).toEqual({});
    expect(day.errors["404 /wp-login.php"]).toBe(1);
  });

  it("separates arrivals through Cloudflare from arrivals straight at the origin", () => {
    // Cf-Ipcountry present means proxied; absent means the visitor's resolver still had
    // the pre-cutover delegation. That distinction is what the firewall gate reads.
    const day = emptyDay("2026-09-07");
    foldRow(day, row(), ctx);
    foldRow(day, row({ country: "" }), ctx);
    expect(day.viaCloudflare).toBe(1);
    expect(day.direct).toBe(1);
    expect(day.byCountry["(unknown)"]).toBe(1);
  });

  it("rejects a row from the error logger, which would otherwise double-count", () => {
    const day = emptyDay("2026-09-07");
    expect(foldRow(day, { ...row(), logger: "http.log.error.log0" }, ctx)).toBe(false);
    expect(day.requests).toBe(0);
  });

  it("rejects a row with no request object or no timestamp", () => {
    const day = emptyDay("2026-09-07");
    expect(foldRow(day, { ts: 1, logger: "http.log.access.log0" }, ctx)).toBe(false);
    expect(foldRow(day, { ...row(), ts: undefined }, ctx)).toBe(false);
    expect(day.requests).toBe(0);
  });

  it("buckets response time and never lands outside the bucket array", () => {
    const day = emptyDay("2026-09-07");
    for (const seconds of [0.01, 0.2, 0.5, 2, 30]) {
      foldRow(day, row({ uri: "/", duration: seconds }), ctx);
    }
    expect(day.durationBuckets).toHaveLength(DURATION_EDGES_MS.length + 1);
    expect(day.durationBuckets.reduce((a, b) => a + b, 0)).toBe(5);
    // 30 s belongs in the overflow bucket, not silently in the last named one.
    expect(day.durationBuckets[DURATION_EDGES_MS.length]).toBe(1);
    expect(day.durationCount).toBe(5);
  });

  it("reports a visitor key only for pageviews", () => {
    const seen: string[] = [];
    const c = { ...ctx, visitorKey: (ip: string, ua: string) => `${ip}|${ua.slice(0, 4)}`, noteVisitor: (k: string) => seen.push(k) };
    const day = emptyDay("2026-09-07");
    foldRow(day, row({ uri: "/" }), c);
    foldRow(day, row({ uri: "/api/planes" }), c);
    foldRow(day, row({ uri: "/_next/static/x.js" }), c);
    expect(seen).toEqual(["86.20.0.0|Mozi"]);
  });
});

describe("capMap", () => {
  it("preserves the total when it folds the tail away", () => {
    // A panel built on a capped map still adds up. Losing the total instead of just the
    // names would make every percentage on the dashboard wrong.
    const map: Record<string, number> = {};
    for (let i = 0; i < 50; i++) map[`/p${i}`] = i + 1;
    const before = Object.values(map).reduce((a, b) => a + b, 0);
    capMap(map, 10);
    expect(Object.keys(map)).toHaveLength(11); // 10 kept, plus (other)
    expect(Object.values(map).reduce((a, b) => a + b, 0)).toBe(before);
    expect(map["/p49"]).toBe(50); // the largest survived
    expect(map["(other)"]).toBeGreaterThan(0);
  });

  it("does nothing when the map is under the cap", () => {
    const map = { "/a": 1, "/b": 2 };
    capMap(map, 10);
    expect(map).toEqual({ "/a": 1, "/b": 2 });
  });

  it("keeps folding into an existing (other) rather than replacing it", () => {
    const map: Record<string, number> = { "(other)": 100 };
    for (let i = 0; i < 20; i++) map[`/p${i}`] = 1;
    capMap(map, 5);
    expect(Object.values(map).reduce((a, b) => a + b, 0)).toBe(120);
  });
});

describe("mergeDay", () => {
  it("sums counters and hours but takes the larger visitor count, never the sum", () => {
    // Two partial visitor sets overlap by an unknown amount. Adding them counts the
    // same person twice; the larger figure is the only one certainly not inflated.
    const a = emptyDay("2026-09-07");
    const b = emptyDay("2026-09-07");
    a.pageviews = 10;
    b.pageviews = 5;
    a.visitors = 7;
    b.visitors = 4;
    a.byHour[3] = 2;
    b.byHour[3] = 5;
    a.byPath["/x"] = 3;
    b.byPath["/x"] = 4;
    b.byPath["/y"] = 1;
    const m = mergeDay(a, b);
    expect(m.pageviews).toBe(15);
    expect(m.visitors).toBe(7);
    expect(m.byHour[3]).toBe(7);
    expect(m.byPath).toEqual({ "/x": 7, "/y": 1 });
  });

  it("does not mutate either input", () => {
    const a = emptyDay("2026-09-07");
    const b = emptyDay("2026-09-07");
    a.byPath["/x"] = 1;
    b.byPath["/x"] = 1;
    mergeDay(a, b);
    expect(a.byPath["/x"]).toBe(1);
    expect(b.byPath["/x"]).toBe(1);
  });
});

describe("topN", () => {
  it("orders by count and breaks ties by key so the panel does not shuffle", () => {
    expect(topN({ b: 2, a: 2, c: 5 }, 3)).toEqual([
      { key: "c", count: 5 },
      { key: "a", count: 2 },
      { key: "b", count: 2 },
    ]);
  });
});
