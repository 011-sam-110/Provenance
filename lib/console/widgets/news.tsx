"use client";
import { useEffect, useRef, useState } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { NEWS_PROVIDERS, parseCustomStream, resolveEmbed, type NewsProvider } from "@/lib/console/news/providers";
import { useLiveVideoIds } from "@/lib/console/news/useLiveVideoIds";
import NewsDetail from "./news.detail";

function NewsBody({ instanceId, config }: WidgetBodyProps) {
  const report = useWidgetReport();
  const activeId = (config.providerId as string) ?? NEWS_PROVIDERS[0].id;
  const custom = config.customProvider as NewsProvider | undefined;
  const active = custom?.id === activeId ? custom : NEWS_PROVIDERS.find((p) => p.id === activeId) ?? NEWS_PROVIDERS[0];
  // Resolved live video ids; falls back to the provider's pinned ref when the
  // resolver is dormant or the channel has nothing live.
  const liveIds = useLiveVideoIds();
  const embed = resolveEmbed(active, liveIds[active.id]);
  const favorites = NEWS_PROVIDERS.filter((p) => p.favorite).slice(0, 4);
  const [picker, setPicker] = useState(false);
  // No `fresh` observation here on purpose: this widget embeds a third-party live
  // video player, and we have no way to observe whether the stream is actually
  // playing. "live stream" names the medium; it does not assert a freshness we
  // cannot measure — which is exactly what the old "live" did.
  useEffect(() => { report({ alerts: [], freshLabel: "live stream" }); }, [report]);

  const choose = (id: string) => { import("@/lib/console/store").then((m) => m.shellLayoutStore.configure(instanceId, { providerId: id })); };
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (embed.kind !== "hls" || !videoRef.current) return;
    const v = videoRef.current; let hls: { destroy(): void } | null = null; let cancelled = false;
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = embed.src; return; }
    (async () => { const Hls = (await import("hls.js")).default; if (cancelled || !Hls.isSupported()) return; const h = new Hls(); hls = h; h.loadSource(embed.src); h.attachMedia(v); })();
    return () => { cancelled = true; hls?.destroy(); };
  }, [embed.kind, embed.src]);

  return (
    <div className="tn-newsw">
      <div className="tn-newsw-screen">
        {embed.kind === "youtube"
          ? <iframe className="tn-newsw-video" src={embed.src} title={active.name} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          : <video ref={videoRef} className="tn-newsw-video" muted autoPlay playsInline controls />}
        <span className="tn-newsw-ch">{active.name}</span>
      </div>
      <div className="tn-newsw-tabs">
        {favorites.map((p) => (
          <button key={p.id} className={p.id === activeId ? "is-on" : ""} onClick={() => choose(p.id)}>{p.name.split(" ")[0]}</button>
        ))}
        <button className="tn-newsw-more" onClick={() => setPicker((o) => !o)}>&#xFF0B; More&hellip;</button>
      </div>
      {picker && (
        <div className="tn-newsw-picker">
          {NEWS_PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => { choose(p.id); setPicker(false); }}>{p.id === activeId ? "✓ " : ""}{p.name} <span className="tn-newsw-cat">{p.category}</span></button>
          ))}
          <input className="tn-newsw-custom" placeholder="Add stream URL (YouTube / .m3u8)…"
                 onKeyDown={(e) => {
                   if (e.key !== "Enter") return;
                   const p = parseCustomStream((e.target as HTMLInputElement).value);
                   if (p) import("@/lib/console/store").then((m) => m.shellLayoutStore.configure(instanceId, { providerId: p.id, customProvider: p }));
                 }} />
        </div>
      )}
    </div>
  );
}

export const NEWS_WIDGET = {
  id: "news", title: "Live News", icon: "📺", category: "News",
  defaultHeight: 240, defaultConfig: { providerId: "aljazeera" }, component: NewsBody, detail: NewsDetail,
  help: {
    what: "A live 24/7 news video stream you can switch between channels — a running backdrop while you watch the map.",
    source: "Public live-stream channels (Al Jazeera, Sky News, DW & more)",
  },
};
registerWidget(NEWS_WIDGET);
