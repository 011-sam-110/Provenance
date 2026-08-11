"use client";
// Markets focus view — the milestone the spec centres on: "for markets, it shows
// actual graphs." Reuses the SAME live pipeline as the docked widget
// (useJsonPoll("/api/markets")) for the quote list, and adds a keyless
// /api/markets/chart fetch for the selected instrument's real 1M/6M/1Y history.
// Honest throughout: real OHLC when Yahoo has it, an explicit "live session"
// fallback to the accumulated mkt:<id> series when it doesn't, and an
// "indicative only — not financial advice" disclaimer. Pure series maths live in
// the unit-tested lib/markets/chart.ts; this is the shell.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { MarketsPayload, MarketRow, MarketSection } from "@/lib/markets";
import { useJsonPoll } from "@/lib/console/widgets/useJsonPoll";
import { recordSeries, seriesSamples } from "@/lib/series";
import { Chart, type ChartPoint } from "@/components/Chart";
import { CandleChart, type OverlayLine, type BandOverlay, type PriceGuide } from "@/components/CandleChart";
import { loadAlerts, addAlert, removeAlert, crossed, type PriceAlert } from "@/lib/markets/alerts";
import { shellLayoutStore } from "@/lib/console/store";
import { candlesToPoints, hiLo, periodChange, RANGES, RANGE_LABEL, type Candle, type Range } from "@/lib/markets/chart";
import { sma, bollinger, rsi, volumeProfile, rescaleShape, anomalyFlags } from "@/lib/markets/indicators";
import { toCsv, downloadText, exportFilename } from "@/lib/export";

const EMPTY: MarketsPayload = { generatedAt: 0, sections: [] };
type TableSortKey = "name" | "changePct" | "value" | "ath";
type ChartType = "candles" | "line";
type IndKey = "ma" | "boll" | "vol" | "rsi" | "bench" | "anom";
const IND_CHIPS: [IndKey, string][] = [["ma", "MA 50/200"], ["boll", "Bollinger"], ["vol", "Volume"], ["rsi", "RSI"], ["bench", "Benchmark"], ["anom", "Events"]];

/** Compact non-currency magnitude for volume, e.g. "1.2B", "845.0M", "12.3K". */
function fmtVol(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/** Resample a series to `n` points by index (a faint benchmark shape need not be
 *  time-exact — it maps the other asset's contour onto this instrument's window). */
function resample(src: number[], n: number): number[] {
  if (src.length === 0 || n <= 0) return [];
  if (src.length === n) return src;
  const out: number[] = [];
  const span = src.length - 1, denom = n - 1 || 1;
  for (let i = 0; i < n; i++) out.push(src[Math.min(span, Math.max(0, Math.round((i * span) / denom)))]);
  return out;
}

/** Percent below the all-time high (0 = at ATH, −40 = 40% down). null if unknown. */
function athPct(cur: number | undefined, ath: number | undefined): number | null {
  if (cur == null || ath == null || !(ath > 0)) return null;
  return (cur / ath - 1) * 100;
}

/** A 52-week (or period) range slider: where the current price sits between lo/hi. */
function RangeBar({ lo, hi, cur }: { lo: number; hi: number; cur: number }) {
  const pct = hi > lo ? Math.min(100, Math.max(0, ((cur - lo) / (hi - lo)) * 100)) : 50;
  return (
    <div className="tn-mk-rangebar" title={`low ${fmtNum(lo)} · now ${fmtNum(cur)} · high ${fmtNum(hi)}`}>
      <span className="tn-mk-rb-end">{fmtNum(lo)}</span>
      <span className="tn-mk-rb-track">
        <span className="tn-mk-rb-fill" style={{ width: `${pct}%` }} />
        <span className="tn-mk-rb-dot" style={{ left: `${pct}%` }} />
      </span>
      <span className="tn-mk-rb-end">{fmtNum(hi)}</span>
    </div>
  );
}

/** Adaptive-precision number formatting for prices/levels (large → 2dp, tiny → 6dp). */
function fmtNum(n: number): string {
  const abs = Math.abs(n);
  const d = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

/** Signed magnitude used for movers-first ordering; nulls sort last. */
function absMove(r: MarketRow): number {
  return r.changePct == null ? -1 : Math.abs(r.changePct);
}

/** Fire a browser Notification for a crossed alert (dormant-safe: no-op unless the
 *  user granted permission and the API exists). */
function notifyAlert(a: PriceAlert, price: number): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(`${a.symbol} ${a.dir === "above" ? "≥" : "≤"} ${fmtNum(a.price)}`, {
      body: `${a.name} is now ${fmtNum(price)}`,
      tag: a.id,
    });
  } catch { /* dormant-safe */ }
}

