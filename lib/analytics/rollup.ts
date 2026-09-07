// lib/analytics/rollup.ts
//
// THE ACCESS LOG IS THE ONLY RECORD OF TRAFFIC THIS PROJECT OWNS, AND IT EXPIRES.
// deploy/Caddyfile rolls at 50 MiB and keeps 5, measured at ~1,006 bytes a row after
// the field trim, which is about 260,000 rows — roughly THREE AND A HALF DAYS. Nothing
// else writes traffic down: Vercel's Web Analytics stopped collecting the moment the
// site left Vercel, and Cloudflare's free plan has no analytics API to read back. So a
// day that is not rolled up before it rotates out is a day that never existed.
//
// That is why this file is a fold rather than a query. Everything here is pure: given
// a day's accumulator and one parsed log row, produce the updated accumulator. All the
// I/O — finding log files, tracking how far each has been read, writing the result —
// lives in scripts/rollup-access-log.ts, so the counting rules can be tested against
// hand-written rows instead of against a live server.
//
// WHAT THE LOG CANNOT ANSWER, so that nothing downstream pretends otherwise: bounce
// rate, time on page, scroll depth and misclicks are all things a visitor does WITHOUT
// making another request. They never reach a server and are not in here at any
// resolution. That is the beacon's half of the split (lib/analytics/beacon.ts), and
// search impressions and queries are Search Console's. This file is the traffic truth
// and nothing more: who asked for what, how often, how big, how fast, from where.

/** One row of Caddy's JSON access log, narrowed to the fields the Caddyfile keeps. */
export interface AccessRow {
  ts?: number;
  logger?: string;
  request?: {
    client_ip?: string;
    remote_ip?: string;
    method?: string;
    host?: string;
    uri?: string;
    headers?: Record<string, string[] | undefined>;
  };
  duration?: number;
  size?: number;
  status?: number;
}

/** What a request was FOR. Every request lands in exactly one of these. */
export type Kind = "page" | "api" | "asset" | "scanner" | "other";

export interface DayRollup {
  date: string;
  /** Unix seconds of the last fold. Lets the dashboard say how fresh a day is. */
  updated: number;
  requests: number;
  bytes: number;
  /** Documents a person actually opened. NOT the request count — see classify(). */
  pageviews: number;
  apiRequests: number;
  apiBytes: number;
  assetRequests: number;
  /** Probes for things this site has never served. Counted, never merged into traffic. */
  scannerRequests: number;
  botRequests: number;
  /** Arrived through Cloudflare (carries Cf-Ipcountry) versus straight at the origin. */
  viaCloudflare: number;
  direct: number;
  /** Distinct salted (masked-ip, user-agent) pairs. Approximate by construction. */
  visitors: number;
  /** Pageviews by UTC hour, 24 entries. */
  byHour: number[];
  byPath: Record<string, number>;
  byStatus: Record<string, number>;
  byReferrer: Record<string, number>;
  byCountry: Record<string, number>;
  byDevice: Record<string, number>;
  byApiPath: Record<string, number>;
  byApiBytes: Record<string, number>;
  /** "<status> <path>" for every 4xx and 5xx, so a broken link is findable. */
  errors: Record<string, number>;
  /** Response time of page requests, bucketed. Sum is milliseconds. */
  durationMsSum: number;
  durationCount: number;
  durationBuckets: number[];
}

/** Upper edges in milliseconds for durationBuckets; the last bucket is everything above. */
export const DURATION_EDGES_MS = [100, 300, 1_000, 3_000] as const;

/**
 * How many distinct keys any one map may hold before the tail is folded into "(other)".
 *
 * This is a memory bound, not a display limit. ~18,766 camera pages exist, and a
 * crawler working through all of them would otherwise put every one into byPath and
 * into the state file that is rewritten every five minutes. The dashboard never shows
 * more than a few dozen rows anyway, but the cap has to be generous enough that a real
 * long tail is still visible behind the top of the list.
 */
export const MAP_CAP = 3_000;

/** Paths that only ever appear because something is probing for a different server. */
const SCANNER_PREFIXES = [
  "/server-status",
  "/v2/_catalog",
  "/wp-admin",
  "/wp-content",
  "/wp-includes",
  "/wp-login",
  "/xmlrpc.php",
  "/phpmyadmin",
  "/pma",
  "/actuator",
  "/cgi-bin",
  "/vendor/phpunit",
  "/.git",
  "/.env",
  "/.aws",
  "/.ssh",
  "/.DS_Store",
  "/config.json",
  "/telescope",
  "/solr",
  "/druid",
  "/hudson",
  "/jenkins",
  "/boaform",
  "/HNAP1",
];

