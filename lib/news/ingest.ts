// lib/news/ingest.ts
// The wire contract between the NewsScraper host and this app, and nothing else:
// signature checking, payload validation and the upstream→domain mapping, all PURE
// and node-testable. The route in app/api/private/news-ingest/route.ts does the I/O.
//
// WHY A PUSH. The scraper runs on a machine behind residential NAT; production runs
// on the Lightsail host. Only one of those two can be dialled, so the scraper posts
// and this app listens. Nothing here ever reaches out to the scraper.
//
// WHY HMAC AND NOT A BEARER TOKEN. A bearer token in a header is replayable by
// anything that sees one request. The signature covers the timestamp AND a digest of
// the body, so a captured request cannot be replayed after the skew window and cannot
// be edited at all. Same WebCrypto-only shape as lib/gate/tempkey.ts, for the same
// reason: no node:crypto, so the check is runtime-agnostic.
//
// THE SIGNATURE COVERS THE UNCOMPRESSED JSON, NOT THE BYTES ON THE WIRE, AND THAT
// CHOICE IS LOAD-BEARING. Cloudflare sits in front of this app. A proxy that
// decompresses, recompresses or re-chunks a body changes the wire bytes without
// changing a character of the content, and a signature taken over those bytes would
// fail for a reason no log on either side would explain. Signing the content means
// the check survives anything in the path that preserves the content — which is the
// only thing either end actually cares about.
//
// The cost is that the body must be decompressed before it is authenticated, so the
// route caps the decompressed size while it reads. See INGEST_MAX_WIRE_BYTES.
//
// ARTICLE TEXT IS INPUT, NEVER OUTPUT. `text` arrives so that lib/news/cluster.ts and
// synthesis.ts have something better than a 200-character RSS blurb to work on. It is
// deliberately absent from NewsItem, so the only way to serve an article body from
// this app is to add a field that does not exist today. Do not add one — these are
// other people's articles and we have a link, not a licence.
import { constantTimeEqual } from "@/lib/gate/token";
import type { NewsItem } from "@/lib/news";

/** Domain separation: this digest can never be confused with a gate or temp-key one. */
export const INGEST_SIGNATURE_PREFIX = "provenance-news-ingest-v1";

/**
 * How far a request's own timestamp may sit from ours. Five minutes is the usual
 * webhook figure: wide enough for clock drift between two machines that only talk to
 * NTP, narrow enough that a captured request is worthless by the time it is replayed.
 */
export const INGEST_MAX_SKEW_MS = 5 * 60 * 1000;

/** Per-POST ceiling. The scraper chunks a backfill; this is what makes it chunk. */
export const INGEST_MAX_ITEMS = 500;

/**
 * Uncompressed ceiling, with headroom over the scraper's own 3 MiB batching target so
 * a single oversized story (a Reuters live blog assembles every post into one body)
 * still fits rather than wedging the queue.
 */
export const INGEST_MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * On-the-wire ceiling. Separate from the above because the signature is checked
 * AFTER decompression — see the note on signing — so this is what stops us spending
 * memory on a compressed bomb from an unauthenticated caller.
 */
export const INGEST_MAX_WIRE_BYTES = 4 * 1024 * 1024;

