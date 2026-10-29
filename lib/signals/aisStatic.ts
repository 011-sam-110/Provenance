// The ship-details half of AIS, as pure readers: what a ship's crew and its transponder
// set up (call sign, IMO number, size, draught, ETA), tidied from each feed's own
// encoding. AISStream, Digitraffic and BarentsWatch each send these differently, so each
// adapter maps its own fields through the helpers here and no value is guessed.
// Pinned by tests/unit/signals-ais-static-fields.test.ts, with real values.

/** "MM-DD" or "MM-DDTHH:MMZ" (UTC). AIS sends no year, so none is made up. */
export type AisEta = string;

const pad = (n: number) => String(n).padStart(2, "0");

/** AIS pads a call sign with "@" to a fixed width: strip the padding and trim. "" is none. */
export function cleanCallSign(s: string | null | undefined): string | undefined {
  if (typeof s !== "string") return undefined;
  return s.replace(/@/g, "").trim() || undefined;
}

/**
 * An IMO number: 7 digits whose last is the check digit of the first six, weighted 7 down
 * to 2 (sum mod 10). A number that fails it is a typo or a placeholder (the live
 * Digitraffic register has 303174162 and 536491800 in the field), so it is left out.
 */
export function validImo(n: number | null | undefined): number | undefined {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1_000_000 || n > 9_999_999) return undefined;
  const d = String(n).split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += d[i] * (7 - i);
  return sum % 10 === d[6] ? n : undefined;
}

const dim = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Length and beam from the four AIS reference-point distances: A (bow) + B (stern) is the
 * length, C (port) + D (starboard) the beam. AIS has no value for "not sent", it sends 0,
 * so a sum of 0 leaves that dimension out.
 */
export function sizeFrom(
  a?: number | null,
  b?: number | null,
  c?: number | null,
  d?: number | null,
): { lengthM?: number; beamM?: number } {
  const lengthM = dim(a) + dim(b);
  const beamM = dim(c) + dim(d);
  return { ...(lengthM > 0 ? { lengthM } : {}), ...(beamM > 0 ? { beamM } : {}) };
}

/**
 * Draught in metres from the tenths of a metre Digitraffic and BarentsWatch send (255 is
 * "25.5 m or more", 0 is "not available"). AISStream's own field is already in metres.
 */
export function draughtFromTenths(n: number | null | undefined): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n) / 10;
}

const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

/**
 * An ETA from AIS's four parts. Month 1 to 12 and day 1 to 31 are required; AIS sends
 * month 0 / day 0 for "not available". Hour 24 and minute 60 mean the time is not
 * available, which drops the time and keeps the date.
 */
export function etaFromParts(
  month?: number | null,
  day?: number | null,
  hour?: number | null,
  minute?: number | null,
): AisEta | undefined {
  if (!isInt(month, 1, 12) || !isInt(day, 1, 31)) return undefined;
  const date = `${pad(month)}-${pad(day)}`;
  if (!isInt(hour, 0, 23) || !isInt(minute, 0, 59)) return date;
  return `${date}T${pad(hour)}:${pad(minute)}Z`;
}

/**
 * Digitraffic's ETA is the four AIS fields packed in one number: month in bits 19 to 16,
 * day 15 to 11, hour 10 to 6, minute 5 to 0.
 */
export function etaFromPacked(bits: number | null | undefined): AisEta | undefined {
  if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0) return undefined;
  return etaFromParts((bits >> 16) & 15, (bits >> 11) & 31, (bits >> 6) & 31, bits & 63);
}

/**
 * BarentsWatch's ETA is an ISO date-time. Its UTC month, day, hour and minute are kept
 * and its year dropped, as for every feed. A year before 2000 is a default date a
 * database fills in for "none", not an ETA, so it is left out.
 */
export function etaFromIso(s: string | null | undefined): AisEta | undefined {
  if (typeof s !== "string") return undefined;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  if (d.getUTCFullYear() < 2000) return undefined;
  return etaFromParts(d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}