/** Heat-strip / change colour scaled by move magnitude (green up, red down). */
function moverBg(pct: number): string {
  const mag = Math.min(1, Math.abs(pct) / 8);
  const a = 0.15 + mag * 0.6;
  return pct >= 0 ? `rgba(22,163,74,${a})` : `rgba(220,38,38,${a})`;
}

function freshLabel(generatedAt: number, now: number): string {
  if (!generatedAt) return "—";
  const m = Math.max(0, Math.round((now - generatedAt) / 60000));
  return m === 0 ? "just now" : `${m}m ago`;
}

export default function MarketsDetail({ instanceId, config }: WidgetDetailProps) {
  const { data, status } = useJsonPoll<MarketsPayload>("/api/markets", 120_000, EMPTY);

  // Keep dormant (key-gated) sections too — surfaced as a "needs key" note rather
  // than hidden, so the capability is discoverable (mirrors the docked widget).
  const sections = useMemo<MarketSection[]>(
    () => (data.sections ?? []).filter((s) => s.rows.length || s.dormant),
    [data.sections],
  );
  // Movers-first ordering within each section.
  const railSections = useMemo(
    () => sections.map((s) => ({ ...s, rows: [...s.rows].sort((a, b) => absMove(b) - absMove(a)) })),
    [sections],
  );
  const allRows = useMemo(() => railSections.flatMap((s) => s.rows), [railSections]);

  // Record each row's raw value into the PERSISTED mkt:<id> series so the rail
  // sparklines accumulate AND the honest "live session" chart fallback has data;
  // bump a tick so a fresh sample shows this render.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!data.generatedAt) return;
    for (const r of allRows) if (typeof r.num === "number") recordSeries(`mkt:${r.id}`, r.num, data.generatedAt);
    setTick((t) => t + 1);
  }, [data.generatedAt, allRows]);

  // Selected instrument — seeded from persisted config, then the first (biggest) mover.
  const [selId, setSelId] = useState<string | null>(
    () => (typeof config.selectedId === "string" ? config.selectedId : null),
  );
  useEffect(() => {
    if (selId && allRows.some((r) => r.id === selId)) return;
    const first = allRows[0];
    if (first) setSelId(first.id);
  }, [allRows, selId]);
  const selectRow = (id: string) => {
    setSelId(id);
    shellLayoutStore.configure(instanceId, { selectedId: id });
  };

  // Top movers across every section (biggest absolute move first), for the heat-strip.
  const movers = useMemo(
    () => allRows.filter((r) => r.changePct != null).sort((a, b) => absMove(b) - absMove(a)).slice(0, 8),
    [allRows],
  );

  const selRow = useMemo(() => allRows.find((r) => r.id === selId) ?? null, [allRows, selId]);
  // Yahoo history ticker (crypto/commodity display symbols aren't Yahoo tickers).
  const selSym = selRow ? (selRow.chartSymbol ?? selRow.symbol ?? selRow.id) : null;
  const selSectionKey = useMemo(
    () => railSections.find((s) => s.rows.some((r) => r.id === selId))?.key,
    [railSections, selId],
  );

  // All-time-high enrichment for the "ATH %" column: batched, keyless, hard-cached
  // server-side. Keyed by upper-cased chartSymbol (Yahoo ticker) so the table can
  // show how far each asset trades below its historical peak.
  const [athMap, setAthMap] = useState<Record<string, number>>({});
  const athSyms = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.chartSymbol?.toUpperCase()).filter((s): s is string => !!s))),
    [allRows],
  );
  useEffect(() => {
    if (athSyms.length === 0) return;
    let alive = true;
    fetch(`/api/markets/ath?symbols=${encodeURIComponent(athSyms.join(","))}`)
      .then((r) => r.json())
      .then((d: { ath?: Record<string, number> }) => { if (alive) setAthMap(d.ath ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [athSyms.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const athOf = (r: MarketRow) => athPct(r.num, r.chartSymbol ? athMap[r.chartSymbol.toUpperCase()] : undefined);

  // Local price alerts: arm the bell, click a price on the chart to set a level;
  // a browser Notification fires when the live quote crosses it (edge-triggered).
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [armed, setArmed] = useState(false);
  useEffect(() => { setAlerts(loadAlerts()); }, []);
  const prevPrices = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!data.generatedAt) return;
    for (const a of alerts) {
      const row = allRows.find((r) => r.id === a.rowId);
      if (!row || typeof row.num !== "number") continue;
      if (crossed(a, prevPrices.current[a.rowId], row.num)) notifyAlert(a, row.num);
    }
    for (const r of allRows) if (typeof r.num === "number") prevPrices.current[r.id] = r.num;
  }, [data.generatedAt, alerts, allRows]);
  const armToggle = () => setArmed((v) => {
    const next = !v;
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    return next;
  });
  const placeAlert = (price: number) => {
    if (!selRow) return;
    const cur = selRow.num ?? price;
    setAlerts(addAlert({ rowId: selRow.id, symbol: selRow.symbol ?? selRow.id, name: selRow.name, price, dir: price >= cur ? "above" : "below", createdAt: Date.now() }));
    setArmed(false);
  };
  const selAlerts = useMemo(() => alerts.filter((a) => a.rowId === selId), [alerts, selId]);
  const selGuides = useMemo<PriceGuide[]>(
    () => selAlerts.map((a) => ({ price: a.price, color: a.dir === "above" ? "#16a34a" : "#dc2626", label: `${a.dir === "above" ? "▲" : "▼"} ${fmtNum(a.price)}` })),
    [selAlerts],
  );

  // Primary historical chart: keyless Yahoo v8 OHLC for the selected instrument +
  // range. Dormant-safe — the route never 5xxes, and a <2-candle result (dormant /
  // no history / crypto-FX symbol Yahoo doesn't chart) falls back to the live series.
  const [range, setRange] = useState<Range>("6mo");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  // Chart presentation: candlestick vs gradient line, technical overlays, and the
  // candle under the cursor (drives the OHLC read-out).
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [ind, setInd] = useState<Record<IndKey, boolean>>({ ma: false, boll: false, vol: false, rsi: false, bench: false, anom: true });
  const toggleInd = (k: IndKey) => setInd((s) => ({ ...s, [k]: !s[k] }));
  const [hover, setHover] = useState<Candle | null>(null);
  useEffect(() => {
    if (!selSym) { setCandles([]); setHover(null); return; }
    // Clear the previous instrument's candles immediately so a symbol/range switch never
    // renders — or exports — stale OHLC under the new header while the new fetch is in
    // flight (hasHistory drops to false → loading/live-series fallback + export disabled).
    setCandles([]); setHover(null);
    let alive = true;
    setChartLoading(true);
    fetch(`/api/markets/chart?symbol=${encodeURIComponent(selSym)}&range=${range}`)
      .then((r) => r.json())
      .then((d: { candles?: Candle[] }) => { if (alive) setCandles(Array.isArray(d.candles) ? d.candles : []); })
      .catch(() => { if (alive) setCandles([]); })
      .finally(() => { if (alive) setChartLoading(false); });
    return () => { alive = false; };
  }, [selSym, range]);

  const hasHistory = candles.length >= 2;

  // Benchmark correlation overlay: crypto compares against BTC (ETH if BTC is
  // selected); everything else against SPY (QQQ if SPY is selected). Fetched only
  // while the toggle is on; overlaid as a faint, rescaled SHAPE line (not a price).
  const benchSym = useMemo(() => {
    if (!ind.bench || !selSym) return null;
    const crypto = selSectionKey === "crypto";
    const pick = crypto ? (selSym === "BTC-USD" ? "ETH-USD" : "BTC-USD") : (selSym === "SPY" ? "QQQ" : "SPY");
    return pick === selSym ? null : pick;
  }, [ind.bench, selSym, selSectionKey]);
  const [benchCandles, setBenchCandles] = useState<Candle[]>([]);
  useEffect(() => {
    if (!benchSym) { setBenchCandles([]); return; }
    let alive = true;
    fetch(`/api/markets/chart?symbol=${encodeURIComponent(benchSym)}&range=${range}`)
      .then((r) => r.json())
      .then((d: { candles?: Candle[] }) => { if (alive) setBenchCandles(Array.isArray(d.candles) ? d.candles : []); })
      .catch(() => { if (alive) setBenchCandles([]); });
    return () => { alive = false; };
  }, [benchSym, range]);

  // Technical overlays, all derived from the real candles via the unit-tested maths.
  const closes = useMemo(() => candles.map((k) => k.c), [candles]);
  const overlays = useMemo<OverlayLine[]>(() => {
    const out: OverlayLine[] = [];
    if (ind.ma) {
      out.push({ values: sma(closes, 50), color: "#d9882f", width: 1.3 });
      out.push({ values: sma(closes, 200), color: "#4a78c9", width: 1.3 });
    }
    if (ind.bench && benchCandles.length >= 2 && candles.length >= 2) {
      let lo = Infinity, hi = -Infinity;
      for (const k of candles) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; }
      const shaped = rescaleShape(resample(benchCandles.map((k) => k.c), candles.length), lo, hi);
      out.push({ values: shaped, color: "#7c5cbf", width: 1.2, dash: true });
    }
    return out;
  }, [ind.ma, ind.bench, closes, benchCandles, candles]);
  const band = useMemo<BandOverlay | null>(() => {
    if (!ind.boll) return null;
    const b = bollinger(closes, 20, 2);
    return { upper: b.map((x) => x.upper), lower: b.map((x) => x.lower), color: "#4a78c9" };
  }, [ind.boll, closes]);
  const volProfile = useMemo(() => (ind.vol ? volumeProfile(candles, 24) : null), [ind.vol, candles]);
  const anomalies = useMemo(() => (ind.anom ? anomalyFlags(candles, 2.5) : []), [ind.anom, candles]);
  const rsiPoints = useMemo<ChartPoint[]>(() => {
    if (!ind.rsi) return [];
    return rsi(closes, 14).map((v, i) => (v == null ? null : { x: candles[i].t, y: v })).filter((p): p is ChartPoint => p != null);
  }, [ind.rsi, closes, candles]);
  const chg = useMemo(() => periodChange(candles), [candles]);
  const range52 = useMemo(() => hiLo(candles), [candles]);
  // Honest fallback: chart the accumulated live mkt:<id> series when there's no
  // real history. Read in render (folds in the latest recorded sample via tick).
  const livePoints: ChartPoint[] = useMemo(
    () => (selId ? seriesSamples(`mkt:${selId}`).map((s) => ({ x: s.t, y: s.n })) : []),
    [selId, data.generatedAt],
  );
  const chartPoints = hasHistory ? candlesToPoints(candles) : livePoints;
  const chartUp = hasHistory
    ? chg.abs >= 0
    : selRow?.changePct == null ? null : selRow.changePct >= 0;

  // Sortable instrument table across every section (with its section attribution).
  const [sortKey, setSortKey] = useState<TableSortKey>("changePct");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [openTid, setOpenTid] = useState<string | null>(null);
  const tableRows = useMemo(() => {
    const arr = railSections.flatMap((s) => s.rows.map((r) => ({ r, secLabel: s.label, secSrc: s.source })));
    return arr.sort((a, b) => {
      let d: number;
      if (sortKey === "name") d = (a.r.symbol ?? a.r.name).localeCompare(b.r.symbol ?? b.r.name);
      else if (sortKey === "changePct") d = (a.r.changePct ?? -Infinity) - (b.r.changePct ?? -Infinity);
      else if (sortKey === "ath") d = (athOf(a.r) ?? -Infinity) - (athOf(b.r) ?? -Infinity);
      else d = (a.r.num ?? -Infinity) - (b.r.num ?? -Infinity);
      return d * sortDir;
    });
  }, [railSections, sortKey, sortDir, athMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSort = (k: TableSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "name" ? 1 : -1); }
  };
  const sortMark = (k: TableSortKey) => (sortKey === k ? (sortDir === -1 ? " ↓" : " ↑") : "");
  const onTableRow = (id: string) => { selectRow(id); setOpenTid((o) => (o === id ? null : id)); };

  // Exports: a full quotes CSV (every instrument) + a per-selected-instrument OHLC
  // CSV built from the real candles (only when history is present — no fabrication).
  const exportRows = useMemo(
    () => railSections.flatMap((s) => s.rows.map((r) => ({
      section: s.label, name: r.name, symbol: r.symbol ?? "", value: r.value, num: r.num ?? "", changePct: r.changePct ?? "",
    }))),
    [railSections],
  );
  const sources = useMemo(() => Array.from(new Set(sections.map((s) => s.source))), [sections]);
  const exportOhlc = () => {
    if (!hasHistory || !selRow) return;
    const rows = candles.map((k) => ({ t: new Date(k.t).toISOString(), o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));
    downloadText(`${exportFilename(`markets-${selSym}-${range}`, Date.now())}.csv`, "text/csv", toCsv(rows));
  };

  const now = Date.now();

  if (status === "loading" && allRows.length === 0) return <p className="tn-w-empty">Loading markets…</p>;

  return (
    <div className="tn-mk">
      <header className="tn-mk-head">
        <div className="tn-mk-title">Markets</div>
        <div className="tn-mk-stat">
          <b>{allRows.length}</b> instruments · {sections.length} asset {sections.length === 1 ? "class" : "classes"} · updated {freshLabel(data.generatedAt, now)}
        </div>
        <div className="tn-mk-disc">Indicative only — not financial advice. Quotes delayed, keyless.</div>
      </header>

      {allRows.length === 0 && <p className="tn-w-empty">Markets unavailable.</p>}

      {movers.length > 0 && (
        <div className="tn-mk-heat" aria-label="Biggest movers">
          {movers.map((r) => (
            <button
              key={r.id}
              className={`tn-mk-heat-chip ${selId === r.id ? "is-sel" : ""}`}
              style={{ background: moverBg(r.changePct as number) }}
              onClick={() => selectRow(r.id)}
              title={`${r.name} ${(r.changePct as number) >= 0 ? "+" : ""}${r.changePct}%`}
            >
              <span className="tn-mk-heat-sym">{r.symbol ?? r.name}</span>
              <span className="tn-mk-heat-pct">{(r.changePct as number) >= 0 ? "+" : ""}{r.changePct}%</span>
            </button>
          ))}
        </div>
      )}

      {allRows.length > 0 && (
        <div className="tn-mk-body">
          <aside className="tn-mk-rail" aria-label="Instruments">
            {railSections.map((sec) => (
              <div key={sec.key} className="tn-mk-sec">
                <div className="tn-mk-sec-h">
                  <span className="tn-mk-sec-label">{sec.label}</span>
                  <span className="tn-mk-sec-src">{sec.source}</span>
                </div>
                {/* Stale rows are real but not current — say so above them. */}
                {sec.stale && sec.note ? (
                  <p className="tn-mk-sec-note">⏳ {sec.note}</p>
                ) : null}
                {sec.dormant ? (
                  <p className="tn-mk-sec-note">🔒 {sec.note ?? "Needs an API key."}</p>
                ) : (
                  <ul className="tn-mk-rows">
                    {sec.rows.map((r) => {
                      const spark: ChartPoint[] = seriesSamples(`mkt:${r.id}`).map((s) => ({ x: s.t, y: s.n }));
                      return (
                        <li key={r.id}>
                          <button
                            className={`tn-mk-row ${selId === r.id ? "is-sel" : ""}`}
                            onClick={() => selectRow(r.id)}
                            aria-pressed={selId === r.id}
                          >
                            <span className="tn-mk-row-main">
                              <span className="tn-mk-row-sym">{r.symbol ?? r.name}</span>
                              <span className="tn-mk-row-name">{r.name}</span>
                            </span>
                            <span className="tn-mk-row-val">
                              <span className="tn-mk-row-price">{r.value}</span>
                              {r.changePct != null && (
                                <span className={`tn-mk-chg ${r.changePct >= 0 ? "up" : "down"}`}>
                                  {r.changePct >= 0 ? "+" : ""}{r.changePct}%
                                </span>
                              )}
                            </span>
                            <span className="tn-mk-row-spark">
                              <Chart points={spark} height={28} area={false} zeroBaseline={false} up={r.changePct == null ? null : r.changePct >= 0} />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </aside>

          <main className="tn-mk-main">
            {selRow ? (
              <div className="tn-mk-panel">
                <div className="tn-mk-panel-head">
                  <div>
                    <div className="tn-mk-panel-title">{selRow.name}{selRow.symbol ? ` · ${selRow.symbol}` : ""}</div>
                    <div className="tn-mk-panel-sub">{selRow.value}{selRow.sub ? ` · ${selRow.sub}` : ""}</div>
                  </div>
                  <div className="tn-mk-tabs" role="tablist" aria-label="Chart range">
                    {RANGES.map((rg) => (
                      <button key={rg} role="tab" aria-selected={range === rg} className={`tn-mk-tab ${range === rg ? "active" : ""}`} onClick={() => setRange(rg)}>
                        {RANGE_LABEL[rg]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tn-mk-chart-ctrls">
                  <div className="tn-mk-ctrls-l">
                    <div className="tn-mk-seg" role="tablist" aria-label="Chart type">
                      <button role="tab" aria-selected={chartType === "candles"} className={chartType === "candles" ? "active" : ""} onClick={() => setChartType("candles")}>Candles</button>
                      <button role="tab" aria-selected={chartType === "line"} className={chartType === "line" ? "active" : ""} onClick={() => setChartType("line")}>Line</button>
                    </div>
                    {hasHistory && chartType === "candles" && (
                      <button className={`tn-mk-bell ${armed ? "on" : ""}`} aria-pressed={armed} onClick={armToggle}
                        title={armed ? "Click a price on the chart to set an alert" : "Arm a price alert"}>🔔</button>
                    )}
                  </div>
                  {hasHistory && chartType === "candles" && (
                    <div className="tn-mk-inds" role="group" aria-label="Technical overlays">
                      {IND_CHIPS.map(([k, label]) => (
                        <button key={k} className={`tn-mk-ind ${ind[k] ? "on" : ""}`} aria-pressed={ind[k]} onClick={() => toggleInd(k)}>{label}</button>
                      ))}
                    </div>
                  )}
                </div>
                {armed && <div className="tn-mk-arm-hint">Click a price level on the chart to set an alert.</div>}
                {selAlerts.length > 0 && (
                  <div className="tn-mk-alerts">
                    {selAlerts.map((a) => (
                      <span key={a.id} className={`tn-mk-alert ${a.dir}`}>
                        🔔 {a.dir === "above" ? "≥" : "≤"} {fmtNum(a.price)}
                        <button onClick={() => setAlerts(removeAlert(a.id))} aria-label="Remove alert">×</button>
                      </span>
                    ))}
                  </div>
                )}

                {hasHistory && chartType === "candles" ? (
                  <div className="tn-mk-canvas">
                    {hover && (
                      <div className="tn-mk-ohlc" aria-hidden>
                        <span>O <b>{fmtNum(hover.o)}</b></span>
                        <span>H <b className="up">{fmtNum(hover.h)}</b></span>
                        <span>L <b className="down">{fmtNum(hover.l)}</b></span>
                        <span>C <b>{fmtNum(hover.c)}</b></span>
                        {hover.v > 0 && <span>V <b>{fmtVol(hover.v)}</b></span>}
                        <span className="tn-mk-ohlc-t">{new Date(hover.t).toLocaleString()}</span>
                      </div>
                    )}
                    <CandleChart candles={candles} height={240} up={chartUp} overlays={overlays} band={band} volume={volProfile} anomalies={anomalies} guides={selGuides} armed={armed} onPriceClick={placeAlert} onHover={(c) => setHover(c)} />
                    {ind.rsi && rsiPoints.length >= 2 && (
                      <div className="tn-mk-rsi">
                        <span className="tn-mk-rsi-label">RSI 14</span>
                        <Chart points={rsiPoints} height={52} area={false} zeroBaseline={false} up={null} />
                      </div>
                    )}
                  </div>
                ) : chartPoints.length >= 2 ? (
                  <Chart points={chartPoints} height={240} zeroBaseline={false} up={chartUp} markers gradient />
                ) : (
                  <div className="tn-mk-chart-empty">{chartLoading ? "Loading chart…" : "No history yet — accumulating a live session series."}</div>
                )}

                {hasHistory ? (
                  <div className="tn-mk-metrics">
                    <span className={`tn-mk-metric ${chg.abs >= 0 ? "up" : "down"}`}>
                      <span className="tn-mk-metric-label">Change ({RANGE_LABEL[range]})</span>{" "}
                      <b>{chg.abs >= 0 ? "+" : ""}{fmtNum(chg.abs)} ({chg.pct >= 0 ? "+" : ""}{chg.pct.toFixed(2)}%)</b>
                    </span>
                    {range52 && (
                      <span className="tn-mk-metric">
                        <span className="tn-mk-metric-label">{range === "1y" ? "52-wk range" : "Range"}</span>{" "}
                        <b>{fmtNum(range52.lo)} – {fmtNum(range52.hi)}</b>
                      </span>
                    )}
                    {(() => { const a = selRow ? athOf(selRow) : null; return a == null ? null : (
                      <span className="tn-mk-metric"><span className="tn-mk-metric-label">From ATH</span> <b>{a >= -0.05 ? "at high" : `${a.toFixed(1)}%`}</b></span>
                    ); })()}
                    <span className="tn-mk-metric"><span className="tn-mk-metric-label">{candles.length} bars · Yahoo v8, delayed</span></span>
                  </div>
                ) : chartPoints.length >= 2 ? (
                  <div className="tn-mk-chart-note">Live session (accumulating) — historical unavailable for this symbol.</div>
                ) : null}

                {hasHistory && range52 && candles.length > 0 && (
                  <RangeBar lo={range52.lo} hi={range52.hi} cur={candles[candles.length - 1].c} />
                )}
              </div>
            ) : (
              <p className="tn-w-empty">Select an instrument to see its chart.</p>
            )}

            <table className="tn-mk-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort("name")}>Instrument{sortMark("name")}</th>
                  <th className="sortable num" onClick={() => toggleSort("changePct")}>Change{sortMark("changePct")}</th>
                  <th className="sortable num" onClick={() => toggleSort("ath")} title="Percent below all-time high">ATH %{sortMark("ath")}</th>
                  <th className="sortable num" onClick={() => toggleSort("value")}>Value{sortMark("value")}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(({ r, secLabel, secSrc }) => {
                  const isOpen = openTid === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className={`tn-mk-trow ${selId === r.id ? "is-sel" : ""}`} onClick={() => onTableRow(r.id)}>
                        <td><span className="tn-mk-row-sym">{r.symbol ?? r.name}</span> <span className="tn-mk-row-name">{r.name}</span></td>
                        <td className="num">
                          {r.changePct != null
                            ? <span className={`tn-mk-chg ${r.changePct >= 0 ? "up" : "down"}`}>{r.changePct >= 0 ? "+" : ""}{r.changePct}%</span>
                            : <span className="tn-mk-row-name">—</span>}
                        </td>
                        <td className="num">
                          {(() => { const a = athOf(r); return a == null ? <span className="tn-mk-row-name">—</span> : <span className="tn-mk-ath">{a >= -0.05 ? "at high" : `${a.toFixed(1)}%`}</span>; })()}
                        </td>
                        <td className="num">{r.value}</td>
                      </tr>
                      {isOpen && (
                        <tr className="tn-mk-drill">
                          <td colSpan={4}>
                            <dl>
                              <dt>Value</dt><dd>{r.value}</dd>
                              {r.changePct != null && (<><dt>Change</dt><dd className={`tn-mk-chg ${r.changePct >= 0 ? "up" : "down"}`}>{r.changePct >= 0 ? "+" : ""}{r.changePct}%</dd></>)}
                              {r.sub && (<><dt>Detail</dt><dd>{r.sub}</dd></>)}
                              <dt>Class</dt><dd>{secLabel}</dd>
                              <dt>Source</dt><dd>{secSrc}</dd>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </main>
        </div>
      )}

      {sections.length > 0 && (
        <footer className="tn-mk-foot">
          <span className="tn-mk-attr">
            {sources.map((src) => <span key={src}>{src}</span>)}
            <span>Indicative only — not financial advice.</span>
          </span>
          <span className="tn-mk-actions">
            <button
              disabled={exportRows.length === 0}
              onClick={() => downloadText(`${exportFilename("markets", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
            >⬇ CSV (quotes)</button>
            <button
              disabled={!hasHistory}
              onClick={exportOhlc}
              title={hasHistory ? `Export OHLC for ${selSym}` : "No history to export"}
            >⬇ OHLC{selSym ? ` (${selSym})` : ""}</button>
          </span>
        </footer>
      )}
    </div>
  );
}