/** One scraped story, after validation. `text` never leaves the server. */
export interface ScrapedItem {
  /** The scraper's stable story id, e.g. `st_9f3c1a0b77de2415`. Idempotency key. */
  id: string;
  /** Lower-case outlet slug as the scraper stores it: reuters | bbc | guardian | pbs | nyt. */
  outlet: string;
  title: string;
  description: string | null;
  url: string;
  /** Epoch ms for ordering. */
  ts: number;
  /**
   * FALSE when the outlet gave no parseable publication time and `ts` fell back to
   * first-seen. Kept so nothing downstream can present a first-seen time as a
   * publication time — a fabricated fact, cheaply avoided by carrying one boolean.
   *
   * PBS is the structural case: its listing cards carry "Sep 14" with no year, so a
   * PBS story whose article page was never fetched has no publication time at all.
   */
  tsExact: boolean;
  /** RFC3339 Z. The cursor the scraper resumes from. */
  lastSeenAt: string;
  /**
   * RFC3339 Z, and the ONLY stable ordering fallback. `lastSeenAt` is rewritten on
   * every scrape run for every story still on a section's front page, so it drifts
   * hourly and is useless for ordering; `firstSeenAt` never moves.
   */
  firstSeenAt: string | null;
  /**
   * Scraper-side digest over everything in the item that can change. Present, it is
   * the idempotency key. `textHash` alone is not sufficient: it is NULL for every NYT
   * row and every no-text row, which would make those rows permanently unchangeable.
   */
  itemHash: string | null;
  sections: string[];
  formatFlags: string[];
  wordCount: number | null;
  thumbnail: string | null;
  /** SHA-256 of the article text, or null. Half of the idempotency key. */
  textHash: string | null;
  /** Full article body. Server-side only — see the header note. */
  text: string | null;
  keywords: string[];
  /**
   * The outlet's own place-ish tags. VETO-ONLY BY CONTRACT: these can rule a place
   * out, they can never supply one, and they are not coordinates. The scraper holds
   * the same rule at its end, and excludes Reuters' dateline for the same reason —
   * a dateline says where the reporter filed from, not where the event happened.
   */
  placeHints: string[];
  /**
   * What the scraper's extraction stage read out of the article body, or null when
   * it has not run on this story. This is the ONLY field that can put a story on the
   * map — `placeHints` above cannot, by contract.
   */
  event: NewsEvent | null;
}

/**
 * A model-extracted event. EVERY FIELD HERE IS A READING OF AN ARTICLE, NOT A FACT
 * ABOUT THE WORLD, and the map copy has to keep saying so.
 *
 * The precedent is GDELT, and it is worth not relearning: a layer that presented
 * coded article metadata as incidents put "Use of military force, Bristol" on the map
 * from a story about a TikTok livestream. Nothing was broken — the upstream genuinely
 * said that. What was wrong was asserting it. So `category` is rendered as "coded as",
 * `quote` carries the sentence the place was taken from, and the layer is called
 * coverage rather than events.
 */
export interface NewsEvent {
  /**
   * The extractor's judgement that the story describes something that happened
   * somewhere. THE GATE on whether a pin can be drawn at all, so it is read strictly:
   * see parseEvent.
   */
  isPhysical: boolean;
  /** The extractor's category label. Attributed, never asserted. */
  category: string | null;
  /** When the event happened, as opposed to when the story ran. */
  eventDate: string | null;
  /** Place name as written in the article, e.g. "Bayeux". */
  placeName: string | null;
  /** Containing place, e.g. "Normandy" — disambiguates a name that repeats worldwide. */
  placeWithin: string | null;
  /**
   * ISO 3166-1 alpha-2, as the scraper's own schema check requires. A country NAME is
   * accepted too and handled separately downstream, but a real row carries "FR".
   * UNVALIDATED either way — the scraper's country check is unbuilt, so this says what
   * the model wrote, not what is true.
   */
  placeCountry: string | null;
  /** city / region / facility / … — how precise the place is meant to be. */
  placeKind: string | null;
  /**
   * The sentence the place was read from, VERBATIM. The evidence a reader can check,
   * and the only article text this app publishes — capped and attributed where it is
   * rendered (lib/signals/news-coverage.ts).
   *
   * The scraper's own checks make this stronger than it looks: where `isPhysical` is
   * true, its quote and date checks have already passed, so the sentence is verbatim
   * and `placeName` appears inside it. A row that failed a check arrives with
   * `isPhysical` false and no place fields at all.
   */
  quote: string | null;
  /**
   * Other places the story mentions, and the entities in it. Both are UNCHECKED model
   * output — unlike `placeName` and `quote`, nothing verified them against the article.
   * They are carried for matching and debugging only, and nothing renders them. Do not
   * start: the scraper's own contract forbids publishing model-written text.
   */
  otherPlaces: string[];
  keyEntities: string[];
}

