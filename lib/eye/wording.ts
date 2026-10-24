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

/** "22:42:52", in UTC: the HUD clock names its zone beside it. */
export function fmtClockUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** "1 vessel", "2 vessels". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
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
