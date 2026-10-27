// Road events from the nine Castle Rock "511" systems (Florida, Georgia, Idaho, Louisiana,
// New England, Ontario, Alberta, Nova Scotia, New Brunswick), mapped to RoadNotice. The
// mapping is pure (normalizeCastleRock), so tests/unit/roads-castlerock.test.ts holds it
// against real rows; the reads below it are not.
//
// THE FEED. The same keyless DataTables lists the camera adapter reads
// (lib/sources/castlerock.ts): `POST https://{site}/List/GetData/{layer}`, 100 rows a
// page, for the layers Incidents, Construction and Closures. The rows carry no place:
// `GET https://{site}/map/mapIcons/{layer}` gives each row's map point by id, as
// [lat, lon] (LATITUDE FIRST, unlike the camera rows' WKT). A row with no point is
// dropped, because it cannot be put on the map. Measured 27 Oct 2026: Georgia placed 58
// of 110 rows and Ontario 1 of 92; the other systems placed nearly all.
//
// NOT EVERY SYSTEM SERVES EVERY LAYER. On 27 Oct 2026 Georgia's and New England's
// Closures and Ontario's Construction answered HTTP 500 every time, so LAYERS_SERVED
// leaves them out rather than reporting them down on every read.
//
// TIME. A row's `lastUpdated` is the site's local time with no zone ("10/26/26, 3:59 PM";
// Ontario writes "26-10-27 4:27 AM"; Idaho adds " MT"). It is read in the system's own
// time zone (TIME_ZONES), so a site whose region spans two zones (Florida's panhandle,
// north Idaho) may be an hour out for some rows. Some rows are old: New Brunswick lists
// notices last changed in 2022, and the dossier shows that date as it is.
//
// THE WORDS. Category is the layer ("Incident", "Construction", "Closure"); the
// sub-category is the system's own event type spelled as words ("roadConstruction" reads
// "Road construction"), left out where it is only a number (Florida sends codes such as
// "95"). A row is closed where the system marks it `isFullClosure`.

import type { RoadKind, RoadNotice } from "@/lib/roads/notice";
import { CASTLEROCK_SYSTEMS, type CastleRockSystem } from "@/lib/sources/castlerock";

export type CastleRockLayer = "Incidents" | "Construction" | "Closures";

export const CASTLEROCK_ROADS_CREDIT = "Road events from state and provincial 511 systems (Castle Rock)";

/** The layers each system answered on 27 Oct 2026; the rest answered HTTP 500. */
export const LAYERS_SERVED: Readonly<Record<string, readonly CastleRockLayer[]>> = {
  fl: ["Incidents", "Construction", "Closures"],
  ga: ["Incidents", "Construction"],
  id: ["Incidents", "Construction", "Closures"],
  newengland: ["Incidents", "Construction"],
  la: ["Incidents", "Construction", "Closures"],
  on: ["Incidents", "Closures"],
  ab: ["Incidents", "Construction", "Closures"],
  ns: ["Incidents", "Construction", "Closures"],
  nb: ["Incidents", "Construction", "Closures"],
};

/** Each system's own time zone, for its zone-less `lastUpdated`. */
export const TIME_ZONES: Readonly<Record<string, string>> = {
  fl: "America/New_York",
  ga: "America/New_York",
  id: "America/Boise",
  newengland: "America/New_York",
  la: "America/Chicago",
  on: "America/Toronto",
  ab: "America/Edmonton",
  ns: "America/Halifax",
  nb: "America/Moncton",
};

const PAGE = 100;
/** No system listed more than 254 rows in one layer on 27 Oct 2026. */
const MAX_ROWS = 1000;
const TIMEOUT_MS = 20_000;
const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "User-Agent": "Provenance/1.0 (+https://github.com/011-sam-110/Provenance)",
} as const;

/** How far `tz` is ahead of UTC at the instant `utcMs`, in ms. */
function zoneOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/**
 * Pure: a Castle Rock `lastUpdated` read in the system's zone, as ISO UTC, or undefined
 * when it has neither form: "10/26/26, 3:59 PM" (M/D/YY) or "26-10-27 4:27 AM" (YY-M-D).
 */
export function castleRockTime(text: unknown, tz: string): string | undefined {
  if (typeof text !== "string") return undefined;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(text.trim());
  const ca = /^(\d{2})-(\d{1,2})-(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(text.trim());
  const m = us ? [us[3], us[1], us[2], us[4], us[5], us[6]] : ca ? [ca[1], ca[2], ca[3], ca[4], ca[5], ca[6]] : null;
  if (!m) return undefined;
  const [yy, mo, d, h12, mi, ap] = m;
  const hour = (Number(h12) % 12) + (ap.toUpperCase() === "PM" ? 12 : 0);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(mi) > 59) return undefined;
  const guess = Date.UTC(2000 + Number(yy), month - 1, day, hour, Number(mi));
  const first = guess - zoneOffsetMs(guess, tz);
  return new Date(guess - zoneOffsetMs(first, tz)).toISOString();
}