function parseEvent(raw: unknown): NewsEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    // `true` OR the number 1, and NOTHING else — not "yes", not "1", not truthy.
    //
    // Strict, because this decides whether a pin is drawn. Two values rather than one,
    // because the scraper holds it in SQLite as an INTEGER: a sender that passes the
    // column straight through ships `1`, and reading that as false would silently
    // publish an empty layer with every other check green. Two spellings of the same
    // boolean is a much smaller risk than a whole feature failing quietly.
    isPhysical: r.isPhysical === true || r.isPhysical === 1,
    category: str(r.category),
    eventDate: str(r.eventDate),
    placeName: str(r.placeName),
    placeWithin: str(r.placeWithin),
    placeCountry: str(r.placeCountry),
    placeKind: str(r.placeKind),
    quote: str(r.quote),
    otherPlaces: strList(r.otherPlaces, 12),
    keyEntities: strList(r.keyEntities, 12),
  };
}

export interface Snapshot {
  version: number;
  generatedAt: number;
  cursor: string;
  items: ScrapedItem[];
  /** How many rows the batch carried, before validation. */
  received: number;
  /**
   * Ids of rows refused by validation, capped for the response. A refusal is about
   * the row's SHAPE, so it will be refused again — the sender must treat these as a
   * permanent loss to log, NOT as a reason to rewind its cursor and resend. Resending
   * a row that cannot parse is an infinite loop with extra steps.
   */
  droppedIds: string[];
}

/** Ids reported back. A batch that is broken wholesale should not produce a 500-id body. */
export const INGEST_MAX_REPORTED_DROPS = 20;

export type SnapshotResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: string };

export type SignatureResult = { ok: true } | { ok: false; reason: string };

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of the raw request body, hex. The signature covers this, not the object. */
export async function bodyDigestHex(body: string | Uint8Array): Promise<string> {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
}

