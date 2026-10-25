// Every word the God's eye view puts on screen, as pure functions, so one test file
// (tests/unit/eye-wording.test.ts) can hold the product's honesty rules over all of
// them: a still is never called live, a speed is never invented, and each count
// names who measured it.

/** "51.5013° N". Four decimals is about 10 m, the precision a street view can show. */
export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
}

/** "0.1218° W". */
export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}

/** A compass heading as three digits, "032". */
export function fmtHeading(deg: number): string {
  const d = Math.round(((deg % 360) + 360) % 360) % 360;
  return String(d).padStart(3, "0");
}

/**
 * "22:42:52", in UTC: the HUD clock names its zone beside it. A recording shows the
 * minute only ("22:42"): it is filmed frame by frame, slower than it plays, so a
 * seconds hand would race.
 */
export function fmtClockUtc(ms: number, seconds = true): string {
  return new Date(ms).toISOString().slice(11, seconds ? 19 : 16);
}

/**
 * The credits line, from the text of MapLibre's own attribution control (which keeps
 * it to the sources in use): one entry per source, each once, the ground first (the
 * imagery, then the map data the buildings come from), then the feeds in the
 * control's order.
 */
export function creditsFromAttribution(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("|")) {
    const c = raw.replace(/\s+/g, " ").trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  const rank = (c: string) => (/imagery/i.test(c) ? 0 : /openstreetmap|openmaptiles|openfreemap/i.test(c) ? 1 : 2);
  return out.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** The line under the ledger: "Vessels and aircraft refreshed 12 s ago". */
export function refreshedText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "Vessels and aircraft refreshed just now";
  if (s < 120) return `Vessels and aircraft refreshed ${s} s ago`;
  return `Vessels and aircraft refreshed ${Math.round(s / 60)} min ago`;
}

/** "1 vessel", "2 vessels". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "of 24 nearby", or nothing when every one nearby is already counted. A ledger count
 * is what carries words on screen (a card, a tag), so a reader can check it by eye;
 * this says how many more the view fetched around it.
 */
export function ofNearby(count: number, nearby: number): string[] {
  return nearby > count ? [`of ${nearby} nearby`] : [];
}

/** What one ledger row counts. Each kind has its own colour in the view. */
export type LedgerKind = "cam" | "ship" | "plane" | "road" | "speed";

/**
 * One row of the ledger: what the view shows, how many, and who measured it.
 * `count` is null for a row that states an absence ("no open speed feed").
 */
export interface LedgerRow {
  kind: LedgerKind;
  count: number | null;
  /** Wide screens: the noun after the count. */
  label: string;
  /** Wide screens: the source and its cadence, in the faint ink. */
  detail: string;
  /** Phone: the label under the count. */
  short: string;
}
