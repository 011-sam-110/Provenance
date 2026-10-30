// lib/signals/war-news.ts
// War news: posts from the outlets and public Telegram channels Sam chose, both sides,
// each labelled with its side. Read from the relay feed `war-news`, which NewsScraper's
// `sources/war_news.py` pushes from provenance-1 every hour (schema:
// lib/relay/schemas/war-news.ts).
//
// TWO OUTPUTS, ONE PURE MAPPING (`warNewsFrom`):
//   - features: only posts that are placed AND not opinion AND read by the model. Each
//     sits at its own precision: a town or a district is an `area` (a disc, never a pin),
//     a named site such as an air base is a `facility`. A post with no place is listed,
//     never drawn, and an opinion post is never drawn whatever it names.
//   - summary (lib/signals/summary.ts): EVERY post for the widget's list, the counts by
//     side and by war zone, every outlet with its status, and what the model has not read.
//
// SIDE is the outlet's own origin and stance, not a judgement of the post. The widget
// says it in text on every row ("UA", "RU", "IND"), so colour is never the only cue.
import type { SignalFeature, SignalPrecision, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { markSummary } from "@/lib/signals/summary";
import { usable } from "@/lib/relay/read";
import { readRelay, type RelaySnapshot } from "@/lib/relay/store";
import type { RelayData } from "@/lib/relay/feeds";

export type WarNewsSide = "ua" | "ru" | "independent";
export type WarNewsChannel = "rss" | "sitemap" | "telegram";

export const WAR_NEWS_SIDES: readonly WarNewsSide[] = ["ua", "ru", "independent"];

/** The side's name in text, for a badge's title and the counts. */
export const WAR_NEWS_SIDE_LABEL: Readonly<Record<WarNewsSide, string>> = {
  ua: "Ukrainian",
  ru: "Russian",
  independent: "Independent",
};

/** The badge text. Text, so the side never depends on colour. */
export const WAR_NEWS_SIDE_SHORT: Readonly<Record<WarNewsSide, string>> = {
  ua: "UA",
  ru: "RU",
  independent: "IND",
};

/** War zone ids the sender uses (sources/war_news.py ZONE_BY_COUNTRY), as the widget names them. */
const ZONE_LABEL: Readonly<Record<string, string>> = {
  ukraine: "Ukraine",
  "middle-east": "Middle East",
  sudan: "Sudan",
  myanmar: "Myanmar",
  sahel: "Sahel",
  drc: "DR Congo",
  somalia: "Somalia",
};

/** A zone id as words. An id this table does not know is shown with its hyphens as spaces. */
export function warNewsZoneLabel(zone: string | null): string {
  if (zone === null) return "No war zone";
  const known = ZONE_LABEL[zone];
  if (known) return known;
  const words = zone.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LANGUAGE: Readonly<Record<string, string>> = { ru: "Russian", uk: "Ukrainian", en: "English" };

/** "Russian" for "ru". The code itself when the table does not know it. */
export function warNewsLanguage(lang: string): string {
  return LANGUAGE[lang] ?? lang;
}

export interface WarNewsPost {
  id: string;
  outlet: string;
  channel: WarNewsChannel;
  side: WarNewsSide;
  url: string;
  title: string;
  summary: string | null;
  lang: string;
  translated: boolean;
  original: string | null;
  publishedAt: string;
  zone: string | null;
  /** The place's name and precision. Its coordinates are on the feature, when there is one. */
  place: { name: string; precision: SignalPrecision } | null;
  /** True when the post is on the map: placed, not opinion, read by the model. */
  mapped: boolean;
  opinion: boolean;
  /** False when the model has not read it yet: no zone and no place are known. */
  checked: boolean;
}

export interface WarNewsOutlet {
  id: string;
  name: string;
  side: WarNewsSide;
  channel: WarNewsChannel;
  home: string;
  why: string;
  opinion: boolean;
  status: "ok" | "failed" | "no-feed";
  detail: string | null;
  posts: number;
}

export interface WarNewsSummary {
  /** When provenance-1 read the outlets, ISO. */
  fetchedAt: string;
  /** Every post, newest first. */
  posts: WarNewsPost[];
  bySide: Record<WarNewsSide, number>;
  /** Largest first; posts with no war zone last. Unchecked posts are not in it. */
  byZone: { zone: string | null; count: number }[];
  /** Posts the model has not read yet that are listed anyway (English, no zone, no place). */
  unchecked: number;
  outlets: WarNewsOutlet[];
  /** New posts the model has not read yet, and why. */
  pending: { count: number; reason: string | null };
}

/** The feature id of a post on the map. The list and the mini-map join on it. */
export function warNewsFeatureId(postId: string): string {
  return `war-news:${postId}`;
}

/** PURE: the held snapshot -> map features and the widget's summary. */
export function warNewsFrom(snap: RelaySnapshot<RelayData<"war-news">>): {
  features: SignalFeature[];
  summary: WarNewsSummary;
} {
  const rows = [...snap.data.items].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id),
  );
  const features: SignalFeature[] = [];
  const posts: WarNewsPost[] = [];
  const bySide: Record<WarNewsSide, number> = { ua: 0, ru: 0, independent: 0 };
  const zones = new Map<string | null, number>();
  let unchecked = 0;

  for (const row of rows) {
    const mapped = row.place !== null && !row.opinion && row.checked;
    bySide[row.side] += 1;
    if (row.checked) zones.set(row.zone, (zones.get(row.zone) ?? 0) + 1);
    else unchecked += 1;
    posts.push({
      id: row.id,
      outlet: row.outlet,
      channel: row.channel,
      side: row.side,
      url: row.url,
      title: row.title,
      summary: row.summary,
      lang: row.lang,
      translated: row.translated,
      original: row.original,
      publishedAt: new Date(Date.parse(row.publishedAt)).toISOString(),
      zone: row.zone,
      place: row.place ? { name: row.place.name, precision: row.place.precision } : null,
      mapped,
      opinion: row.opinion,
      checked: row.checked,
    });
    if (!mapped || !row.place) continue;
    features.push({
      id: warNewsFeatureId(row.id),
      lat: row.place.lat,
      lon: row.place.lon,
      title: row.title,
      signalId: "war-news",
      precision: row.place.precision,
      link: row.url,
      ts: new Date(Date.parse(row.publishedAt)).toISOString(),
      props: {
        outlet: row.channel === "telegram" ? `${row.outlet} (Telegram)` : row.outlet,
        side: `${WAR_NEWS_SIDE_LABEL[row.side]} outlet`,
        place: row.place.name,
        ...(row.translated ? { translated: `Translated from ${warNewsLanguage(row.lang)}` } : {}),
        ...(row.zone ? { warZone: warNewsZoneLabel(row.zone) } : {}),
      },
    });
  }

  const byZone = [...zones.entries()]
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => (a.zone === null ? 1 : 0) - (b.zone === null ? 1 : 0) || b.count - a.count || String(a.zone).localeCompare(String(b.zone)));

  return {
    features,
    summary: {
      fetchedAt: new Date(snap.fetchedAt).toISOString(),
      posts,
      bySide,
      byZone,
      unchecked,
      outlets: snap.data.outlets.map((o) => ({ ...o })),
      pending: { ...snap.data.pending },
    },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSide = (v: unknown): v is WarNewsSide => v === "ua" || v === "ru" || v === "independent";
const isString = (v: unknown): v is string => typeof v === "string";
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

function isPost(v: unknown): v is WarNewsPost {
  if (!isObject(v)) return false;
  const place = v.place;
  return (
    isString(v.id) && isString(v.outlet) && isSide(v.side) && isString(v.url) && v.url.startsWith("https://") &&
    isString(v.title) && isNullableString(v.summary) && isString(v.lang) && typeof v.translated === "boolean" &&
    isNullableString(v.original) && isString(v.publishedAt) && Number.isFinite(Date.parse(v.publishedAt)) &&
    isNullableString(v.zone) && typeof v.mapped === "boolean" && typeof v.opinion === "boolean" &&
    typeof v.checked === "boolean" && (v.channel === "rss" || v.channel === "sitemap" || v.channel === "telegram") &&
    (place === null || (isObject(place) && isString(place.name) && isString(place.precision)))
  );
}

function isOutlet(v: unknown): v is WarNewsOutlet {
  return (
    isObject(v) && isString(v.id) && isString(v.name) && isSide(v.side) && isString(v.home) && isString(v.why) &&
    (v.status === "ok" || v.status === "failed" || v.status === "no-feed") && isNullableString(v.detail) &&
    typeof v.posts === "number" && typeof v.opinion === "boolean"
  );
}

/**
 * The summary as the client received it (`useSignalFeed(id).summary`, typed unknown), or
 * null when its shape is not the one `warNewsFrom` writes. A row that fails the check
 * fails the whole summary: a list with silently missing posts would undercount.
 */
export function readWarNewsSummary(value: unknown): WarNewsSummary | null {
  if (!isObject(value)) return null;
  const { posts, bySide, byZone, outlets, pending, fetchedAt, unchecked } = value;
  if (!Array.isArray(posts) || !posts.every(isPost)) return null;
  if (!Array.isArray(outlets) || !outlets.every(isOutlet)) return null;
  if (!isObject(bySide) || !WAR_NEWS_SIDES.every((s) => typeof bySide[s] === "number")) return null;
  if (!Array.isArray(byZone) || !byZone.every((z) => isObject(z) && isNullableString(z.zone) && typeof z.count === "number")) return null;
  if (!isObject(pending) || typeof pending.count !== "number" || !isNullableString(pending.reason)) return null;
  if (!isString(fetchedAt) || typeof unchecked !== "number") return null;
  return value as unknown as WarNewsSummary;
}

// --- the widget's view: filters, PURE ----------------------------------------------------

/** "all", or one war zone id, or "none" for posts the model read and found in no war zone. */
export type WarNewsZoneFilter = string;
export const ZONE_ALL = "all";
export const ZONE_NONE = "none";

export interface WarNewsFilter {
  side: WarNewsSide | "all";
  zone: WarNewsZoneFilter;
  /** Case-insensitive, matched against the title, the text, the original, the outlet and the place. */
  query?: string;
}

export interface WarNewsView {
  /** The posts every filter keeps, newest first. */
  shown: WarNewsPost[];
  /** Posts the side and search keep that the zone filter hides, by why. */
  hidden: { otherWars: number; noWar: number; unchecked: number };
  /** The other war zones those hidden posts are about, largest first. */
  hiddenZones: string[];
}

/** The zone a fresh card opens on: Ukraine when the feed has any post there, else all. */
export function defaultWarNewsZone(summary: Pick<WarNewsSummary, "byZone">): WarNewsZoneFilter {
  return summary.byZone.some((z) => z.zone === "ukraine" && z.count > 0) ? "ukraine" : ZONE_ALL;
}

function matchesQuery(post: WarNewsPost, query: string): boolean {
  if (!query) return true;
  const haystack = [post.title, post.summary, post.original, post.outlet, post.place?.name]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function matchesZone(post: WarNewsPost, zone: WarNewsZoneFilter): boolean {
  if (zone === ZONE_ALL) return true;
  if (!post.checked) return false; // its zone is not known yet
  if (zone === ZONE_NONE) return post.zone === null;
  return post.zone === zone;
}

/**
 * PURE: what the list shows under a filter, and what the zone filter hides. The hidden
 * count is what keeps a filtered list honest: "3 posts about other wars are hidden"
 * tells the reader the feed has more than the list shows.
 */
export function warNewsView(posts: readonly WarNewsPost[], filter: WarNewsFilter): WarNewsView {
  const query = (filter.query ?? "").trim().toLocaleLowerCase();
  const shown: WarNewsPost[] = [];
  const hidden = { otherWars: 0, noWar: 0, unchecked: 0 };
  const zones = new Map<string, number>();
  for (const post of posts) {
    if (filter.side !== "all" && post.side !== filter.side) continue;
    if (!matchesQuery(post, query)) continue;
    if (matchesZone(post, filter.zone)) {
      shown.push(post);
      continue;
    }
    if (!post.checked) hidden.unchecked += 1;
    else if (post.zone === null) hidden.noWar += 1;
    else {
      hidden.otherWars += 1;
      zones.set(post.zone, (zones.get(post.zone) ?? 0) + 1);
    }
  }
  const hiddenZones = [...zones.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([z]) => z);
  return { shown, hidden, hiddenZones };
}

/** One sentence for the hidden posts, or null when the zone filter hides none. */
export function warNewsHiddenLine(view: Pick<WarNewsView, "hidden" | "hiddenZones">): string | null {
  const { otherWars, noWar, unchecked } = view.hidden;
  const total = otherWars + noWar + unchecked;
  if (total === 0) return null;
  const parts: string[] = [];
  if (otherWars) {
    const where = view.hiddenZones.slice(0, 3).map((z) => warNewsZoneLabel(z)).join(", ");
    parts.push(`${otherWars} about other wars (${where})`);
  }
  if (noWar) parts.push(`${noWar} about no war`);
  if (unchecked) parts.push(`${unchecked} not checked yet`);
  return `${total} ${total === 1 ? "post is" : "posts are"} hidden by the zone filter: ${parts.join(", ")}.`;
}

/** "2h", "3d": the post's age. "" for a time in the future or one that does not parse. */
export function warNewsAge(publishedAt: string, now: number): string {
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t) || t > now + 60_000) return "";
  const minutes = Math.floor(Math.max(0, now - t) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The second line of a row: the outlet, its channel, and the facts a reader must not miss.
 * A post the model has not checked carries its own flag beside this line (the widget's
 * UncheckedFlag), set apart so it never reads like a checked post.
 */
export function warNewsByline(post: Pick<WarNewsPost, "outlet" | "channel" | "translated" | "lang" | "opinion">): string {
  const parts = [post.channel === "telegram" ? `${post.outlet}, Telegram` : post.outlet];
  if (post.opinion) parts.push("Opinion");
  if (post.translated) parts.push(`Translated from ${warNewsLanguage(post.lang)}`);
  return parts.join(". ");
}

export const WAR_NEWS_SOURCE: SignalSource = {
  id: "war-news",
  kind: "event",
  label: "War news",
  group: "Conflict",
  color: "#0e7490",
  // A post is placed at the town it names (an area) or at a named site (a facility);
  // each feature carries its own. The layer default is the town.
  precision: "area",
  refreshMs: 30 * 60_000,
  attribution: "War news: the outlets and Telegram channels each post names",
  async fetch() {
    const now = Date.now();
    const held = readRelay("war-news");
    if (!held) return degraded<SignalFeature>("not pushed from provenance-1 yet");
    const snap = usable("war-news", held, now);
    if (!snap) return degraded<SignalFeature>("the last push from provenance-1 is too old");
    const { features, summary } = warNewsFrom(snap);
    return observed(markSummary(features, summary), snap.fetchedAt);
  },
};
