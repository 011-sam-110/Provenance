import type { SignalFeature } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { EMBASSY_POSTS, type EmbassyPost, type PostCity } from "@/lib/signals/embassy-posts.data";
import { fallbackWorth, httpGet } from "@/lib/signals/httpGet";

// U.S. Embassy and consulate alerts — "Demonstration Alert" and "Security Alert" posts.
//
// WHAT THEY ARE. Each U.S. embassy publishes alerts for U.S. citizens on its own website,
// as a WordPress RSS feed (https://<post>/category/alert/feed/). A demonstration alert
// names the city, often the streets, and the date of a protest; a security alert warns of
// fighting, attacks or gunfire. They are official warnings from a government that has
// staff in the country, written for people who must act on them. State Department
// content is in the public domain unless marked otherwise (state.gov/copyright-information).
//
// WHAT THEY ARE NOT. An alert is a warning, often in advance, not a report that something
// happened. A security alert about consular closures or holiday crowds is not about
// violence, so only alerts whose own text names fighting, attacks, gunfire and the like
// reach the conflict layer, and only demonstration alerts (or security alerts about
// protests) reach the protests layer. "Worldwide Caution" is not about any one place and
// never counts.
//
// PLACEMENT. An alert is placed on a city only when it NAMES one: first in its own
// "Location:" line, then in its title. The cities come from the post's own country in
// lib/signals/embassy-posts.data.ts (GeoNames). An alert that names no listed city
// ("Location: Ethiopia", "Norte de Santander Department") is a country-level feature,
// shaded, never a pin on the capital it did not name.
//
// FETCH. 177 feeds. Each is read at most once an hour with If-Modified-Since, six at a
// time, inside a time budget per call; a feed not reached this call keeps its last copy
// and is first in line next call. The CDN refuses a bare browser UA and curl's default,
// and accepts a bot UA that names itself.

const UA = "Mozilla/5.0 (compatible; Provenance/2.0; +https://provenance-online.com)";
const FEED_TTL_MS = 60 * 60 * 1000;
const CONCURRENCY = 6;
const CALL_BUDGET_MS = 25_000;
/** Alerts older than this are history, not a current warning. */
export const ALERT_WINDOW_DAYS = 7;

export type AlertKind = "protest" | "conflict";

/** One RSS item, before classification. */
export interface FeedItem {
  title: string;
  link: string;
  /** Epoch ms. */
  published: number;
  /** Item body, HTML stripped. */
  text: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'");

const stripTags = (html: string) =>
  decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/[​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Pure: an RSS 2.0 document → its items. Tolerates CDATA and entity-encoded titles. */
export function parseAlertFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1]!;
    const tag = (name: string) => it.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";
    const title = stripTags(tag("title"));
    const link = decodeEntities(tag("link")).trim();
    const published = Date.parse(decodeEntities(tag("pubDate")).trim());
    const body = tag("content:encoded") || tag("description");
    if (!title || !Number.isFinite(published)) continue;
    out.push({ title, link, published, text: stripTags(body) });
  }
  return out;
}

const FIELD_LABELS = /\b(?:Location|Locations|Date\/Time|Date|Time|Event|Events|Actions to Take|Assistance)\s*:/gi;

/** Pure: the "Location:" and "Event:" lines of an alert body, when it has them. */
export function alertFields(text: string): { location?: string; event?: string } {
  const take = (label: RegExp) => {
    const m = label.exec(text);
    if (!m) return undefined;
    const start = m.index + m[0].length;
    FIELD_LABELS.lastIndex = start;
    const next = FIELD_LABELS.exec(text);
    const value = text.slice(start, next ? next.index : start + 400).trim();
    return value || undefined;
  };
  return {
    location: take(/\bLocations?\s*:/i),
    event: take(/\bEvents?\s*:/i),
  };
}

const CONFLICT_WORDS =
  /\b(fighting|armed (?:conflict|groups?|clashes|attacks?)|clash(?:es)?|attacks?|terroris[mt]s?|terrorist|militants?|military (?:action|operations?|activity|installations?)|missiles?|air ?strikes?|drone (?:attacks?|strikes?)|shelling|gunfire|gunmen|shootings?|insurgen\w*|hostilities|kidnapp?\w*|explosions?|bombings?|bombs?|car bomb|IEDs?)\b/i;