/**
 * Extensions no page ever ends in here, so a request for one is either a probe or an
 * asset. `.php` is the giveaway: this application has never served a single one.
 */
const SCANNER_EXTS = [".php", ".asp", ".aspx", ".jsp", ".cgi", ".sql", ".bak", ".zip", ".rar", ".tar", ".gz", ".7z"];

/**
 * Static files. Real, wanted, and not a pageview.
 *
 * THE DATA EXTENSIONS ARE HERE BECAUSE OF A MEASUREMENT, not a guess. A dry run over
 * 11,513 real rows reported 5,043 pageviews, and the top of the list was
 * /manifest.webmanifest at 121, /sky/naked-eye.json at 47,
 * /geo/countries-110m.geojson at 35 and a run of /webcams/t/*.json tiles — none of
 * which a person opens. The actual figure was about 310. Every one of those files is
 * fetched BY a page, carrying that page's own URL as its referrer, which is also why
 * "(self)" was 4,788 of 5,043 referrers: the referrer panel was reporting the site's
 * biggest traffic source as itself.
 *
 * Anything served out of public/ therefore belongs here. It is an extension list rather
 * than a prefix list so that a data file added under some new directory is covered on
 * the day it appears rather than the day someone notices.
 */
const ASSET_EXTS = [
  ".js",
  ".mjs",
  ".css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".webm",
  ".m3u8",
  ".m4s",
  ".vtt",
  ".pdf",
  ".wasm",
  ".bin",
  // Data, not documents. The console fetches all of these.
  ".json",
  ".geojson",
  ".topojson",
  ".webmanifest",
  ".csv",
  ".pmtiles",
  // Crawler-facing, and not something a reader opens.
  ".txt",
  ".xml",
];

/**
 * Substrings that mean the client declared itself non-human.
 *
 * DECLARED is the operative word. This catches what is honest, which is most volume
 * and none of the traffic anyone is trying to hide. It is a floor on the bot count,
 * never a ceiling, and a dashboard that reports "humans" from it is reporting
 * "requests that did not admit to being a bot".
 */
const BOT_TOKENS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "scrap",
  "curl/",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "java/",
  "okhttp",
  "libwww",
  "headlesschrome",
  "phantomjs",
  "l9scan",
  "masscan",
  "zgrab",
  "nmap",
  "httpx",
  "axios/",
  "node-fetch",
  "postman",
  "monitoring",
  "uptime",
  "feedfetcher",
  "preview",
];

/** UTC calendar day of a Caddy `ts` (float unix seconds). */
export function dayKey(ts: number): string {
  return new Date(Math.floor(ts * 1000)).toISOString().slice(0, 10);
}

/** UTC hour, 0-23. */
export function hourOf(ts: number): number {
  return new Date(Math.floor(ts * 1000)).getUTCHours();
}

