// Pure crypto-markets normaliser. CoinGecko's /coins/markets returns a verbose
// row per asset; we keep only the calm, honest subset the panel renders:
// name, symbol, price, 24h % change, market cap, an icon and the upstream
// last_updated stamp. Keyless. Pure + isomorphic so it unit-tests in node.
//
// Endpoint shape confirmed live 2026-06-27:
//   https://api.coingecko.com/api/v3/coins/markets
//     ?vs_currency=usd&ids=bitcoin,ethereum,…&price_change_percentage=24h
//   → array of { id, symbol, name, image, current_price,
//                price_change_percentage_24h, market_cap, last_updated, … }

export interface CoinGeckoMarket {
  id?: string;
  symbol?: string;
  name?: string;
  image?: string | null;
  current_price?: number | null;
  price_change_percentage_24h?: number | null;
  market_cap?: number | null;
  last_updated?: string | null;
}

export interface MarketAsset {
  id: string;
  symbol: string; // upper-cased ticker, e.g. "BTC"
  name: string;
  price: number; // USD
  changePct24h: number | null; // signed %, null when upstream omits it
  marketCap: number | null;
  image?: string;
  updatedAt?: string; // ISO from upstream
}

// --- multi-section model ----------------------------------------------------
// Markets is no longer crypto-only: it shows several asset classes, each its own
// honestly-labelled section. Keyless sections (crypto, FX) are always live; keyed
// sections (equities, macro) render DORMANT with a "add KEY" note until configured
// — never fabricated. The panel reads `sections`.

export interface MarketRow {
  id: string;
  name: string;
  symbol?: string;
  /** Pre-formatted display value (price / rate / level). */
  value: string;
  /** Raw numeric value behind `value` — recorded into the sparkline time-series. */
  num?: number;
  /** Signed % change where the upstream provides it; null/undefined = not shown. */
  changePct?: number | null;
  /** Optional secondary line (market cap, unit, as-of date). */
  sub?: string;
  image?: string;
  /** Yahoo v8 ticker for the history chart when it differs from the display symbol
   *  (e.g. crypto BTC→BTC-USD, commodity Brent→BZ=F). Undefined ⇒ no real history
   *  chart for this row (the focus view falls back to its live session series). */
  chartSymbol?: string;
}

export interface MarketSection {
  key: string;
  label: string;
  source: string;
  /** True when the section is key-gated and the key isn't set; rows will be empty. */
  dormant?: boolean;
  /**
   * True when `rows` are a LAST-GOOD snapshot carried over because this section
   * failed to refresh — real numbers, but not current ones.
   *
   * Deliberately NOT `dormant`: dormant hides the rows and shows `note` instead,
   * which is right for "no key, nothing to show" and wrong here, where we do have
   * data and simply must not pass it off as live. Every renderer must surface
   * `note` when this is set — a stale row that looks identical to a fresh one is
   * the same lie as a frozen feed still saying "live".
   */
  stale?: boolean;
  /** Shown when dormant OR stale — which env var unlocks it, or why it is stale. */
  note?: string;
  rows: MarketRow[];
}

export interface MarketsPayload {
  generatedAt: number;
  sections: MarketSection[];
}

/** Crypto MarketAsset[] → display rows (market cap as the secondary line). */
export function cryptoRows(assets: MarketAsset[]): MarketRow[] {
  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    symbol: a.symbol,
    value: formatPrice(a.price),
    num: a.price,
    changePct: a.changePct24h,
    image: a.image,
    sub: a.marketCap != null ? `mkt cap ${formatCompactUsd(a.marketCap)}` : undefined,
    // Yahoo charts crypto under the "-USD" pair (BTC→BTC-USD), so history works.
    chartSymbol: `${a.symbol}-USD`,
  }));
}

const FX_NAMES: Record<string, string> = {
  EUR: "Euro", GBP: "British Pound", JPY: "Japanese Yen", CNY: "Chinese Yuan",
  CHF: "Swiss Franc", CAD: "Canadian Dollar", AUD: "Australian Dollar", INR: "Indian Rupee",
};

/** Pure: Frankfurter (ECB) latest payload → FX rows (units of each currency per 1 USD). */
export function parseFx(json: { base?: string; date?: string; rates?: Record<string, number> } | null | undefined): MarketRow[] {
  const rates = json?.rates;
  if (!rates) return [];
  const out: MarketRow[] = [];
  for (const [code, raw] of Object.entries(rates)) {
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    out.push({
      id: `fx:${code}`,
      name: FX_NAMES[code] ?? code,
      symbol: `USD/${code}`,
      value: rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      num: rate,
      sub: json?.date ? `per 1 USD · ${json.date}` : "per 1 USD",
    });
  }
  return out;
}

/** Pure: assembled Finnhub quotes → equity rows. {symbol,name,c(current),dp(% change)}. */
export function parseEquities(
  quotes: { symbol?: string; name?: string; c?: number | null; dp?: number | null }[] | null | undefined,
): MarketRow[] {
  if (!Array.isArray(quotes)) return [];
  const out: MarketRow[] = [];
  for (const q of quotes) {
    const sym = (q.symbol ?? "").toUpperCase();
    const price = q.c == null ? Number.NaN : Number(q.c);
    if (!sym || !Number.isFinite(price) || price <= 0) continue;
    const dp = typeof q.dp === "number" && Number.isFinite(q.dp) ? Number(q.dp.toFixed(2)) : null;
    out.push({ id: `eq:${sym}`, name: q.name?.trim() || sym, symbol: sym, value: formatPrice(price), num: price, changePct: dp });
  }
  return out;
}