const PROTEST_WORDS =
  /\b(demonstrations?|demonstrators|protests?|protesters|protestors|strikes?|strike action|unrest|riots?|marches|march|rall(?:y|ies)|sit-ins?|blockades?)\b/i;
const NOT_PROTEST = /\b(?:air|drone|missile)[ -]?strikes?\b/gi;

/**
 * Pure: which layer an alert belongs to, or undefined for neither.
 * A demonstration alert is a protest. A security alert is conflict when its title or
 * event line names violence, else a protest when it names one, else neither.
 */
export function classifyAlert(title: string, event = ""): AlertKind | undefined {
  if (/worldwide caution/i.test(title)) return undefined;
  if (/demonstration alert/i.test(title)) return "protest";
  if (!/security alert/i.test(title)) return undefined;
  const text = `${title} ${event}`;
  if (CONFLICT_WORDS.test(text)) return "conflict";
  if (PROTEST_WORDS.test(text.replace(NOT_PROTEST, ""))) return "protest";
  return undefined;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Pure: the city an alert names, from the post's own country. The FIRST city named wins,
 * because a Location line lists the main place first ("Tirana, Shkoder, Durres..."); at
 * the same position the longer name wins, so "Mexico City" beats "Mexico". Whole words only.
 */
export function namedCity(text: string, cities: PostCity[]): PostCity | undefined {
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  let best: PostCity | undefined;
  let bestAt = Infinity;
  let bestLen = 0;
  for (const c of cities) {
    for (const spelling of [c[0], c[3]]) {
      if (!spelling) continue;
      const needle = fold(spelling).replace(/[^a-z0-9]+/g, " ").trim();
      if (needle.length < 3) continue;
      const at = hay.indexOf(` ${needle} `);
      if (at < 0) continue;
      if (at < bestAt || (at === bestAt && needle.length > bestLen)) {
        best = c;
        bestAt = at;
        bestLen = needle.length;
      }
    }
  }
  return best;
}

export interface EmbassyAlert {
  kind: AlertKind;
  post: EmbassyPost;
  item: FeedItem;
  location?: string;
  event?: string;
  city?: PostCity;
}

/** Pure: one post's feed items → its classified alerts inside the window. */
export function postAlerts(post: EmbassyPost, items: FeedItem[], now: number, windowDays = ALERT_WINDOW_DAYS): EmbassyAlert[] {
  const out: EmbassyAlert[] = [];
  for (const item of items) {
    if (now - item.published > windowDays * 86_400_000) continue;
    const { location, event } = alertFields(item.text);
    const kind = classifyAlert(item.title, event);
    if (!kind) continue;
    // The Location line first: it is the post's own statement of where. The title only
    // when there is no Location line, because a title also names the embassy itself.
    const city = location ? namedCity(location, post.cities) : namedCity(item.title, post.cities);
    out.push({ kind, post, item, location, event, city });
  }
  return out;
}

const KIND_LABEL: Record<AlertKind, string> = { protest: "Demonstration alert", conflict: "Security alert" };

/**
 * Pure: alerts of one kind → features. Several alerts from one post about one place
 * collapse into one marker that carries the newest and counts the rest, so a week of
 * daily Tirana updates is one marker, not seven stacked ones.
 */
export function normalizeEmbassyAlerts(alerts: EmbassyAlert[], kind: AlertKind, signalId: string, color: string): SignalFeature[] {
  const groups = new Map<string, EmbassyAlert[]>();
  for (const a of alerts) {
    if (a.kind !== kind) continue;
    const key = `${a.post.host}|${a.city ? a.city[0] : "country"}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(a);
  }
  const out: SignalFeature[] = [];
  for (const [key, list] of groups) {
    list.sort((x, y) => y.item.published - x.item.published);
    const a = list[0]!;
    const ctr = centroidByIso2(a.post.iso2);
    if (!a.city && !ctr) continue;
    const where = a.city ? `${a.city[0]}, ${ctr?.name ?? a.post.iso2}` : (ctr?.name ?? a.post.iso2);
    out.push({
      id: `embassy:${signalId}:${key.replace(/[^a-z0-9|.-]/gi, "_")}`,
      lat: a.city ? a.city[1] : ctr!.lat,
      lon: a.city ? a.city[2] : ctr!.lon,
      title: `${KIND_LABEL[kind]} — ${where}`,
      signalId,
      precision: a.city ? "area" : "country",
      ...(ctr ? { countryIso3: ctr.iso3 } : {}),
      color,
      ts: new Date(a.item.published).toISOString(),
      link: /^https:\/\//.test(a.item.link) ? a.item.link : `https://${a.post.host}/category/alert/`,
      props: {
        source: "U.S. Embassy alert",
        issuedBy: a.post.host,
        alert: a.item.title,
        published: new Date(a.item.published).toISOString().slice(0, 10),
        location: a.location?.slice(0, 200),
        summary: a.event ? a.event.slice(0, 280) + (a.event.length > 280 ? "…" : "") : undefined,
        alertsThisWeek: list.length > 1 ? list.length : undefined,
        placed: a.city ? `On ${a.city[0]}, which the alert names` : "Country only: the alert names no city on our list",
        meaning: "An official warning to U.S. citizens, often issued in advance. NOT a report that anything happened.",
      },
    });
  }
  return out.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
}

