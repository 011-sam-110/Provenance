"use client";
// Saved places — a calm right-side slide-in for bookmarking + recalling map views.
// Opt-in (opened from the rail or the command palette), so it never clutters the globe. Reuses the
// Markets/dossier surface tokens and the watchlist store (persisted list + pure
// ops). "Save current view" captures the live camera (or the focused object); a
// row click flies the globe back there via mapViewStore (no map logic duplicated).

import { useEffect } from "react";
import {
  watchlistPanelStore,
  useWatchlistPanelOpen,
  useWatchlist,
  watchlistStore,
  saveCurrentView,
  recallPlace,
} from "@/lib/shell/watchlist";
import { useT } from "@/lib/i18n/store";

export default function WatchlistPanel({ docked = false }: { docked?: boolean } = {}) {
  const open = useWatchlistPanelOpen();
  const active = open || docked; // docked = rendered as a workspace tile
  const places = useWatchlist();
  const t = useT();

  // Esc closes (mirrors the markets / coverage panels).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") watchlistPanelStore.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  return (
    <aside
      className={`tn-markets tn-saved${docked ? " tn-docked" : ""}`}
      role={docked ? "region" : "dialog"}
      aria-label={t("sectionSaved")}
    >
      <header className="tn-markets-head">
        <div>
          <h2 className="tn-markets-title">{t("sectionSaved")}</h2>
          <p className="tn-markets-sub">Bookmark a view, fly back any time</p>
        </div>
        {!docked && (
          <button
            type="button"
            className="tn-markets-close"
            onClick={() => watchlistPanelStore.close()}
            aria-label="Close saved places"
          >
            ×
          </button>
        )}
      </header>

      <button type="button" className="tn-saved-add" onClick={() => saveCurrentView()}>
        ＋ {t("btnSaveCurrentView")}
      </button>

      {places.length === 0 ? (
        <p className="tn-markets-status">{t("emptyWatchlist")}</p>
      ) : (
        <ul className="tn-saved-list">
          {places.map((p) => (
            <li key={p.id} className="tn-saved-row">
              <button
                type="button"
                className="tn-saved-recall"
                onClick={() => recallPlace(p)}
                title="Fly here"
              >
                <span className={`tn-saved-dot tn-saved-${p.kind}`} aria-hidden />
                <span className="tn-saved-main">
                  <span className="tn-saved-name">{p.label}</span>
                  <span className="tn-saved-meta tn-num">
                    {p.kind === "object" ? "object" : "view"} · {p.lat.toFixed(2)}, {p.lon.toFixed(2)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="tn-saved-remove"
                onClick={() => watchlistStore.remove(p.id)}
                aria-label={`Remove ${p.label}`}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="tn-markets-foot">
        Saved locally in this browser — center, zoom and basemap. Nothing leaves your device.
      </p>
    </aside>
  );
}
