"use client";
import { useEffect, useRef, useState } from "react";
import { AttributionBadge } from "@/components/AttributionBadge";
import { CameraImage } from "@/components/CameraImage";
import { clearVideoFatal, markVideoFatal, videoRecentlyFatal } from "@/lib/cameras/videoFatal";

export function CameraVideo(props: {
  id: string; alt: string; attribution: string; license: string; refreshSeconds: number;
  /** Report whether this stream is answering, so a genuinely dead camera can be
   *  benched. Passed THROUGH to the still below on the fallback path: that is the
   *  bug this closes — the video path used to report nothing at all, so a dead
   *  stream was re-fetched on every rotation and never benched. The still is what
   *  says whether the CAMERA is dead, as opposed to just its video. */
  onOutcome?: (ok: boolean) => void;
}) {
  const { id, alt, attribution, license, refreshSeconds, onOutcome } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(() => videoRecentlyFatal(id, Date.now()));
  const src = `/api/hls?id=${encodeURIComponent(id)}`;
  const poster = `/api/proxy?id=${encodeURIComponent(id)}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Already known bad: do not re-open the handshake, just show the still.
    if (videoRecentlyFatal(id, Date.now())) { setFailed(true); return; }
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src; // Safari plays HLS natively
      return;
    }
    (async () => {
      const Hls = (await import("hls.js")).default;
      if (cancelled) return;
      if (!Hls.isSupported()) { setFailed(true); return; }
      const instance = new Hls({ enableWorker: true });
      hls = instance;
      instance.loadSource(src);
      instance.attachMedia(video);
      instance.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          markVideoFatal(id, Date.now());
          setFailed(true);
          instance.destroy();
          hls = null;
        }
      });
    })();

    return () => { cancelled = true; if (hls) hls.destroy(); };
  }, [src, id]);

  // A stream that reaches `playing` is answering, whatever it did before, so the
  // memo is cleared here rather than left to time out. Frames arriving is the
  // admission fact — `canplay` only says the browser thinks it could start.
  const onPlaying = () => { clearVideoFatal(id); onOutcome?.(true); };

  if (failed) {
    return (
      <CameraImage
        id={id}
        alt={alt}
        attribution={attribution}
        license={license}
        refreshSeconds={refreshSeconds}
        onOutcome={onOutcome}
      />
    );
  }
  return (
    <figure style={{ margin: 0 }}>
      <video
        ref={videoRef}
        poster={poster}
        controls
        autoPlay
        muted
        playsInline
        aria-label={alt}
        onPlaying={onPlaying}
        style={{ width: "100%" }}
      />
      <figcaption><AttributionBadge attribution={attribution} license={license} /></figcaption>
    </figure>
  );
}