// --- fetch ------------------------------------------------------------------

interface FeedState {
  items: FeedItem[];
  readAt: number;
  lastModified?: string;
  failedAt?: number;
}
const feeds = new Map<string, FeedState>();
let inflight: Promise<EmbassyRead> | null = null;

export interface EmbassyRead {
  alerts: EmbassyAlert[];
  /** Posts whose feed we hold a copy of. */
  held: number;
  /** Posts whose last read failed (they may still hold an older copy). */
  failed: number;
  total: number;
}

/**
 * Set the first time fetch fails on the oversized headers (see lib/signals/httpGet.ts);
 * after that every feed goes straight to the fallback rather than being asked twice.
 */
let headersOverflow = false;

async function getFeed(url: string, headers: Record<string, string>): Promise<{ status: number; body: string; lastModified?: string } | null> {
  if (!headersOverflow) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      return { status: res.status, body: res.status === 200 ? await res.text() : "", lastModified: res.headers.get("last-modified") ?? undefined };
    } catch (err) {
      if (!fallbackWorth(err, ["UND_ERR_HEADERS_OVERFLOW"])) return null;
      headersOverflow = true;
    }
  }
  const r = await httpGet(url, { headers, timeoutMs: 15_000, maxHeaderSize: 65_536 });
  return r ? { status: r.status, body: r.body, lastModified: r.headers["last-modified"] } : null;
}

async function readFeed(post: EmbassyPost): Promise<void> {
  const prev = feeds.get(post.host);
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/rss+xml, application/xml" };
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  const res = await getFeed(`https://${post.host}/category/alert/feed/`, headers);
  const now = Date.now();
  if (res && res.status === 304 && prev) {
    feeds.set(post.host, { ...prev, readAt: now, failedAt: undefined });
    return;
  }
  if (!res || res.status !== 200 || !res.body.includes("<rss")) {
    feeds.set(post.host, { items: prev?.items ?? [], readAt: prev?.readAt ?? 0, lastModified: prev?.lastModified, failedAt: now });
    return;
  }
  feeds.set(post.host, { items: parseAlertFeed(res.body), readAt: now, lastModified: res.lastModified });
}

async function refresh(): Promise<EmbassyRead> {
  const started = Date.now();
  // Oldest copy first, so a feed the last budget did not reach is first in line.
  const due = EMBASSY_POSTS.filter((p) => started - (feeds.get(p.host)?.readAt ?? 0) >= FEED_TTL_MS).sort(
    (a, b) => (feeds.get(a.host)?.readAt ?? 0) - (feeds.get(b.host)?.readAt ?? 0),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < due.length && Date.now() - started < CALL_BUDGET_MS) {
        const post = due[next++]!;
        await readFeed(post);
      }
    }),
  );
  const now = Date.now();
  const alerts: EmbassyAlert[] = [];
  let held = 0;
  let failed = 0;
  for (const post of EMBASSY_POSTS) {
    const st = feeds.get(post.host);
    if (!st) continue;
    if (st.readAt > 0) held++;
    if (st.failedAt) failed++;
    alerts.push(...postAlerts(post, st.items, now));
  }
  return { alerts, held, failed, total: EMBASSY_POSTS.length };
}

/** Classified alerts from every post we hold a copy of. Never throws. */
export async function fetchEmbassyAlerts(): Promise<EmbassyRead> {
  if (!inflight) {
    inflight = refresh()
      .catch(() => ({ alerts: [], held: 0, failed: EMBASSY_POSTS.length, total: EMBASSY_POSTS.length }))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
