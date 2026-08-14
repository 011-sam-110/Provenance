"use client";
// Camera slot — a PLAYLIST of live views, not a single tile.
//
// One stream is a static view; several rotate. That is what lets a handful of tiles
// hold dozens of places inside a fixed grid.
//
// THREE RULES THIS FILE EXISTS TO KEEP:
//  1. Rotation is DISPLAY-ONLY. It changes which already-fetched frame is on screen
//     and never pulls one itself. Only the visible stream is mounted, plus one
//     prefetch, so a 40-stream slot costs the same network as a 2-stream one.
//  2. A slot scrolled out of view stops entirely. Without this, "as many slots as
//     you like" and "only the visible stream fetches" contradict each other.
//  3. Nothing transient reaches `config` — see camslot.prefs.ts for why a pause
//     stored there would mark the whole board as edited.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { CameraImage } from "@/components/CameraImage";
import { useCameras } from "@/lib/cameras/useCameras";
import { camslotPrefs } from "@/lib/console/widgets/camslot.prefs";
import CamslotPicker from "@/lib/console/widgets/camslot.picker";
import {
  sanitizeCamslotConfig,
  nextIndex,
  streamKey,
  embedUrl,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";

/** Windy's image tokens last ~10 minutes and /api/webcam-image is bounded by that. */
const WEBCAM_REFRESH_SECONDS = 600;
/** Used only until the real row arrives. The slowest real cadence, so we never ask
 *  for a frame faster than any operator actually publishes one. */
const FALLBACK_REFRESH_SECONDS = 300;

function useCamslotPaused(): boolean {
  return useSyncExternalStore(
    camslotPrefs.subscribe,
    () => camslotPrefs.get().paused,
    () => false,
  );
}

/** The webcam analogue of CameraImage. /api/webcam-image re-resolves Windy's
 *  short-lived token server-side, so the client only ever holds an id. */
function WebcamImage({ id, alt }: { id: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  if (failed) return <div className="tn-cs-dead">This webcam is no longer published.</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/webcam-image?id=${encodeURIComponent(id)}`}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}

/** One rendered view. Kept mounted while it is current or prefetching, so its own
 *  refresh interval survives; unmounted only when it leaves that pair. */
function StreamView({
  stream,
  refreshSeconds,
  label,
  hidden,
}: {
  stream: StreamRef;
  refreshSeconds: number;
  label: string;
  hidden: boolean;
}) {
  const style = hidden ? ({ display: "none" } as const) : undefined;

  if (stream.k === "yt") {
    return (
      <div className="tn-cs-view" style={style}>
        <iframe
          className="tn-cs-frame"
          src={embedUrl(stream.videoId)}
          title={label}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="tn-cs-view" data-kind={stream.k} style={style}>
      {stream.k === "webcam" ? (
        <WebcamImage id={stream.id} alt={label} />
      ) : (
        <CameraImage
          id={stream.id}
          alt={label}
          attribution=""
          license=""
          refreshSeconds={refreshSeconds}
        />
      )}
    </div>
  );
}

function CamslotBody({ instanceId, config }: WidgetBodyProps) {
  // Config is untrusted even here: it arrives from ?c= links and from live
  // configure() calls, so it is re-validated rather than cast.
  const cfg = useMemo(() => sanitizeCamslotConfig(config), [config]);
  const streams = cfg.streams;
  const paused = useCamslotPaused();

  const [i, setI] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [visible, setVisible] = useState(true);
  const [picking, setPicking] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Names and cadences come from the shared camera poller — ref-counted, so several
  // slots share one 60s poll instead of each starting their own.
  const { cameras } = useCameras();
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);

  // Keep the index inside the playlist when streams are removed under a running
  // rotation.
  useEffect(() => {
    if (i >= streams.length) setI(0);
  }, [i, streams.length]);

  // Rule 2: a slot nobody is looking at costs nothing.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A playlist containing a YouTube embed does not rotate: an embed needs 2–4s to
  // bootstrap and can serve a pre-roll, so at a 5s dwell the viewer would watch an
  // advert start and be killed, every time, forever.
  const hasEmbed = streams.some((s) => s.k === "yt");
  const rotates = streams.length > 1 && !hasEmbed;
  const holding = paused || hovering || !visible;

  useEffect(() => {
    if (!rotates || holding) return;
    const t = setInterval(() => setI((n) => nextIndex(n, streams.length)), cfg.intervalMs);
    return () => clearInterval(t);
  }, [rotates, holding, streams.length, cfg.intervalMs]);

  const labelFor = useCallback(
    (s: StreamRef): string => {
      if (s.k === "yt") return "YouTube stream";
      if (s.k === "webcam") return `Webcam ${s.id.replace(/^windy:/, "")}`;
      return byId.get(s.id)?.name ?? s.id;
    },
    [byId],
  );

  const refreshFor = useCallback(
    (s: StreamRef): number => {
      if (s.k === "webcam") return WEBCAM_REFRESH_SECONDS;
      if (s.k === "cam") return byId.get(s.id)?.refreshSeconds ?? FALLBACK_REFRESH_SECONDS;
      return FALLBACK_REFRESH_SECONDS;
    },
    [byId],
  );

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: streams.length,
      freshLabel: streams.length > 0 ? "live views" : undefined,
    });
  }, [report, streams.length]);

  if (streams.length === 0) {
    return (
      <div className="tn-cs" ref={hostRef}>
        <div className="tn-cs-empty">
          <button className="tn-cs-add" onClick={() => setPicking(true)}>
            ＋ Add a camera
          </button>
          <span>Search a place, or paste a YouTube link</span>
        </div>
        {picking && (
          <CamslotPicker
            instanceId={instanceId}
            streams={streams}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    );
  }

  const safeIndex = i < streams.length ? i : 0;
  const current = streams[safeIndex];
  const upcoming = rotates ? streams[nextIndex(safeIndex, streams.length)] : undefined;

  return (
    <div
      className="tn-cs"
      ref={hostRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="tn-cs-stage" data-fit={cfg.fit ?? "cover"}>
        {/* Rule 1: exactly the current view, plus one hidden prefetch. Never the
            whole playlist — that is what would multiply fetches. */}
        <StreamView
          stream={current}
          refreshSeconds={refreshFor(current)}
          label={labelFor(current)}
          hidden={false}
        />
        {upcoming && streamKey(upcoming) !== streamKey(current) && (
          <StreamView
            stream={upcoming}
            refreshSeconds={refreshFor(upcoming)}
            label={labelFor(upcoming)}
            hidden
          />
        )}
      </div>

      <div className="tn-cs-bar">
        <span className="tn-cs-name" title={labelFor(current)}>
          {labelFor(current)}
        </span>
        {streams.length > 1 && (
          <span className="tn-cs-pos">
            {safeIndex + 1}/{streams.length}
          </span>
        )}
      </div>

      <div className="tn-cs-ctl">
        {streams.length > 1 && (
          <>
            <button
              aria-label="Previous camera"
              onClick={() => setI((n) => (n - 1 + streams.length) % streams.length)}
            >
              ‹
            </button>
            <button
              aria-label="Next camera"
              onClick={() => setI((n) => nextIndex(n, streams.length))}
            >
              ›
            </button>
          </>
        )}
        {rotates && (
          <button
            aria-pressed={paused}
            aria-label={paused ? "Resume rotation" : "Pause rotation"}
            onClick={() => camslotPrefs.set(!paused)}
          >
            {paused ? "▶" : "❙❙"}
          </button>
        )}
        <button aria-label="Add or remove cameras" onClick={() => setPicking(true)}>
          ＋
        </button>
      </div>

      {/* An auto-changing region must not be announced continuously — that would
          interrupt a screen-reader user indefinitely. The position marker and the
          picker's list are the accessible route through the playlist instead. */}
      <span className="tn-cs-sr" aria-live="off">
        {labelFor(current)} — {safeIndex + 1} of {streams.length}
        {hasEmbed && streams.length > 1
          ? " — rotation is off while a YouTube stream is in this slot"
          : ""}
        {paused && rotates ? " — paused" : ""}
      </span>

      {picking && (
        <CamslotPicker
          instanceId={instanceId}
          streams={streams}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

export const CAMSLOT_WIDGET = {
  id: "camslot",
  title: "Camera wall",
  icon: "🎦",
  category: "Cameras",
  defaultHeight: 260,
  defaultConfig: { streams: [], intervalMs: 5000 },
  component: CamslotBody,
  help: {
    what: "A slot you fill with live views — road cameras, city webcams, or a YouTube stream you paste. Give it one and it stays put; give it several and it cycles through them, so a handful of tiles can hold dozens of places.",
    source: "Public transport-agency camera feeds, Windy webcams, and any YouTube video you paste",
  },
};
registerWidget(CAMSLOT_WIDGET);

export default CamslotBody;
