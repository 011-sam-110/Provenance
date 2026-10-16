// Pure helpers for the date PRECISION of a scheduled time. See the note below.
//
// Launch Library 2 sends `net_precision` with every launch: Second, Minute, Hour,
// Day, Month, Quarter N, Year Half N or Year. A launch known only to "Q4 2026"
// still carries a full ISO `net` (LL2 puts it at 2026-12-31T00:00:00Z), and until
// 2026-10-16 the agenda drew that placeholder as an exact midnight time: 20 of the
// 30 rows prod served that day sat at 00:00 UTC, 10 of them on 31 December. A
// precision coarser than Hour is a DATE CLASS, not a time: no countdown, no clock,
// no place in "Next 24h", and its heading names the class ("NET Q4 2026").
// Absent or unknown precision keeps the old behaviour, so other schedule layers
// and old cached rows are not changed.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Rank of a precision name, finest first. Unknown or absent ranks as exact (0). */
export function precisionRank(precision: string | undefined | null): number {
  const p = (precision ?? "").trim().toLowerCase();
  if (p === "second" || p === "minute" || p === "") return 0;
  if (p === "hour") return 1;
  if (p === "day") return 2;
  if (p === "week") return 3;
  if (p === "month") return 4;
  if (p.startsWith("quarter")) return 5;
  if (p.startsWith("year half")) return 6;
  if (p === "year") return 7;
  return 0;
}

/** True when the scheduled time is only a date class (Day or coarser), not a time. */
export function isVagueSchedule(precision: string | undefined | null): boolean {
  return precisionRank(precision) >= 2;
}

/**
 * "NET …" label for a vague scheduled time: "NET Oct 29" (Day), "NET Oct 2026"
 * (Month), "NET Q4 2026", "NET H2 2026", "NET 2026". "" when the time is exact or
 * the stamp does not parse.
 */
export function netLabel(ts: string | undefined | null, precision: string | undefined | null): string {
  if (!ts || !isVagueSchedule(precision)) return "";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const p = (precision ?? "").trim().toLowerCase();
  const n = p.match(/(\d)\s*$/)?.[1];
  if (p === "day") return `NET ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (p === "week") return `NET week of ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (p === "month") return `NET ${MONTHS[d.getUTCMonth()]} ${year}`;
  if (p.startsWith("quarter")) return `NET Q${n ?? Math.floor(d.getUTCMonth() / 3) + 1} ${year}`;
  if (p.startsWith("year half")) return `NET H${n ?? (d.getUTCMonth() < 6 ? 1 : 2)} ${year}`;
  return `NET ${year}`;
}

