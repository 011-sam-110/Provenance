// FRED (St. Louis Fed) macro series — pure spec table + URL/value helpers, kept
// separate from app/api/markets/route.ts because Next's route-handler type
// checking only permits a fixed set of exports (GET/POST/dynamic/etc.) from a
// route.ts file — any other named export fails `tsc --noEmit` against the
// generated .next/types. Pure logic that needs its own unit tests lives here
// instead, matching lib/markets/chart.ts and lib/markets/indicators.ts.

// FRED lets the SERVER apply a transform via the `units=` query param on
// /fred/series/observations, rather than us diffing two raw observations
// ourselves. pc1 = "Percent Change from Year Ago" — this is documented FRED
// behaviour (fred.stlouisfed.org/docs/api/fred/series_observations.html#units),
// not a number we derived, so a YoY inflation figure here matches FRED's own charts.
export type FredTransform = "pc1";

export interface FredSeriesSpec {
  id: string;
  label: string;
  /** Appended directly after the formatted number, e.g. unit "%" → "4.23%". */
  unit: string;
  transform?: FredTransform;
}

// Every series below was verified live against FRED on 2026-08-11 by curling both
// /fred/series (to read the real "units" field rather than assume it) and
// /fred/series/observations (to confirm it actually returns a recent value):
//   DGS10/DGS2/DGS30/T10Y2Y/DFF/UNRATE  → units: Percent            (shown as "%")
//   VIXCLS                              → units: Index (no % sign)  (shown bare)
//   CPIAUCSL/CPILFESL/PPIACO            → units: Index level        (an index number
//     like "323.05" is meaningless out of context, so these use FRED's own pc1
//     transform for a year-over-year % — labelled "% YoY", never printed as a raw
//     index pretending to be a rate)
//   ICSA                                → units: Number             (a raw weekly
//     count of claims, NOT thousands — shown as "199,000 claims/wk")
//   A191RL1Q225SBEA                     → units: Percent Change from Preceding
//     Period, SAAR (quarterly, annualised) — this IS "real GDP growth", distinct
//     from GDPC1 (the $ level series), which was deliberately not used here.
// CPI/PPI/GDP update monthly/quarterly and jobless claims weekly, so their "as of"
// dates legitimately lag DGS10/VIX by weeks — parseMacro's `sub: as of <date>`
// (lib/markets.ts) discloses that on every row; it is never hidden or backdated.
export const FRED_SERIES: FredSeriesSpec[] = [
  { id: "DGS10", label: "10-Yr Treasury", unit: "%" },
  { id: "DGS2", label: "2-Yr Treasury", unit: "%" },
  { id: "DGS30", label: "30-Yr Treasury", unit: "%" },
  { id: "T10Y2Y", label: "10Y-2Y Spread", unit: "%" }, // negative = inverted curve
  { id: "DFF", label: "Fed Funds Rate", unit: "%" },
  { id: "CPIAUCSL", label: "CPI (headline)", unit: "% YoY", transform: "pc1" },
  { id: "CPILFESL", label: "Core CPI", unit: "% YoY", transform: "pc1" },
  { id: "PPIACO", label: "PPI (all commodities)", unit: "% YoY", transform: "pc1" },
  { id: "UNRATE", label: "US Unemployment", unit: "%" },
  { id: "ICSA", label: "Initial Jobless Claims", unit: " claims/wk" },
  { id: "A191RL1Q225SBEA", label: "Real GDP Growth", unit: "% ann." }, // QoQ, SAAR
  { id: "VIXCLS", label: "VIX (volatility)", unit: "" },
];

/** Pure: the FRED observations URL for one series' latest value. `apiKey` is
 *  embedded exactly as FRED's REST API requires (it accepts no other auth
 *  mechanism) — this function never logs it, and callers must not either. */
export function fredObservationsUrl(spec: FredSeriesSpec, apiKey: string): string {
  const params = new URLSearchParams({
    series_id: spec.id,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });
  if (spec.transform) params.set("units", spec.transform);
  return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

/** Pure: FRED's observation "value" string → a number, or null for FRED's "."
 *  missing-observation sentinel (a period with no released data yet — e.g. a
 *  series that hasn't hit its next monthly/quarterly release). Also null-safe
 *  against an absent/blank field or a non-numeric string. */
export function parseFredValue(raw: string | undefined | null): number | null {
  if (raw == null || raw === "" || raw === ".") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
