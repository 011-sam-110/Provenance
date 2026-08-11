import {
  parseMarkets,
  cryptoRows,
  parseFx,
  parseEquities,
  parseMacro,
  parseYahooChart,
  macroRowFromYahoo,
  type CoinGeckoMarket,
  type MarketsPayload,
  type MarketSection,
  type YahooChart,
} from "@/lib/markets";
import { FRED_SERIES, fredObservationsUrl, parseFredValue } from "@/lib/markets/fred";
import { SECTION_SPECS, foldSections } from "@/lib/markets/sections";

export const dynamic = "force-dynamic";

// GET /api/markets — a calm, multi-section markets snapshot. Two sections are
// always live and keyless (crypto · CoinGecko, FX · Frankfurter/ECB); two are
// key-gated and render DORMANT until configured (equities · Finnhub, macro · FRED).
// Dormant-safe throughout: any failure serves the last-good snapshot for that
// SECTION or an honestly-labelled empty section — never a 5xx, never fabricated,
// and a stale section always says so rather than posing as fresh (see
// resolveSection below). A deployment-wide Next Data Cache shields the upstreams
// (see getSnapshot below) so a burst of visitors triggers at most one upstream
// round-trip per revalidate window, not one per request.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const CACHE_TTL_MS = 60_000;

const CG_ENDPOINT =
  "https://api.coingecko.com/api/v3/coins/markets" +
  "?vs_currency=usd&ids=bitcoin,ethereum,solana,ripple,cardano,dogecoin,binancecoin,tron" +
  "&order=market_cap_desc&price_change_percentage=24h";
const FX_ENDPOINT = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CNY,CHF,CAD,AUD,INR";

const EQUITIES = [
  { symbol: "SPY", name: "S&P 500 (SPY)" },
  { symbol: "QQQ", name: "Nasdaq 100 (QQQ)" },
  { symbol: "DIA", name: "Dow 30 (DIA)" },
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "Nvidia" },
];