function lowerExt(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

/**
 * The path, with the query string, the fragment and any trailing slash removed, and
 * percent-encoding decoded. "" collapses to "/".
 *
 * DECODING IS FOR THE PANEL, and it is worth the two lines. Camera ids contain colons,
 * so the log is full of rows like /camera/castlerock%3Aon%3A82 — readable enough to
 * guess at and tiring enough to read a column of. A malformed escape makes
 * decodeURIComponent throw, so the raw path is the fallback rather than the exception.
 */
export function normalisePath(uri: string): string {
  const q = uri.indexOf("?");
  let p = q === -1 ? uri : uri.slice(0, q);
  const h = p.indexOf("#");
  if (h !== -1) p = p.slice(0, h);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (!p) return "/";
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

export function isBot(ua: string): boolean {
  const low = ua.toLowerCase();
  return BOT_TOKENS.some((t) => low.includes(t));
}

/**
 * Coarse device class, from the user agent alone.
 *
 * Three buckets and no more. A user-agent string cannot tell you a model or a screen
 * size without a lookup table that goes stale, and the question the dashboard actually
 * asks is whether the console is being opened on a phone — which decides whether the
 * map's touch handling matters. "tablet" is separate because an iPad opening the
 * console is a desktop-shaped session on a touch device, which is its own answer.
 */
export function deviceOf(ua: string): "mobile" | "tablet" | "desktop" | "bot" {
  if (isBot(ua)) return "bot";
  const low = ua.toLowerCase();
  if (low.includes("ipad") || (low.includes("android") && !low.includes("mobile"))) return "tablet";
  if (low.includes("mobi") || low.includes("iphone") || low.includes("ipod") || low.includes("android")) {
    return "mobile";
  }
  return "desktop";
}

/**
 * The referrer reduced to a hostname, with our own host folded into "(self)".
 *
 * INTERNAL NAVIGATION IS NOT A CHANNEL, and leaving it in is how a referrer panel ends
 * up reporting that the site's biggest traffic source is itself. "(direct)" covers both
 * a genuinely typed URL and a referrer the browser withheld; those are indistinguishable
 * from here and combining them is the honest reading.
 */
export function referrerHost(referer: string | undefined, selfHost: string): string {
  if (!referer) return "(direct)";
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return "(unparseable)";
  }
  if (!host) return "(direct)";
  const self = selfHost.toLowerCase().replace(/^www\./, "");
  if (host === self || host === `www.${self}`) return "(self)";
  return host;
}

/** What the request was for. Order matters: scanner beats asset beats page. */
export function classify(path: string, status: number, bot: boolean): Kind {
  const ext = lowerExt(path);
  if (SCANNER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(p))) return "scanner";
  if (SCANNER_EXTS.includes(ext)) return "scanner";
  if (path.startsWith("/api/") || path === "/api") return "api";
  if (path.startsWith("/_next/") || path.startsWith("/__next")) return "asset";
  if (ASSET_EXTS.includes(ext)) return "asset";
  // A document only counts as a pageview when a person could actually have seen it:
  // GET-shaped, delivered, and not a declared robot. 304 counts — a repeat visitor
  // whose cache was still valid opened the page just as much as anyone else.
  if (!bot && (status === 200 || status === 304)) return "page";
  return "other";
}

