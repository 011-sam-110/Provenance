import type { SignalFeature } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { FCDO_SLUG_BY_ISO2 } from "@/lib/geo/fcdoSlugs.data";

// Official travel-advice changes from two governments, read as country-level warnings.
//
//   - UK FCDO, through the GOV.UK search and content APIs (Open Government Licence v3.0).
//     The search lists every country's advice by when it last changed; the content API
//     gives that change's own one-line description ("New information about fighting in
//     the Tigray region").
//   - Global Affairs Canada, one JSON file with every country's latest update line
//     (Open Government Licence – Canada).
//
// A change counts only when its OWN description names fighting, attacks, terrorism and
// the like (conflict) or demonstrations, strikes and unrest (protests), and only for
// ALERT_WINDOW_DAYS. Most changes are El Niño notes and entry rules, and those never
// count. The feature is the whole country, shaded: an advice change says "this
// government warned about this country this week", never where inside it.

const UA = "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)";
const FCDO_SEARCH =
  "https://www.gov.uk/api/search.json?filter_format=travel_advice&order=-public_timestamp&count=60&fields=title,link,public_timestamp";
const FCDO_CONTENT = "https://www.gov.uk/api/content/foreign-travel-advice/";
const GAC_INDEX = "https://data.international.gc.ca/travel-voyage/index-alpha-eng.json";
const CACHE_TTL_MS = 60 * 60 * 1000;
export const ADVICE_WINDOW_DAYS = 7;

export type AdviceIssuer = "FCDO" | "GAC";

export interface AdviceUpdate {
  iso2: string;
  issuer: AdviceIssuer;
  /** Epoch ms of the change. */
  at: number;
  /** The issuer's own description of what changed. */
  text: string;
  url: string;
}

const ISO2_BY_FCDO_SLUG = new Map(Object.entries(FCDO_SLUG_BY_ISO2).map(([iso2, slug]) => [slug, iso2]));