// Keyless Yahoo v8 chart instruments. Commodities are always live; equities use
// Yahoo only when Finnhub isn't keyed (so the hosted site still shows stocks).
const COMMODITIES: { y: string; symbol: string; name: string }[] = [
  { y: "BZ=F", symbol: "Brent", name: "Brent Crude" },
  { y: "CL=F", symbol: "WTI", name: "Crude Oil (WTI)" },
  { y: "NG=F", symbol: "NatGas", name: "Natural Gas" },
  { y: "GC=F", symbol: "Gold", name: "Gold" },
  { y: "SI=F", symbol: "Silver", name: "Silver" },
  { y: "ZW=F", symbol: "Wheat", name: "Wheat" },
];
const YAHOO_EQUITIES: { y: string; symbol: string; name: string }[] = [
  { y: "SPY", symbol: "SPY", name: "S&P 500 (SPY)" },
  { y: "QQQ", symbol: "QQQ", name: "Nasdaq 100 (QQQ)" },
  { y: "DIA", symbol: "DIA", name: "Dow 30 (DIA)" },
  { y: "AAPL", symbol: "AAPL", name: "Apple" },
  { y: "MSFT", symbol: "MSFT", name: "Microsoft" },
  { y: "NVDA", symbol: "NVDA", name: "Nvidia" },
];
// Keyless macro fallback: Yahoo's rate/vol indices quote the figure directly
// (^TNX/^FVX/^TYX = the Treasury yield in %; ^VIX = the volatility level), so the
// Macro panel is live without a FRED key. FRED (real series) is used when keyed.
const YAHOO_MACRO: { y: string; symbol: string; name: string; unit: string }[] = [
  { y: "^TNX", symbol: "US 10Y", name: "US 10-Yr Treasury Yield", unit: "%" },
  { y: "^FVX", symbol: "US 5Y", name: "US 5-Yr Treasury Yield", unit: "%" },
  { y: "^TYX", symbol: "US 30Y", name: "US 30-Yr Treasury Yield", unit: "%" },
  { y: "^VIX", symbol: "VIX", name: "Volatility (VIX)", unit: "" },
];
const yahooUrl = (sym: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;

async function getJson<T>(url: string, ms = 12_000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Fetch each Yahoo symbol in parallel and keep the rows that resolve. Carries the
 *  Yahoo ticker as chartSymbol so the focus view can pull real OHLC history even
 *  when the display symbol differs (e.g. Brent→BZ=F). */
async function yahooRows(specs: { y: string; symbol: string; name: string }[]): Promise<MarketSection["rows"]> {
  const rows = await Promise.all(specs.map(async (spec) => {
    const row = parseYahooChart(await getJson<YahooChart>(yahooUrl(spec.y)), spec);
    return row ? { ...row, chartSymbol: spec.y } : null;
  }));
  return rows.filter((r): r is NonNullable<typeof r> => r != null);
}

async function commoditiesSection(): Promise<MarketSection> {
  return { key: "commodities", label: "Commodities", source: "Yahoo Finance · delayed, keyless", rows: await yahooRows(COMMODITIES) };
}

async function cryptoSection(): Promise<MarketSection> {
  const rows = await getJson<CoinGeckoMarket[]>(CG_ENDPOINT);
  return { key: "crypto", label: "Crypto", source: "CoinGecko · keyless", rows: cryptoRows(parseMarkets(rows)) };
}

async function fxSection(): Promise<MarketSection> {
  const json = await getJson<{ base?: string; date?: string; rates?: Record<string, number> }>(FX_ENDPOINT);
  return { key: "fx", label: "Currencies", source: "Frankfurter / ECB · keyless", rows: parseFx(json) };
}

async function equitiesSection(): Promise<MarketSection> {
  const key = (process.env.FINNHUB_API_KEY ?? "").trim();
  if (!key) {
    // Keyless fallback: Yahoo delayed quotes so the hosted site still shows
    // equities without a Finnhub key. Finnhub (real-time) is used when keyed.
    return { key: "equities", label: "Equities", source: "Yahoo Finance · delayed, keyless", rows: await yahooRows(YAHOO_EQUITIES) };
  }
  const quotes = await Promise.all(
    EQUITIES.map(async (e) => {
      const q = await getJson<{ c?: number; dp?: number }>(`https://finnhub.io/api/v1/quote?symbol=${e.symbol}&token=${encodeURIComponent(key)}`);
      return { symbol: e.symbol, name: e.name, c: q?.c, dp: q?.dp };
    }),
  );
  // Finnhub tickers match Yahoo's, so charts pull real OHLC under the same symbol.
  return { key: "equities", label: "Equities", source: "Finnhub", rows: parseEquities(quotes).map((r) => ({ ...r, chartSymbol: r.symbol })) };
}

async function macroSection(): Promise<MarketSection> {
  const key = (process.env.FRED_API_KEY ?? "").trim();
  if (!key) {
    // Keyless: live Treasury yields + VIX from Yahoo instead of a dormant panel.
    const rows = await Promise.all(YAHOO_MACRO.map(async (s) => macroRowFromYahoo(await getJson<YahooChart>(yahooUrl(s.y)), s)));
    return { key: "macro", label: "Macro / rates", source: "Yahoo Finance · delayed, keyless", rows: rows.filter((r): r is NonNullable<typeof r> => r != null) };
  }
  const series = await Promise.all(
    FRED_SERIES.map(async (s) => {
      const json = await getJson<{ observations?: { date?: string; value?: string }[] }>(fredObservationsUrl(s, key));
      const obs = json?.observations?.[0];
      return { id: s.id, label: s.label, unit: s.unit, value: parseFredValue(obs?.value), date: obs?.date };
    }),
  );
  return { key: "macro", label: "Macro / rates", source: "FRED (St. Louis Fed)", rows: parseMacro(series) };
}

// --- per-section isolation --------------------------------------------------
// Previously GET() ran Promise.all over all five section builders inside one
// try/catch: a single rejection (a CoinGecko hiccup, a Yahoo 429) discarded every
// section, not just the one that failed — the response served empty/stale rows
// for sections that had nothing wrong with them, breaking the dormant-safe
// contract ("a failure resolves to [] or last-good, never takes down the
// response") for everyone else on the page. Promise.allSettled makes each
// section's fate independent; resolveSection/foldSections (lib/markets/sections.ts,
// pure + unit-tested there since a route.ts file may only export recognized route
// handler names) decide, per section, what to serve when its builder rejects.

// Per-section last-good, kept purely so a transient failure can fall back to real
// data instead of an empty section. Module state: like OpenSky's own `lastGood`
// (lib/sources/opensky.ts), this is NOT guaranteed to survive between separate
// invocations of the cached callback below on Vercel's serverless platform — each
// revalidation may land on a different, cold instance with empty state, in which
// case a failing section just renders the honestly-empty branch instead. It costs
// nothing and helps within a warm instance; a deployment-wide last-good would need
// external storage (Vercel KV/Blob), which is out of scope here (no new dependency).
const lastGoodSections: Partial<Record<string, MarketSection>> = {};

async function buildSnapshot(): Promise<MarketsPayload> {
  const results = await Promise.allSettled([
    cryptoSection(),
    commoditiesSection(),
    fxSection(),
    equitiesSection(),
    macroSection(),
  ]);
  const sections = foldSections(SECTION_SPECS, results, lastGoodSections);
  for (const s of sections) {
    if (s.rows.length > 0) lastGoodSections[s.key] = s;
  }
  return { generatedAt: Date.now(), sections };
}

// --- caching -------------------------------------------------------------
// WHY next/cache, REPLACING the old module-level `cache` variable. On Vercel each
// serverless invocation can land on a different, isolated instance, so a plain
// module-level variable is NOT shared across requests deployment-wide — it only
// ever helped the (occasional) case of two requests landing on the same
// still-warm instance inside the same TTL window; most of the time every request
// paid the full upstream round-trip anyway, worse than it looked in local dev
// where one warm process serves every request.
//
// `unstable_cache` (Next's Data Cache) is a real, deployment-wide, persisted
// cache: the wrapped fetch runs at most once per `revalidate` window for the
// WHOLE deployment, and every visitor in that window is served the same stored
// snapshot — exactly the pattern lib/sources/opensky.ts already uses for the
// planes route in this repo. It is a clean fit here: the snapshot is small, plain
// JSON (MarketSection[] has no functions/symbols to lose in the round trip), and
// `generatedAt` is stamped inside buildSnapshot() at fetch time — not on every
// request — so the client's "updated Xs ago" keeps growing correctly across a
// cached window instead of resetting to "just now" on every hit.
async function getSnapshot(): Promise<MarketsPayload> {
  try {
    const { unstable_cache } = await import("next/cache");
    return await unstable_cache(buildSnapshot, ["markets-snapshot-v1"], {
      revalidate: CACHE_TTL_MS / 1000,
    })();
  } catch {
    // Outside the Next server runtime (e.g. an unusual host) — fetch directly
    // rather than fail; still per-section isolated, just not deployment-shared.
    return buildSnapshot();
  }
}

export async function GET() {
  return Response.json(await getSnapshot());
}
