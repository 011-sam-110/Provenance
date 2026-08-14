"use client";
import { useEffect, useState } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { BRAZIL_CAM_CHANNELS } from "@/lib/console/livecams/brazil.data";

// Brazil live cams — YouTube channels, resolved to their CURRENT streams.
//
// Brazil is a thin country for road CCTV: the toll-road concessionaires hard-403
// a real browser, Motiva/AutoBAn withdrew their public cameras, and Rio publishes
// no camera dataset at all. What Brazil does have is a large community of
// broadcasters running fixed cameras 24/7 on YouTube, which is why this is a
// console board and not a map layer — YouTube attaches no coordinates, and a
// city-centroid pin sitting beside metre-accurate camera pins would misrepresent
// what it is.
//
// Titles shown here are the BROADCASTER'S OWN, verbatim. See brazil.data.ts for
// why nothing about location or category is derived.

interface LiveStream {
  videoId: string;
  title: string;
}

interface ChannelResponse {
  videos?: LiveStream[];
  dormant?: boolean;
  note?: string | null;
}

function LiveCamsBody({ instanceId, config }: WidgetBodyProps) {
  const report = useWidgetReport();
  const channelId = (config.channelId as string) ?? BRAZIL_CAM_CHANNELS[0].channelId;
  const channel =
    BRAZIL_CAM_CHANNELS.find((c) => c.channelId === channelId) ?? BRAZIL_CAM_CHANNELS[0];

  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(0);
  const [picker, setPicker] = useState(false);

  // Same honesty rule as the news widget: "live stream" names the MEDIUM. We
  // cannot observe whether a third-party player is actually playing, so we do
  // not claim a freshness we have not measured.
  useEffect(() => {
    report({ alerts: [], freshLabel: "live stream" });
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPicked(0);
    fetch(`/api/youtube-live?channel=${encodeURIComponent(channel.channelId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ChannelResponse>) : null))
      .then((json) => {
        if (cancelled) return;
        setStreams(json?.videos ?? []);
        setNote(json?.note ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setStreams([]);
          setNote("Could not reach live resolution.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel.channelId]);

  // Dormant or unresolved → the last-known stream, labelled as such. It is
  // expected to rot; saying so is better than presenting it as current.
  const resolved = streams[picked];
  const videoId = resolved?.videoId ?? channel.seedVideoId;
  const usingSeed = !resolved;

  const choose = (id: string) => {
    import("@/lib/console/store").then((m) => m.shellLayoutStore.configure(instanceId, { channelId: id }));
    setPicker(false);
  };

  return (
    <div className="tn-newsw">
      <div className="tn-newsw-screen">
        <iframe
          className="tn-newsw-video"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`}
          title={resolved?.title ?? channel.name}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
        <span className="tn-newsw-ch">{resolved?.title ?? channel.name}</span>
      </div>

      <div className="tn-newsw-tabs">
        {streams.slice(0, 4).map((s, i) => (
          <button key={s.videoId} className={i === picked ? "is-on" : ""} onClick={() => setPicked(i)}>
            {s.title.slice(0, 18)}
          </button>
        ))}
        <button className="tn-newsw-more" onClick={() => setPicker((o) => !o)}>
          {channel.name.slice(0, 16)}&hellip;
        </button>
      </div>

      {(usingSeed || note) && (
        <p className="tn-w-empty">
          {loading
            ? "Checking what this channel is streaming…"
            : usingSeed
              ? `Showing ${channel.name}'s last-known stream — it may have ended. ${note ?? ""}`
              : note}
        </p>
      )}

      {picker && (
        <div className="tn-newsw-picker">
          {BRAZIL_CAM_CHANNELS.map((c) => (
            <button
              key={c.id}
              className={c.channelId === channel.channelId ? "is-on" : ""}
              onClick={() => choose(c.channelId)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const LIVECAMS_WIDGET = {
  id: "livecams-brazil",
  title: "Brazil Live Cams",
  icon: "🇧🇷",
  category: "Cameras",
  defaultHeight: 240,
  defaultConfig: { channelId: BRAZIL_CAM_CHANNELS[0].channelId },
  component: LiveCamsBody,
  help: {
    what: "Live cameras across Brazil — beaches, city centres, BR-101, ports and airports — streamed 24/7 on YouTube by local broadcasters. Titles are theirs, not ours. Channels are resolved to whatever they are streaming right now, so a broadcaster restarting a stream does not break the tile.",
    source: "Independent Brazilian YouTube channels (32 registered)",
    caveat:
      "These are third-party streams, not government camera feeds, and they carry no coordinates — which is why they are a board and not map pins. Availability, ads and outages are the broadcaster's and YouTube's. Without a YOUTUBE_API_KEY the tile falls back to a last-known stream that may have ended.",
  },
};
registerWidget(LIVECAMS_WIDGET);