/** Pure: assembled FRED latest observations → macro rows. {id,label,value,unit,date}. */
export function parseMacro(
  series: { id?: string; label?: string; value?: number | string | null; unit?: string; date?: string }[] | null | undefined,
): MarketRow[] {
  if (!Array.isArray(series)) return [];
  const out: MarketRow[] = [];
  for (const s of series) {
    const id = (s.id ?? "").trim();
    const v = s.value == null ? Number.NaN : Number(s.value);
    if (!id || !Number.isFinite(v)) continue;
    out.push({
      id: `macro:${id}`,
      name: s.label?.trim() || id,
      value: `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${s.unit ?? ""}`,
      num: v,
      sub: s.date ? `as of ${s.date}` : undefined,
    });
  }
  return out;
}

// --- Yahoo v8 chart (keyless commodities + equities fallback) ---------------
// The keyless Yahoo chart endpoint returns, per symbol, meta.regularMarketPrice
// and chartPreviousClose. We show the price as the value and the day-over-day
// move (price vs previous close) as the % change. Pure + isomorphic.

export interface QuoteSpec {
  /** Display ticker, e.g. "WTI", "SPY". */
  symbol: string;
  /** Display name. */
  name: string;
}

export interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number | null; chartPreviousClose?: number | null; previousClose?: number | null };
    }> | null;
  } | null;
}

/** Pure: one symbol's Yahoo chart JSON + its display spec → a MarketRow (or null). */
export function parseYahooChart(json: YahooChart | null | undefined, spec: QuoteSpec): MarketRow | null {
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice == null ? Number.NaN : Number(meta.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const prevRaw = meta.chartPreviousClose ?? meta.previousClose;
  const prev = prevRaw == null ? Number.NaN : Number(prevRaw);
  const changePct = Number.isFinite(prev) && prev > 0 ? Number((((price - prev) / prev) * 100).toFixed(2)) : null;
  return { id: `q:${spec.symbol}`, name: spec.name, symbol: spec.symbol, value: formatPrice(price), num: price, changePct };
}

/** Pure: a Yahoo index quote (e.g. ^TNX yield, ^VIX) → a macro row with a unit
 *  suffix instead of a "$" price. Keyless macro fallback when FRED isn't keyed —
 *  ^TNX/^FVX/^TYX quote the yield directly in %; ^VIX is a plain level. */
export function macroRowFromYahoo(
  json: YahooChart | null | undefined,
  spec: { y: string; symbol: string; name: string; unit: string },
): MarketRow | null {
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice == null ? Number.NaN : Number(meta.regularMarketPrice);
  if (!Number.isFinite(price)) return null;
  const prevRaw = meta.chartPreviousClose ?? meta.previousClose;
  const prev = prevRaw == null ? Number.NaN : Number(prevRaw);
  const changePct = Number.isFinite(prev) && prev !== 0 ? Number((((price - prev) / prev) * 100).toFixed(2)) : null;
  return {
    id: `macro:${spec.symbol}`,
    name: spec.name,
    symbol: spec.symbol,
    value: `${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${spec.unit}`,
    num: price,
    changePct,
    chartSymbol: spec.y,
  };
}

/** Compact USD, e.g. "$1.2T", "$845B", "$12.3M". */
export function formatCompactUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString("en-US")}`;
}

/** Pure: CoinGecko rows → MarketAsset[]. Skips rows with no id or no price. */
export function parseMarkets(rows: CoinGeckoMarket[] | null | undefined): MarketAsset[] {
  if (!Array.isArray(rows)) return [];
  const out: MarketAsset[] = [];
  for (const r of rows) {
    const id = r.id?.toString().trim();
    // Number(null) is 0, so guard null/undefined explicitly before coercing.
    const price = r.current_price == null ? Number.NaN : Number(r.current_price);
    if (!id || !Number.isFinite(price)) continue;
    const changeRaw = r.price_change_percentage_24h;
    const change =
      typeof changeRaw === "number" && Number.isFinite(changeRaw) ? changeRaw : null;
    const cap = r.market_cap != null && Number.isFinite(Number(r.market_cap)) ? Number(r.market_cap) : null;
    out.push({
      id,
      symbol: (r.symbol ?? "").toString().toUpperCase() || id.toUpperCase(),
      name: r.name?.toString().trim() || id,
      price,
      changePct24h: change == null ? null : Number(change.toFixed(2)),
      marketCap: cap,
      image: r.image?.toString() || undefined,
      updatedAt: r.last_updated?.toString() || undefined,
    });
  }
  return out;
}

/** Compact USD price: "$60,155", "$1.06", "$0.0756". Calm, no neon. */
export function formatPrice(usd: number): string {
  const digits = usd >= 1 ? 2 : usd >= 0.01 ? 4 : 6;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
