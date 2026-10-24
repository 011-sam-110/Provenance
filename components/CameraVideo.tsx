"use client";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { AttributionBadge } from "@/components/AttributionBadge";
import { CameraImage } from "@/components/CameraImage";
import { clearVideoFatal, markVideoFatal, videoRecentlyFatal } from "@/lib/cameras/videoFatal";
import { VIDEO_RECHECK_MS, pictureOutcome, readPicture } from "@/lib/console/widgets/camslot.picture";
import type { StreamOutcome } from "@/lib/console/widgets/camslot.health";

export function CameraVideo(props: {
  id: string; alt: string; attribution: string; license: string; refreshSeconds: number;
  /** Report whether this stream is answering, so a genuinely dead camera can be
   *  benched. Passed THROUGH to the still below on the fallback path: that is the
   *  bug this closes — the video path used to report nothing at all, so a dead
   *  stream was re-fetched on every rotation and never benched. The still is what
   *  says whether the CAMERA is dead, as opposed to just its video.
   *
   *  A playing stream is reported by what its PICTURE shows, not by the fact that it
   *  plays: see `judgeFrame` below. */
  onOutcome?: (outcome: StreamOutcome) => void;
  /** True while this view is the hidden prefetch. See the play() effect below. */
  hidden?: boolean;
}) {
  const { id, alt, attribution, license, refreshSeconds, onOutcome, hidden = false } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(() => videoRecentlyFatal(id, Date.now()));
  const src = `/api/hls?id=${encodeURIComponent(id)}`;
  const poster = `/api/proxy?id=${encodeURIComponent(id)}`;

  // A NEW STREAM IN THE SAME INSTANCE IS A NEW QUESTION. Without this, `failed` is a
  // one-way latch: it is a useState initialiser, so it is evaluated once and never
  // again, and while it is true no <video> is rendered — which makes the effect below
  // return at `!videoRef.current`, so nothing can ever put the player back. A camslot
  // tile rotates by changing this component's props, not by remounting it
  // (camslot.tsx mounts StreamView without a key), so one dead camera in a five-camera
  // tile downgraded that tile to stills for the rest of the session. Both siblings
  // already do exactly this: CameraImage.tsx and WebcamImage in camslot.tsx.
  useEffect(() => { setFailed(videoRecentlyFatal(id, Date.now())); }, [id]);

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
    // `failed` is a dependency because the <video> exists ONLY while it is false, and
    // the reset above lands in a different commit from the element's arrival: on a
    // rotation back off the still, this effect would otherwise run once against a null
    // ref and never be asked again. It cannot loop — the only write is setFailed(true)
    // on a fatal error, which unmounts the element, so the re-run returns at `!video`.
  }, [src, id, failed]);

  // AUTOPLAY DOES NOT SURVIVE BEING BORN HIDDEN, so becoming visible has to ask.
  //
  // Chromium will not start a media element inside a `display:none` subtree, and the
  // camslot prefetch mounts the NEXT stream exactly that way. Once the two views are
  // keyed by stream, the element that becomes visible is always the one that was
  // created hidden — so `autoPlay` was declined for it while it was invisible and
  // nothing asked again.
  //
  // WHAT IS AND IS NOT MEASURED. The mechanism is certain; the size of the win is
  // not. Runs of scripts/verify-streets-area.mjs put "elements with readyState>=2 AND
  // currentTime>0" at 1/27, 0/36 and 1/27 — the gate's check flips on that margin, so
  // this is not evidence of a large improvement and should not be read as one. What
  // IS measured, and large, is the switch→first-paint time the keyed prefetch buys:
  // 20/20 switches painting at a ~162ms average, against 7-of-20 never painting
  // inside 15s and an ~8.9s average before it. Those are different claims and only
  // the second one has numbers behind it.
  //
  // `.catch()` because play() rejects for reasons that are not failures here — a
  // teardown mid-call, or a policy refusal we cannot argue with. A refusal leaves the
  // poster frame up, which is what the element would have shown anyway.
  useEffect(() => {
    if (hidden || failed) return;
    const video = videoRef.current;
    if (!video || !video.paused) return;
    void video.play().catch(() => {});
  }, [hidden, failed, src]);

  // A stream that reaches `playing` is answering, whatever it did before, so the
  // memo is cleared here rather than left to time out. Frames arriving is the
  // admission fact — `canplay` only says the browser thinks it could start.
  //
  // WHAT IS REPORTED IS THE PICTURE. A stream that plays its operator's
  // "unavailable" card, or nothing but black, plays perfectly well, so `playing`
  // alone used to report it healthy on every visit and the bench never took it out.
  // The frame on screen is judged instead (camslot.picture.ts): once as playback
  // starts, then once per VIDEO_RECHECK_MS while it plays, so a camera that drops to
  // its card mid-dwell is caught too. A frame that cannot be read reports what
  // `playing` always reported. Nothing here fetches: it reads the <video> already on
  // screen, whose bytes came through /api/hls.
  const lastJudgedAt = useRef(0);
  const judgeFrame = (video: HTMLVideoElement) => {
    lastJudgedAt.current = Date.now();
    onOutcome?.(pictureOutcome(readPicture(video)));
  };
  const onPlaying = (e: SyntheticEvent<HTMLVideoElement>) => {
    clearVideoFatal(id);
    if (onOutcome && !hidden) judgeFrame(e.currentTarget);
  };
  const onTimeUpdate = (e: SyntheticEvent<HTMLVideoElement>) => {
    if (!onOutcome || hidden || Date.now() - lastJudgedAt.current < VIDEO_RECHECK_MS) return;
    judgeFrame(e.currentTarget);
  };

  // A NATIVE HLS FAILURE ARRIVES AS AN `error` ON THE ELEMENT, AND NOTHING LISTENED.
  // hls.js reports a dead stream through its own ERROR event (above); the browser's own
  // player only through the media element. Chrome now plays HLS itself, as Safari does
  // (measured 2026-10-24, Chrome 155: canPlayType("application/vnd.apple.mpegurl") is
  // "maybe"), so on desktop Chrome every tile takes the native branch. That morning 7
  // of the 14 streams on the downtown Los Angeles wall failed there — six answered 404
  // ("MEDIA_ELEMENT_ERROR: Format error"), one would not demux — and each one sat on
  // its poster for good. The poster is the camera's still, and the still of a camera
  // that is down is its operator's "unavailable" card: that is the card with play and
  // mute buttons under it. Nothing fell back, nothing was judged, nothing was benched.
  // A media error on the native branch now counts as a fatal hls.js error does. On the
  // hls.js branch (a blob: source) the element's errors are hls.js's to handle — it
  // recovers from some — so they are left to it.
  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (!video.error || video.currentSrc.startsWith("blob:")) return;
    markVideoFatal(id, Date.now());
    setFailed(true);
  };

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
        onTimeUpdate={onTimeUpdate}
        onError={onError}
        style={{ width: "100%" }}
      />
      <figcaption><AttributionBadge attribution={attribution} license={license} /></figcaption>
    </figure>
  );
}
