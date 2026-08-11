"use client";
// Markets — a calm right-side slide-in showing live crypto prices. Opt-in (opened
// from the layer rail or ⌘K), so it never clutters the globe. Reuses the dossier /
// coverage idioms: a small external open store, /api/markets behind a ≥60s server
// cache, and the .tn-* light tokens. Honest by construction: it is labelled
// "Crypto markets · CoinGecko" and shows when the snapshot was last refreshed.
// Up = calm green, down = calm red (no neon). Only real keyless crypto is shown —
// no fabricated stock indices or commodities.

import { useEffect, useState } from "react";
import { marketsStore, useMarketsOpen } from "@/lib/shell/markets";
import { type MarketsPayload, type MarketRow } from "@/lib/markets";
import { useNow, formatAge } from "@/lib/shell/useNow";

const REFRESH_MS = 60_000;

// One markets row: asset (icon/name/symbol) · value · optional signed % change.
function MarketRowItem({ row }: { row: MarketRow }) {
  const up = row.changePct != null && row.changePct >= 0;
  const dir = row.changePct == null ? "flat" : up ? "up" : "down";
  return (
    <li className="tn-markets-row">
      <span className="tn-markets-asset">
        {row.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tn-markets-icon" src={row.image} alt="" width={18} height={18} />
        ) : (
          <span className="tn-markets-icon tn-markets-icon-fallback" aria-hidden />
        )}
        <span className="tn-markets-name">{row.name}</span>
        {row.symbol ? <span className="tn-markets-symbol">{row.symbol}</span> : null}
        {row.sub ? <span className="tn-markets-rowsub">{row.sub}</span> : null}
      </span>
      <span className="tn-markets-price tn-num">{row.value}</span>
      {row.changePct == null ? (
        <span className="tn-markets-change tn-markets-flat tn-num" aria-hidden />
      ) : (
        <span className={`tn-markets-change tn-markets-${dir} tn-num`}>
          {`${up ? "▲" : "▼"} ${Math.abs(row.changePct).toFixed(2)}%`}
        </span>
      )}
    </li>
  );
}

export default function MarketsPanel({ docked = false }: { docked?: boolean } = {}) {
  const open = useMarketsOpen();
  const active = open || docked; // docked = rendered as a workspace tile (always live)
  const [data, setData] = useState<MarketsPayload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const now = useNow(1000);

  // Fetch on open/dock, then poll on the cache cadence while active.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => {
      setStatus((s) => (data ? s : "loading"));
      fetch("/api/markets")
        .then((r) => r.json())
        .then((d: MarketsPayload) => {
          if (!alive) return;
          setData(d);
          setStatus("idle");
        })
        .catch(() => {
          if (!alive) return;
          setStatus("error");
        });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Esc closes (slide-in only; a docked tile has no close affordance).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") marketsStore.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  const ageMs = data ? Math.max(0, now - data.generatedAt) : null;

  return (
    <aside
      className={`tn-markets${docked ? " tn-docked" : ""}`}
      role={docked ? "region" : "dialog"}
      aria-label="Crypto markets"
    >
      <header className="tn-markets-head">
        <div>
          <h2 className="tn-markets-title">Markets</h2>
          <p className="tn-markets-sub">Crypto · FX · Equities · Macro</p>
        </div>
        {!docked && (
          <button
            type="button"
            className="tn-markets-close"
            onClick={() => marketsStore.close()}
            aria-label="Close markets"
          >
            ×
          </button>
        )}
      </header>

      {status === "error" && !data && (
        <p className="tn-markets-status">Market data is unavailable right now.</p>
      )}
      {status === "loading" && !data && <p className="tn-markets-status">Loading prices…</p>}

      {data?.sections.map((section) => (
        <section key={section.key} className="tn-markets-section">
          <div className="tn-markets-section-head">
            <span className="tn-markets-section-label">{section.label}</span>
            <span className="tn-markets-section-source">{section.source}</span>
          </div>
          {/* A stale section keeps its rows but must say so, or carried-over numbers
              read as live ones. See MarketSection.stale in lib/markets.ts. */}
          {section.stale && section.note ? (
            <p className="tn-markets-stale">{section.note}</p>
          ) : null}
          {section.dormant ? (
            <p className="tn-markets-dormant">{section.note ?? "Add a key to enable."}</p>
          ) : section.rows.length === 0 ? (
            <p className="tn-markets-dormant">No data right now.</p>
          ) : (
            <ul className="tn-markets-list">
              {section.rows.map((r) => (
                <MarketRowItem key={r.id} row={r} />
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className="tn-markets-foot">
        {ageMs != null
          ? `Snapshot updated ${formatAge(ageMs)} ago · refreshes each minute.`
          : "Live keyless data — no account, no key."}{" "}
        Crypto &amp; FX are live and keyless; equities &amp; macro unlock with a free key.
        Indicative only, not financial advice.
      </p>
    </aside>
  );
}