/** Exactly what both sides sign. Changing this string is a breaking protocol change. */
export function signingString(timestampMs: number, digestHex: string): string {
  return `${INGEST_SIGNATURE_PREFIX}:${timestampMs}:${digestHex}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Sign a body the way the scraper must. Exported so the unit test signs for real. */
export async function signIngest(
  secret: string,
  timestampMs: number,
  body: string,
): Promise<string> {
  return `sha256=${await hmacHex(secret, signingString(timestampMs, await bodyDigestHex(body)))}`;
}

/**
 * Verify one posted batch. Every refusal returns the same shape and the caller turns
 * all of them into one status, so the reason never tells a prober which part it got
 * right.
 */
export async function verifyIngest(input: {
  secret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  body: string;
  nowMs: number;
}): Promise<SignatureResult> {
  const { secret, timestampHeader, signatureHeader, body, nowMs } = input;
  if (!secret) return { ok: false, reason: "not-configured" };
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing-headers" };

  const timestampMs = Number.parseInt(timestampHeader, 10);
  // parseInt stops at the first bad character rather than failing, so confirm the
  // parse by round-tripping it back to the string that was signed.
  if (!Number.isFinite(timestampMs) || String(timestampMs) !== timestampHeader.trim()) {
    return { ok: false, reason: "bad-timestamp" };
  }
  if (Math.abs(nowMs - timestampMs) > INGEST_MAX_SKEW_MS) return { ok: false, reason: "skew" };

  const expected = await signIngest(secret, timestampMs, body);
  if (!(await constantTimeEqual(signatureHeader.trim(), expected))) {
    return { ok: false, reason: "signature" };
  }
  return { ok: true };
}

// --- payload validation ----------------------------------------------------------
//
// Everything below treats the payload as hostile. It is signed, so it came from the
// scraper, but "signed by our own machine" and "correct" are different claims and
// only the first one is checked by the crypto.

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strList(value: unknown, cap = 64): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const s = str(entry);
    if (s) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** RFC3339 → epoch ms, or 0. Deliberately strict about returning 0 over guessing. */
function epochMs(value: unknown): number {
  const s = str(value);
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Only http(s). An ingested `javascript:` or `data:` URL would be rendered as a link. */
function safeUrl(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseItem(raw: unknown): ScrapedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = str(r.id);
  const outlet = str(r.outlet)?.toLowerCase() ?? null;
  const title = str(r.title);
  const url = safeUrl(r.url);
  const lastSeenAt = str(r.lastSeenAt);
  // These five are the whole identity of a news item. Without any one of them the
  // row cannot be stored, de-duplicated, ordered or linked, so it is dropped rather
  // than stored half-formed.
  if (!id || !outlet || !title || !url || !lastSeenAt) return null;

  const firstSeenAt = str(r.firstSeenAt);
  const published = epochMs(r.published);
  // Order by publication where the outlet gave one, else by when the story was FIRST
  // seen. Never by lastSeenAt: that is rewritten every run and would shuffle a
  // week-old story to the top of the rail every hour.
  const ts = published || epochMs(firstSeenAt) || epochMs(lastSeenAt);
  if (!ts) return null;

  const text = typeof r.text === "string" && r.text.trim() ? r.text : null;

  return {
    id,
    outlet,
    title,
    description: str(r.description),
    url,
    ts,
    tsExact: published > 0,
    lastSeenAt,
    firstSeenAt,
    itemHash: str(r.itemHash),
    sections: strList(r.sections),
    formatFlags: strList(r.formatFlags, 16),
    // `authors` is deliberately NOT read. The scraper's own contract
    // (docs/ARCHITECTURE.md:538) forbids article text, descriptions and author names
    // in a published body. Nothing here renders a byline, so dropping it on the floor
    // costs this app nothing and removes one of the three fields in that conflict.
    wordCount: typeof r.wordCount === "number" && Number.isFinite(r.wordCount) ? r.wordCount : null,
    thumbnail: safeUrl(r.thumbnail),
    textHash: str(r.textHash),
    text,
    keywords: strList(r.keywords),
    placeHints: strList(r.placeHints, 32),
    event: parseEvent(r.event),
  };
}

/**
 * Validate a decoded body. A batch with some unusable rows is NOT rejected — the bad
 * rows are dropped and the good ones kept, because one malformed story should not
 * cost us the other 499 and force the scraper to re-send a whole chunk.
 */
export function parseSnapshot(raw: unknown): SnapshotResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not-an-object" };
  const r = raw as Record<string, unknown>;

  if (r.version !== 1) return { ok: false, reason: "unsupported-version" };
  if (!Array.isArray(r.items)) return { ok: false, reason: "no-items" };
  if (r.items.length > INGEST_MAX_ITEMS) return { ok: false, reason: "too-many-items" };

  const items: ScrapedItem[] = [];
  const droppedIds: string[] = [];
  for (const entry of r.items) {
    const item = parseItem(entry);
    if (item) {
      items.push(item);
    } else if (droppedIds.length < INGEST_MAX_REPORTED_DROPS) {
      // Name it where we can. A row too broken to carry an id is reported as the
      // count alone, which is still better than silence.
      const id = entry && typeof entry === "object" ? str((entry as Record<string, unknown>).id) : null;
      droppedIds.push(id ?? "(unidentifiable)");
    }
  }

  // The cursor the scraper resumes from is the high-water mark of what we ACCEPTED,
  // never what it claimed to send. Trusting its own cursor would silently skip a row
  // we dropped as malformed.
  const cursor = items.reduce((max, it) => (it.lastSeenAt > max ? it.lastSeenAt : max), "");

  return {
    ok: true,
    snapshot: {
      version: 1,
      generatedAt: epochMs(r.generatedAt) || 0,
      cursor,
      items,
      received: r.items.length,
      droppedIds,
    },
  };
}

// --- mapping into the existing news stream ---------------------------------------

/**
 * Outlet slug → the display name lib/news/sources.ts already attributes. A slug with
 * no entry here keeps its own name and degrades to an unattributed source rather than
 * being dropped, which is the same honesty rule sourceMeta() follows.
 */
const OUTLET_NAMES: Record<string, string> = {
  reuters: "Reuters",
  bbc: "BBC",
  guardian: "The Guardian",
  pbs: "PBS NewsHour",
  nyt: "The New York Times",
};

export function outletDisplayName(outlet: string): string {
  return OUTLET_NAMES[outlet.toLowerCase()] ?? outlet;
}

/**
 * Scraped rows → the NewsItem shape /api/news already merges and clusters. Note what
 * does NOT cross: text, textHash, placeHints, sections. Those stay server-side, and
 * `text` in particular is the one the licence question hangs on.
 */
export function toNewsItems(items: ScrapedItem[]): NewsItem[] {
  return items.map((it) => ({
    title: it.title,
    source: outletDisplayName(it.outlet),
    url: it.url,
    ts: it.ts,
    ...(it.description ? { description: it.description } : {}),
  }));
}