/** Pure: GOV.UK search results → { slug, at } for every country, newest first. */
export function parseFcdoSearch(json: unknown): { slug: string; at: number }[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: { slug: string; at: number }[] = [];
  for (const r of results as { link?: string; public_timestamp?: string }[]) {
    const slug = String(r?.link ?? "").replace(/^\/foreign-travel-advice\//, "");
    const at = Date.parse(String(r?.public_timestamp ?? ""));
    if (slug && !slug.includes("/") && Number.isFinite(at)) out.push({ slug, at });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Pure: one GOV.UK content item → the update it describes, or undefined. */
export function fcdoUpdateFromContent(slug: string, json: unknown): AdviceUpdate | undefined {
  const d = json as { details?: { change_description?: string; updated_at?: string; country?: { slug?: string } }; public_updated_at?: string };
  const text = String(d?.details?.change_description ?? "").trim();
  const at = Date.parse(String(d?.details?.updated_at ?? d?.public_updated_at ?? ""));
  const iso2 = ISO2_BY_FCDO_SLUG.get(d?.details?.country?.slug ?? slug);
  if (!text || !iso2 || !Number.isFinite(at)) return undefined;
  return { iso2, issuer: "FCDO", at, text, url: `https://www.gov.uk/foreign-travel-advice/${slug}` };
}

/** Pure: the GAC index → one update per country (GAC keeps only the latest line). */
export function parseGacIndex(json: unknown): AdviceUpdate[] {
  const data = (json as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") return [];
  const out: AdviceUpdate[] = [];
  for (const raw of Object.values(data)) {
    const r = raw as {
      "country-iso"?: string;
      "recent-updates-type"?: string;
      "date-published"?: { timestamp?: number };
      eng?: { "recent-updates"?: string; "url-slug"?: string };
    };
    const iso2 = String(r?.["country-iso"] ?? "").toUpperCase();
    const text = String(r?.eng?.["recent-updates"] ?? "").trim();
    const ts = Number(r?.["date-published"]?.timestamp);
    if (!iso2 || !text || !Number.isFinite(ts)) continue;
    // An editorial change is a wording fix, not news about the country.
    if (/editorial/i.test(String(r?.["recent-updates-type"] ?? ""))) continue;
    out.push({
      iso2,
      issuer: "GAC",
      at: ts * 1000,
      text,
      url: `https://travel.gc.ca/destinations/${r?.eng?.["url-slug"] ?? ""}`,
    });
  }
  return out;
}

const CONFLICT_WORDS =
  /\b(fighting|armed (?:conflict|groups?|clashes|attacks?)|clash(?:es)?|attacks?|terroris[mt]|terrorist|military (?:action|activity|operations?|escalation)|missiles?|air ?strikes?|drone attacks?|shelling|gunfire|insurgen\w*|hostilities|kidnapp?\w*|explosions?|bombings?)\b/i;
const PROTEST_WORDS = /\b(demonstrations?|protests?|strikes?|strike action|unrest|riots?|civil disturbance)\b/i;
const NOT_PROTEST = /\b(?:air|drone|missile)[ -]?strikes?\b/gi;

/** Pure: what an advice change is about. Both can be true. */
export function classifyAdvice(text: string): { conflict: boolean; protest: boolean } {
  return { conflict: CONFLICT_WORDS.test(text), protest: PROTEST_WORDS.test(text.replace(NOT_PROTEST, "")) };
}

/**
 * Pure: updates → one country-level feature per country for one layer, inside the window.
 * Both issuers' lines are kept, so a country flagged by the UK and Canada says so.
 */
export function normalizeAdvice(
  updates: AdviceUpdate[],
  kind: "conflict" | "protest",
  signalId: string,
  color: string,
  now: number = Date.now(),
  windowDays = ADVICE_WINDOW_DAYS,
): SignalFeature[] {
  const byCountry = new Map<string, AdviceUpdate[]>();
  for (const u of updates) {
    if (now - u.at > windowDays * 86_400_000 || u.at - now > 86_400_000) continue;
    if (!classifyAdvice(u.text)[kind]) continue;
    let list = byCountry.get(u.iso2);
    if (!list) byCountry.set(u.iso2, (list = []));
    list.push(u);
  }
  const out: SignalFeature[] = [];
  for (const [iso2, list] of byCountry) {
    const ctr = centroidByIso2(iso2);
    if (!ctr) continue;
    list.sort((a, b) => b.at - a.at);
    const issuers = [...new Set(list.map((u) => u.issuer))];
    const line = (issuer: AdviceIssuer) => {
      const u = list.find((x) => x.issuer === issuer);
      return u ? `${new Date(u.at).toISOString().slice(0, 10)}: ${u.text}` : undefined;
    };
    out.push({
      id: `advice:${signalId}:${ctr.iso3}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `Official travel warning — ${ctr.name} (${issuers.join(", ")})`,
      signalId,
      precision: "country",
      countryIso3: ctr.iso3,
      color,
      ts: new Date(list[0]!.at).toISOString(),
      link: list[0]!.url,
      props: {
        source: "Official travel advice",
        country: ctr.name,
        issuers: issuers.join(", "),
        ukFcdo: line("FCDO"),
        canadaGac: line("GAC"),
        meaning:
          "A government changed its travel advice for this country and named this in the change. It is a warning about the country as a whole, NOT a report of an event at any place in it.",
      },
    });
  }
  return out;
}

// --- fetch ------------------------------------------------------------------

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** FCDO change lines already read, by slug + timestamp, so a refresh only reads what changed. */
const fcdoSeen = new Map<string, AdviceUpdate | null>();
let cache: { read: AdviceRead; at: number } | null = null;

export interface AdviceRead {
  updates: AdviceUpdate[];
  /** Issuers that failed this read. */
  failed: AdviceIssuer[];
  at: number;
}

async function readAdvice(): Promise<AdviceRead> {
  const now = Date.now();
  const failed: AdviceIssuer[] = [];
  const updates: AdviceUpdate[] = [];

  const [search, gac] = await Promise.all([getJson(FCDO_SEARCH), getJson(GAC_INDEX)]);

  if (search) {
    const recent = parseFcdoSearch(search).filter((r) => now - r.at <= ADVICE_WINDOW_DAYS * 86_400_000);
    const todo = recent.filter((r) => !fcdoSeen.has(`${r.slug}@${r.at}`));
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < todo.length) {
          const r = todo[next++]!;
          const json = await getJson(`${FCDO_CONTENT}${r.slug}`);
          if (json) fcdoSeen.set(`${r.slug}@${r.at}`, fcdoUpdateFromContent(r.slug, json) ?? null);
        }
      }),
    );
    for (const r of recent) {
      const u = fcdoSeen.get(`${r.slug}@${r.at}`);
      if (u) updates.push(u);
    }
  } else failed.push("FCDO");

  if (gac) updates.push(...parseGacIndex(gac));
  else failed.push("GAC");

  return { updates, failed, at: now };
}

/** The latest advice changes from both issuers. Never throws. */
export async function fetchTravelAdvice(): Promise<AdviceRead> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS && cache.read.failed.length === 0) return cache.read;
  try {
    const read = await readAdvice();
    // Keep a good copy over a failed one: an issuer that blips keeps its last lines.
    if (read.failed.length > 0 && cache) {
      const kept = cache.read.updates.filter((u) => read.failed.includes(u.issuer));
      read.updates.push(...kept);
    }
    cache = { read, at: Date.now() };
    return read;
  } catch {
    return cache?.read ?? { updates: [], failed: ["FCDO", "GAC"], at: Date.now() };
  }
}