/** "roadConstruction" / "road construction" / "Bridge Repair" -> "Road construction"; a bare code -> undefined. */
export function eventWords(code: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  const w = code
    .replace(/[[\]]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();
  if (!w || /^\d+$/.test(w) || w === "null") return undefined;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const KIND: Record<CastleRockLayer, { kind: RoadKind; category: string }> = {
  Incidents: { kind: "incident", category: "Incident" },
  Construction: { kind: "works", category: "Construction" },
  Closures: { kind: "works", category: "Closure" },
};

const NO_SEVERITY = new Set(["", "none", "n/a", "null", "aucun"]);

const isLatLon = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 90 && Math.abs(p[1] as number) <= 180;

const plain = (v: unknown) =>
  typeof v === "string" ? v.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : "";

/**
 * Pure: one layer's rows and its map points to road notices. A row whose id has no map
 * point is dropped. Never throws.
 */
export function normalizeCastleRock(
  rows: unknown,
  icons: unknown,
  layer: CastleRockLayer,
  system: Pick<CastleRockSystem, "system">,
): RoadNotice[] {
  if (!Array.isArray(rows)) return [];
  const points = new Map<string, [number, number]>();
  const items = (icons as { item2?: unknown })?.item2;
  for (const it of Array.isArray(items) ? (items as Record<string, unknown>[]) : []) {
    if (it && (typeof it.itemId === "string" || typeof it.itemId === "number") && isLatLon(it.location)) {
      points.set(String(it.itemId), [it.location[0], it.location[1]]);
    }
  }
  const tz = TIME_ZONES[system.system] ?? "UTC";
  const out: RoadNotice[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || (typeof r.id !== "number" && typeof r.id !== "string")) continue;
    const at = points.get(String(r.id));
    if (!at) continue;
    const { kind, category } = KIND[layer];
    // A closure listed as road work is works; anything else on the Closures list is not
    // planned work, so it is drawn as an incident.
    const sub = eventWords(r.eventSubType);
    const closesWork = layer !== "Closures" || /work|construction|maintenance|repair|paving/i.test(sub ?? "");
    const sev = plain(r.severity);
    const dir = plain(r.direction).toLowerCase();
    const closure = r.isFullClosure === true ? (dir ? `Closed, ${dir}` : "Closed") : undefined;
    const description = plain(r.description);
    const firstSentence = description.split(/(?<=\.)\s/)[0];
    const comment = plain(r.comment);
    const street = plain(r.roadwayName);
    const updated = castleRockTime(r.lastUpdated, tz);
    out.push({
      id: `${system.system}/${String(r.id)}`,
      kind: layer === "Closures" && !closesWork ? "incident" : kind,
      category,
      ...(sub ? { subCategory: sub } : {}),
      severity: NO_SEVERITY.has(sev.toLowerCase()) ? "Not stated" : sev.charAt(0).toUpperCase() + sev.slice(1),
      ...(closure ? { closure } : {}),
      ...(firstSentence ? { location: firstSentence } : {}),
      ...(street ? { street } : {}),
      ...(comment ? { description: comment } : {}),
      lat: at[0],
      lon: at[1],
      openLines: [],
      closedLines: [],
      ...(updated ? { updated } : {}),
    });
  }
  return out;
}

async function postPage(site: string, layer: CastleRockLayer, start: number): Promise<{ data: unknown[]; total: number }> {
  const res = await fetch(`https://${site}/List/GetData/${layer}`, {
    method: "POST", // a GET returns an empty table
    headers: HEADERS,
    body: `draw=1&start=${start}&length=${PAGE}`,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${site} ${layer} ${res.status}`);
  const j = (await res.json()) as { data?: unknown[]; recordsTotal?: unknown };
  return { data: Array.isArray(j.data) ? j.data : [], total: Number(j.recordsTotal) || 0 };
}

/** One system's one layer, read page by page; null when it did not answer. Never throws. */
export async function loadCastleRockLayer(system: CastleRockSystem, layer: CastleRockLayer): Promise<RoadNotice[] | null> {
  try {
    const rows: unknown[] = [];
    let total = Infinity;
    for (let start = 0; start < total && start < MAX_ROWS; start += PAGE) {
      const page = await postPage(system.site, layer, start);
      rows.push(...page.data);
      total = page.total;
      if (page.data.length === 0) break;
    }
    const res = await fetch(`https://${system.site}/map/mapIcons/${layer}`, {
      headers: { "X-Requested-With": "XMLHttpRequest", "User-Agent": HEADERS["User-Agent"] },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return normalizeCastleRock(rows, await res.json(), layer, system);
  } catch {
    return null;
  }
}

export { CASTLEROCK_SYSTEMS };