export function emptyDay(date: string): DayRollup {
  return {
    date,
    updated: 0,
    requests: 0,
    bytes: 0,
    pageviews: 0,
    apiRequests: 0,
    apiBytes: 0,
    assetRequests: 0,
    scannerRequests: 0,
    botRequests: 0,
    viaCloudflare: 0,
    direct: 0,
    visitors: 0,
    byHour: new Array(24).fill(0),
    byPath: {},
    byStatus: {},
    byReferrer: {},
    byCountry: {},
    byDevice: {},
    byApiPath: {},
    byApiBytes: {},
    errors: {},
    durationMsSum: 0,
    durationCount: 0,
    durationBuckets: new Array(DURATION_EDGES_MS.length + 1).fill(0),
  };
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/**
 * Fold the tail of a map into "(other)" once it grows past the cap.
 *
 * The counts are PRESERVED, not discarded — the total across the map is the same
 * before and after — so a panel built on this still adds up. Only the ability to name
 * the individual long-tail entries is lost, which is the trade the cap exists to make.
 */
export function capMap(map: Record<string, number>, cap = MAP_CAP): void {
  const keys = Object.keys(map);
  if (keys.length <= cap) return;
  const sorted = keys.sort((a, b) => (map[b] ?? 0) - (map[a] ?? 0));
  let other = map["(other)"] ?? 0;
  for (const k of sorted.slice(cap)) {
    if (k === "(other)") continue;
    other += map[k] ?? 0;
    delete map[k];
  }
  if (other > 0) map["(other)"] = other;
}

export interface FoldContext {
  /** The site's own hostname, so self-referrals are not counted as a channel. */
  selfHost: string;
  /** Called with the visitor key for the row, when the row is a pageview. */
  noteVisitor?: (key: string) => void;
  /** Salted, non-reversible identity for the noteVisitor key. */
  visitorKey?: (ip: string, ua: string) => string;
}

/**
 * Add one row to a day. Returns false when the row is not an access-log entry at all.
 *
 * The caller owns choosing WHICH day — a single log file spans midnight — so this
 * never looks at `day.date`.
 */
export function foldRow(day: DayRollup, row: AccessRow, ctx: FoldContext): boolean {
  const req = row.request;
  if (!req || typeof row.ts !== "number") return false;
  // The site log and the default logger both end up on disk in some deployments, and
  // only the former is a request. Anything else here would double-count.
  if (row.logger && !row.logger.startsWith("http.log.access")) return false;

  const headers = req.headers ?? {};
  const ua = headers["User-Agent"]?.[0] ?? "";
  const path = normalisePath(req.uri ?? "/");
  const status = typeof row.status === "number" ? row.status : 0;
  const bot = isBot(ua);
  const kind = classify(path, status, bot);
  const size = typeof row.size === "number" ? row.size : 0;

  day.requests += 1;
  day.bytes += size;
  if (bot) day.botRequests += 1;
  if (headers["Cf-Ipcountry"]?.[0]) day.viaCloudflare += 1;
  else day.direct += 1;
  bump(day.byStatus, String(status));
  if (status >= 400) bump(day.errors, `${status} ${path}`);

  switch (kind) {
    case "scanner":
      day.scannerRequests += 1;
      break;
    case "asset":
      day.assetRequests += 1;
      break;
    case "api":
      day.apiRequests += 1;
      day.apiBytes += size;
      bump(day.byApiPath, path);
      bump(day.byApiBytes, path, size);
      break;
    case "page": {
      day.pageviews += 1;
      day.byHour[hourOf(row.ts)] = (day.byHour[hourOf(row.ts)] ?? 0) + 1;
      bump(day.byPath, path);
      bump(day.byReferrer, referrerHost(headers["Referer"]?.[0], ctx.selfHost));
      bump(day.byCountry, headers["Cf-Ipcountry"]?.[0] ?? "(unknown)");
      bump(day.byDevice, deviceOf(ua));
      if (typeof row.duration === "number") {
        const ms = row.duration * 1000;
        day.durationMsSum += ms;
        day.durationCount += 1;
        let i = DURATION_EDGES_MS.findIndex((edge) => ms < edge);
        if (i === -1) i = DURATION_EDGES_MS.length;
        day.durationBuckets[i] = (day.durationBuckets[i] ?? 0) + 1;
      }
      if (ctx.noteVisitor && ctx.visitorKey) {
        ctx.noteVisitor(ctx.visitorKey(req.client_ip ?? req.remote_ip ?? "", ua));
      }
      break;
    }
    default:
      break;
  }

  day.updated = Math.max(day.updated, Math.floor(row.ts));
  return true;
}

/** Apply every cardinality cap. Call once per write, not once per row. */
export function capDay(day: DayRollup, cap = MAP_CAP): void {
  capMap(day.byPath, cap);
  capMap(day.byReferrer, cap);
  capMap(day.byCountry, cap);
  capMap(day.byApiPath, cap);
  capMap(day.byApiBytes, cap);
  capMap(day.errors, cap);
  capMap(day.byStatus, cap);
  capMap(day.byDevice, cap);
}

/**
 * Merge `b` into `a`. Used when a day that was already written back has to absorb late
 * rows, which happens only if the job stops running for longer than the finalise lag.
 */
export function mergeDay(a: DayRollup, b: DayRollup): DayRollup {
  const out: DayRollup = {
    ...a,
    updated: Math.max(a.updated, b.updated),
    requests: a.requests + b.requests,
    bytes: a.bytes + b.bytes,
    pageviews: a.pageviews + b.pageviews,
    apiRequests: a.apiRequests + b.apiRequests,
    apiBytes: a.apiBytes + b.apiBytes,
    assetRequests: a.assetRequests + b.assetRequests,
    scannerRequests: a.scannerRequests + b.scannerRequests,
    botRequests: a.botRequests + b.botRequests,
    viaCloudflare: a.viaCloudflare + b.viaCloudflare,
    direct: a.direct + b.direct,
    // NOT summed. Two partial visitor sets overlap by an unknown amount, and adding
    // them would count the same person twice. The larger figure is the only one that
    // is certainly not an overstatement.
    visitors: Math.max(a.visitors, b.visitors),
    byHour: a.byHour.map((n, i) => n + (b.byHour[i] ?? 0)),
    durationMsSum: a.durationMsSum + b.durationMsSum,
    durationCount: a.durationCount + b.durationCount,
    durationBuckets: a.durationBuckets.map((n, i) => n + (b.durationBuckets[i] ?? 0)),
    byPath: { ...a.byPath },
    byStatus: { ...a.byStatus },
    byReferrer: { ...a.byReferrer },
    byCountry: { ...a.byCountry },
    byDevice: { ...a.byDevice },
    byApiPath: { ...a.byApiPath },
    byApiBytes: { ...a.byApiBytes },
    errors: { ...a.errors },
  };
  const maps = ["byPath", "byStatus", "byReferrer", "byCountry", "byDevice", "byApiPath", "byApiBytes", "errors"] as const;
  for (const m of maps) {
    for (const [k, v] of Object.entries(b[m])) bump(out[m], k, v);
  }
  return out;
}

/** Top N entries of a count map, largest first, ties broken by key for stability. */
export function topN(map: Record<string, number>, n: number): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}
