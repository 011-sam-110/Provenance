"use client";
// News-video focus view — a live-news console. A hero player (YouTube iframe / the
// docked NewsBody's inline HLS <video>, reused verbatim — no new player), a keyless
// channel wall grouped by category (Task 3), a live headline rail + optional muted
// 2×2 mosaic (Task 4), and an add-custom-stream directory + CSV export (Task 5).
// Selection persists via shellLayoutStore.configure(instanceId, { providerId }),
// exactly like the docked NEWS_WIDGET. Keyless throughout (YouTube embeds +
// img.youtube.com thumbnails); HLS routes through the existing inline hls.js path.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { NewsItem } from "@/lib/news";
import { useJsonPoll } from "@/lib/console/widgets/useJsonPoll";
import { shellLayoutStore } from "@/lib/console/store";
import { NEWS_PROVIDERS, parseCustomStream, playableRef, providerThumb, resolveEmbed, type NewsProvider } from "@/lib/console/news/providers";
import { useLiveVideoIds } from "@/lib/console/news/useLiveVideoIds";
import { toCsv, downloadText, exportFilename } from "@/lib/export";

/** Compact relative age (mirrors headlines.detail). */
function rel(ts: number, now: number): string {
  if (!ts) return "";
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export default function NewsDetail({ instanceId, config }: WidgetDetailProps) {
  // Seed the active channel from persisted config (providerId + optional customProvider),
  // mirroring how the docked NewsBody resolves it. Local state makes clicking a channel
  // instant; every change also persists via shellLayoutStore.configure (below / Task 3).
  const seedId = (config.providerId as string) ?? NEWS_PROVIDERS[0]?.id ?? "";
  const seedCustom = config.customProvider as NewsProvider | undefined;
  const [activeId, setActiveId] = useState<string>(seedId);
  const [custom, setCustom] = useState<NewsProvider | undefined>(seedCustom);
  // Category filter for the channel wall (Task 3); null = All.
  const [category, setCategory] = useState<string | null>(null);
  // Optional muted 2×2 mosaic (default off — one hero is bandwidth-honest).
  const [mosaic, setMosaic] = useState(false);
  // Add-custom-stream input (Task 5).
  const [customUrl, setCustomUrl] = useState("");
  const [customErr, setCustomErr] = useState(false);

  // Config is the source of truth. Re-sync the local channel when it changes externally
  // (e.g. the user switches channels on the still-visible docked copy) so the focused
  // detail never diverges from the dock. Keyed on primitives to avoid ref-churn re-fires.
  useEffect(() => {
    if (typeof config.providerId === "string") setActiveId(config.providerId);
    setCustom(config.customProvider as NewsProvider | undefined);
  }, [config.providerId, (config.customProvider as NewsProvider | undefined)?.id]);

  const active = useMemo<NewsProvider | undefined>(
    () => (custom?.id === activeId ? custom : NEWS_PROVIDERS.find((p) => p.id === activeId) ?? NEWS_PROVIDERS[0]),
    [activeId, custom],
  );
  // Distinct catalog categories for the filter chips (+ "All").
  const categories = useMemo(() => Array.from(new Set(NEWS_PROVIDERS.map((p) => p.category))), []);

  // Channel wall: the (category-filtered) catalog, grouped by category with headers.
  const wallGroups = useMemo(() => {
    const shown = category == null ? NEWS_PROVIDERS : NEWS_PROVIDERS.filter((p) => p.category === category);
    const by = new Map<string, NewsProvider[]>();
    for (const p of shown) {
      const g = by.get(p.category) ?? [];
      g.push(p);
      by.set(p.category, g);
    }
    return [...by.entries()];
  }, [category]);

  // Select a catalog channel: instant hero swap (local state) + persist the choice,
  // exactly the { providerId } patch the docked NewsBody writes.
  const selectChannel = (p: NewsProvider) => {
    setActiveId(p.id);
    shellLayoutStore.configure(instanceId, { providerId: p.id });
  };

  // Add a custom stream: parse (YouTube URL / .m3u8), then activate + persist the full
  // provider as customProvider (exactly what the docked NewsBody stores). Honest inline
  // error when the URL is neither a YouTube link nor an .m3u8.
  const addCustom = () => {
    const p = parseCustomStream(customUrl);
    if (!p) { setCustomErr(true); return; }
    setCustomErr(false);
    setCustom(p);
    setActiveId(p.id);
    setCustomUrl("");
    shellLayoutStore.configure(instanceId, { providerId: p.id, customProvider: p });
  };

  // Export the static channel directory (id, name, category, kind) as CSV.
  const exportRows = NEWS_PROVIDERS.map((p) => ({ id: p.id, name: p.name, category: p.category, kind: p.kind }));

  // First 4 (category-filtered) YouTube channels for the muted 2×2 mosaic.
  const mosaicCells = useMemo(
    () => (category == null ? NEWS_PROVIDERS : NEWS_PROVIDERS.filter((p) => p.category === category))
      .filter((p) => p.kind === "youtube")
      .slice(0, 4),
    [category],
  );

  // Live headline rail — the SAME keyless /api/news poll the docked headlines widget uses.
  const { data: newsData } = useJsonPoll<{ items: NewsItem[] }>("/api/news", 120_000, { items: [] });
  const headlines = newsData.items ?? [];
  const now = Date.now();

  // Channel-resolved video ids, falling back to each provider's pinned ref.
  const liveIds = useLiveVideoIds();
  const embed = active ? resolveEmbed(active, liveIds[active.id]) : null;

  // HLS hero: reuse the docked NewsBody's inline hls.js loader verbatim (no new player,
  // no /api/hls host change). YouTube heroes use the keyless <iframe> below. Since the
  // static catalog is YouTube-only, HLS only arises from a user-added custom .m3u8.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!embed || embed.kind !== "hls" || !videoRef.current) return;
    const v = videoRef.current;
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = embed.src; return; }
    (async () => {
      const Hls = (await import("hls.js")).default;
      if (cancelled || !Hls.isSupported()) return;
      const h = new Hls();
      hls = h;
      h.loadSource(embed.src);
      h.attachMedia(v);
    })();
    return () => { cancelled = true; hls?.destroy(); };
    // `mosaic` is a dep: toggling it unmounts/remounts the hero <video>, so the effect
    // must re-run to destroy the old hls.js instance and re-attach to the new element.
  }, [embed?.kind, embed?.src, mosaic]);

  if (!active || !embed) {
    return (
      <div className="tn-nv">
        <p className="tn-w-empty">No live channels configured.</p>
      </div>
    );
  }

  return (
    <div className="tn-nv">
      <header className="tn-nv-head">
        <div className="tn-nv-title">Live news</div>
        <div className="tn-nv-now">▶ {active.name} · {active.category}</div>
      </header>

      <div className="tn-nv-tools">
        <div className="tn-nv-chips">
          <button className={category == null ? "is-on" : ""} onClick={() => setCategory(null)}>All</button>
          {categories.map((c) => (
            <button key={c} className={category === c ? "is-on" : ""} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
        <button className={`tn-nv-mtoggle${mosaic ? " is-on" : ""}`} onClick={() => setMosaic((m) => !m)} aria-pressed={mosaic}>
          ▦ Mosaic
        </button>
      </div>

      {mosaic && mosaicCells.length > 0 ? (
        <div className="tn-nv-mosaic">
          {mosaicCells.map((p) => {
            const on = p.id === activeId;
            return (
              <div key={p.id} className={`tn-nv-cell${on ? " is-on" : ""}`}>
                <iframe
                  src={`https://www.youtube.com/embed/${playableRef(p, liveIds[p.id])}?autoplay=1&mute=${on ? 0 : 1}&playsinline=1`}
                  title={p.name}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
                <span className="tn-nv-cell-label">{p.name}{on ? " · 🔊" : ""}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tn-nv-hero">
          {embed.kind === "youtube"
            ? <iframe className="tn-nv-video" src={embed.src} title={active.name} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
            : <video ref={videoRef} className="tn-nv-video" muted autoPlay playsInline controls />}
          <span className="tn-nv-hero-label">{active.name} · LIVE</span>
        </div>
      )}

      <div className="tn-nv-sec-h">Channels</div>
      <div className="tn-nv-wall">
        {wallGroups.map(([cat, ps]) => (
          <Fragment key={cat}>
            <div className="tn-nv-cat-h">{cat}</div>
            {ps.map((p) => {
              const thumb = providerThumb(p, liveIds[p.id]);
              const on = p.id === activeId;
              return (
                <button
                  key={p.id}
                  className={`tn-nv-tile${on ? " is-on" : ""}`}
                  onClick={() => selectChannel(p)}
                  aria-pressed={on}
                >
                  <div className="tn-nv-thumb-wrap">
                    {thumb
                      ? <img className="tn-nv-thumb" src={thumb} alt="" loading="lazy" />
                      : <span className="tn-nv-thumb-fallback">{p.name}</span>}
                    <span className="tn-nv-live"><span className="tn-nv-live-dot" />LIVE</span>
                  </div>
                  <span className="tn-nv-tile-cap">
                    <span className="tn-nv-tile-name">{p.name}</span>
                    <span className="tn-nv-tile-cat">{p.category}</span>
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="tn-nv-sec-h">Latest headlines</div>
      <div className="tn-nv-rail">
        {headlines.length === 0 ? (
          <p className="tn-w-empty">No headlines.</p>
        ) : (
          headlines.slice(0, 12).map((it, i) => (
            <a key={it.url || i} className="tn-nv-rail-item" href={it.url} target="_blank" rel="noreferrer">
              <div className="tn-nv-rail-title">{it.title}</div>
              <div className="tn-nv-rail-meta">{it.source}{it.ts ? ` · ${rel(it.ts, now)}` : ""}</div>
            </a>
          ))
        )}
      </div>

      <footer className="tn-nv-foot">
        <span className="tn-nv-foot-note">
          Channels are the broadcasters&apos; official keyless live streams (YouTube/HLS).
        </span>
        <span className="tn-nv-add">
          <input
            className="tn-nv-custom"
            placeholder="Add stream URL (YouTube / .m3u8)…"
            value={customUrl}
            onChange={(e) => { setCustomUrl(e.target.value); if (customErr) setCustomErr(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
          />
          <button onClick={addCustom} disabled={!customUrl.trim()}>＋ Add</button>
          {customErr && <span className="tn-nv-err">Not a YouTube or .m3u8 URL.</span>}
        </span>
        <span className="tn-nv-actions">
          <button
            disabled={exportRows.length === 0}
            onClick={() => downloadText(`${exportFilename("news-channels", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
          >⬇ Channels CSV</button>
        </span>
      </footer>
    </div>
  );
}
