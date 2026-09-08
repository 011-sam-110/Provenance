"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SatelliteInset } from "@/components/admin/SatelliteInset";
import { EARLY_REJECT_WARNING_MS, MEASURED_FIRST_PAINT_MS, MIN_PRODUCING_MS } from "@/lib/liveness/ledger";
// types.ts, NOT queue.ts. queue.ts imports node:fs, and a type import from a client
// component still drags the module into the browser bundle — green tsc, green suite,
// `next build` dead. tests/unit/client-bundle-node-builtins.test.ts caught exactly that.
import { hoursRemaining, type QueueCamera } from "@/lib/liveness/types";

/**
 * One camera at a time, and admit only what you watched play.
 *
 * WHY THIS IS NOT ReviewDeck. That deck signs a verdict on a FEED after sampling a few
 * of its cameras, and renders media in an <img>. This one signs a verdict on a CAMERA,
 * and the thing it has to establish is that a stream was still producing frames at the
 * moment the verdict was signed. Those are different verdict shapes and different media
 * paths; sharing one component across both is how a 500-line file becomes unreadable.
 *
 * THE ADMISSION FACT. Not "this stream played" — a stream that yields one frame and
 * then stalls would pass that. The recorded fact is continuous frame production, which
 * is why `producingMs` resets to zero on a stall rather than accumulating across one.
 *
 * WHY ADMIT IS LOCKED AT FIRST. If admit fired instantly, holding the arrow key would
 * machine-gun the queue into hundreds of signed claims nobody watched — decoration
 * wearing a human signature, which is worse than no ledger at all. Reject stays
 * available immediately, because a dead stream is obvious at once and there is no claim
 * to protect. The server enforces the same rule on the write path; this lock is the
 * convenience, not the guarantee.
 */

/** A gap longer than this means the stream stopped, and the clock starts over. */
const STALL_MS = 1_500;

type Verdict = "admit" | "dead" | "wrong-pin" | "not-a-camera" | "unsure";

/** Shared with /admin/verify on purpose: one person, one name, both decks. */
const REVIEWER_KEY = "provenance.reviewer";

export function LiveDeck({ queue }: { queue: QueueCamera[] }) {
  const [reviewer, setReviewer] = useState("");
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Array<{ cameraId: string; feed: string; verdict: Verdict | "feed-abandoned" }>>([]);
  const [producingMs, setProducingMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const card = queue[index];
  const next = queue[index + 1];
  const unlocked = producingMs >= MIN_PRODUCING_MS;
  // Rejecting before a stream has had time to connect is the failure that leaves no
  // trace: the camera silently never appears and, under default-deny, never gets a
  // second look. See EARLY_REJECT_WARNING_MS for the measurement behind the number.
  const tooEarlyToCallItDead = producingMs === 0 && elapsedMs < EARLY_REJECT_WARNING_MS;

  useEffect(() => {
    setElapsedMs(0);
    const started = performance.now();
    const id = setInterval(() => setElapsedMs(performance.now() - started), 200);
    return () => clearInterval(id);
  }, [index, reloadNonce]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/live-verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, by: reviewer }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `verdict failed (${res.status})`);
    }
  }, [reviewer]);

  const advance = useCallback(() => {
    setProducingMs(0);
    setError(null);
    setIndex((i) => i + 1);
  }, []);

  const judge = useCallback(
    async (verdict: Verdict) => {
      if (!card || busy) return;
      if (verdict === "admit" && !unlocked) return;
      // The same precondition the Admit button enforces. Without it the two paths
      // disagree: the button greys out with no reviewer name while the arrow key posts
      // anyway and takes a 400. Found by an unexplained 400 in the dev log, which is
      // the whole reason the route requires an author rather than defaulting one.
      if (!reviewer.trim()) {
        setError("Put your name in the Reviewer field first — a verdict needs an author.");
        return;
      }
      setBusy(true);
      try {
        await post({
          cameraId: card.cameraId,
          feed: card.feed,
          verdict,
          ...(verdict === "admit" ? { producingMs } : { waitedMs: Math.round(elapsedMs) }),
        });
        setDone((d) => [...d, { cameraId: card.cameraId, feed: card.feed, verdict }]);
        advance();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [card, busy, unlocked, reviewer, producingMs, elapsedMs, post, advance],
  );

  const abandonFeed = useCallback(async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await post({ kind: "abandon-feed", feed: card.feed });
      const feed = card.feed;
      setDone((d) => [...d, { cameraId: "*", feed, verdict: "feed-abandoned" }]);
      // Skip past every remaining card of that feed rather than re-rendering each one.
      setIndex((i) => {
        let j = i + 1;
        while (j < queue.length && queue[j].feed === feed) j++;
        return j;
      });
      setProducingMs(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [card, busy, post, queue]);

  const back = useCallback(async () => {
    if (index === 0 || busy) return;
    const prev = queue[index - 1];
    setBusy(true);
    try {
      await post({ cameraId: prev.cameraId, feed: prev.feed, verdict: null });
      setDone((d) => d.filter((x) => !(x.cameraId === prev.cameraId && x.feed === prev.feed)));
      setProducingMs(0);
      setError(null);
      setIndex(index - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [index, busy, queue, post]);

  useEffect(() => {
    setReviewer(window.localStorage.getItem(REVIEWER_KEY) ?? "");
  }, []);

  /**
   * Warm the NEXT card with exactly one request, and never with a player.
   *
   * The first version of this mounted a second, hidden StreamStage. Measured on a real
   * SCDOT queue: 1,644 requests to the review proxy in a few minutes, because hls.js
   * retries a failing playlist indefinitely and the hidden instance had no reviewer
   * watching it to notice. That is the hammering pattern this product's camera policy
   * exists to prevent — getting an operator to block the proxy would end the feature
   * outright, and no amount of better code recovers from being blocked.
   *
   * One fetch gets the DNS, TLS and CDN edge warm, which is all the prefetch was ever
   * for. It cannot loop, because there is nothing here to retry.
   */
  useEffect(() => {
    if (!next) return;
    const ac = new AbortController();
    void fetch(`/api/admin/live-stream?u=${encodeURIComponent(next.streamUrl)}`, {
      signal: ac.signal,
      cache: "no-store",
    }).catch(() => {
      // A prefetch that fails is not an event. The card will say so when it is dealt.
    });
    return () => ac.abort();
  }, [next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Keys match /admin/verify deliberately, so the muscle memory transfers.
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          void judge("admit");
          break;
        case "ArrowLeft":
          e.preventDefault();
          void judge("dead");
          break;
        case "p":
        case "P":
          void judge("wrong-pin");
          break;
        case "n":
        case "N":
          void judge("not-a-camera");
          break;
        case "u":
        case "U":
          void judge("unsure");
          break;
        case "r":
        case "R":
          setProducingMs(0);
          setReloadNonce((n) => n + 1);
          break;
        case "Backspace":
          e.preventDefault();
          void back();
          break;
        case "X":
          if (e.shiftKey) void abandonFeed();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judge, back, abandonFeed]);

  const left = queue.length - index;
  const hours = useMemo(() => hoursRemaining(left, MIN_PRODUCING_MS), [left]);

  if (!card) {
    return (
      <div className="adm-empty">
        <p>
          {queue.length === 0
            ? "Nothing in the queue. Run an acquisition pass to fill data/liveness/queue.json."
            : `Queue finished — ${done.length} verdicts this session. They are in data/liveness/ledger.json; commit the diff.`}
        </p>
      </div>
    );
  }

  return (
    <div className="adm-review">
      <div className="adm-main">
        <StreamStage key={`${card.cameraId}:${reloadNonce}`} camera={card} onProducing={setProducingMs} />

        <div className="lv-meter">
          <div className="lv-meter-track">
            <div
              className="lv-meter-fill"
              style={{ transform: `scaleX(${Math.min(1, producingMs / MIN_PRODUCING_MS)})` }}
            />
          </div>
          <span className="lv-meter-label">
            {unlocked
              ? `producing ${(producingMs / 1000).toFixed(1)}s — admit unlocked`
              : producingMs > 0
                ? `watching… ${(producingMs / 1000).toFixed(1)}s of ${(MIN_PRODUCING_MS / 1000).toFixed(0)}s`
                : `connecting… ${(elapsedMs / 1000).toFixed(1)}s, no frame yet`}
          </span>
        </div>

        {tooEarlyToCallItDead ? (
          <p className="lv-warn">
            No frame yet, and it has only been {(elapsedMs / 1000).toFixed(1)}s. Measured on this product{"'"}s own
            camera wall: streams average about {(MEASURED_FIRST_PAINT_MS / 1000).toFixed(1)}s to first paint, and
            roughly a third never paint inside 15s. Rejecting now would mark a working camera dead, and under
            default-deny it would never be looked at again.
          </p>
        ) : null}

        <div className="adm-actions">
          <button
            className="adm-btn adm-btn-good"
            disabled={!unlocked || busy || !reviewer.trim()}
            onClick={() => void judge("admit")}
          >
            → Admit
          </button>
          <button className="adm-btn adm-btn-bad" disabled={busy} onClick={() => void judge("dead")}>
            ← Dead
          </button>
          <button className="adm-btn" disabled={busy} onClick={() => void judge("wrong-pin")}>
            P Wrong pin
          </button>
          <button className="adm-btn" disabled={busy} onClick={() => void judge("not-a-camera")}>
            N Not a camera
          </button>
          <button className="adm-btn" disabled={busy} onClick={() => void judge("unsure")}>
            U Unsure
          </button>
          <button className="adm-btn" disabled={index === 0 || busy} onClick={() => void back()}>
            ⌫ Back
          </button>
          <button className="adm-btn adm-btn-bad" disabled={busy} onClick={() => void abandonFeed()}>
            ⇧X Reject rest of {card.feed}
          </button>
        </div>
        {error ? <p className="adm-note">{error}</p> : null}
      </div>

      <aside className="adm-side">
        <label className="adm-field">
          <span>Reviewer</span>
          <input
            className="adm-input"
            value={reviewer}
            placeholder="your name"
            onChange={(e) => {
              setReviewer(e.target.value);
              window.localStorage.setItem(REVIEWER_KEY, e.target.value);
            }}
          />
        </label>
        <h2 className="adm-cam-name">{card.name}</h2>
        <p className="adm-cam-sub">
          {card.feed} · {card.country} · {card.kind.toUpperCase()}
        </p>
        <div className="adm-map">
          <SatelliteInset lat={card.lat} lon={card.lon} />
        </div>
        <dl className="adm-kv">
          <dt>Operator</dt>
          <dd>{card.operator}</dd>
          <dt>Licence</dt>
          <dd>{card.license}</dd>
          <dt>Attribution</dt>
          <dd>{card.attribution}</dd>
          <dt>Coordinate</dt>
          <dd>
            {card.lat.toFixed(5)}, {card.lon.toFixed(5)}
          </dd>
          <dt>Stream</dt>
          <dd className="adm-log">{card.streamUrl}</dd>
        </dl>

        {card.probe ? (
          <p className="adm-note">
            Machine probe said <strong>{card.probe.status}</strong>: {card.probe.reason}
            {card.probe.firstByteMs ? ` (first byte ${card.probe.firstByteMs}ms)` : ""}.
            {card.probe.status === "live"
              ? " A card the probe called live and that is black now is a different judgement from one nothing was known about."
              : ""}
          </p>
        ) : null}

        {card.flags?.length ? (
          <ul className="adm-gates">
            {card.flags.map((f) => (
              <li key={f} className="adm-gate adm-gate-warn">
                {f}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="adm-progress">
          <div className="adm-progress-track">
            <div className="adm-progress-fill" style={{ width: `${(index / queue.length) * 100}%` }} />
          </div>
          <p className="adm-stat-note">
            {index} of {queue.length} judged · {left} left ·{" "}
            {/* Hours, not a card count. At this queue's possible scale the two differ by
                two orders of magnitude, and "70,000 remaining" reads like something a
                person could work through in an evening. */}
            <strong>{hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} hours`}</strong> of swiping left
          </p>
        </div>
      </aside>
    </div>
  );
}

/**
 * Plays one candidate and reports how long it has been CONTINUOUSLY producing frames.
 *
 * Two media paths, because the two carry frames differently:
 *
 *  - HLS goes through hls.js into a <video>, and frames are counted with
 *    requestVideoFrameCallback where the browser has it. That fires once per PRESENTED
 *    frame, which is the closest thing to the fact we want to record. Where it is
 *    missing, currentTime advancing is the fallback — weaker, because a stalled decoder
 *    can still advance currentTime briefly, hence the stall reset.
 *
 *  - MJPEG goes into an <img> and is sampled onto a small canvas, comparing successive
 *    frames pixel-wise. This only works because the stream comes through our own review
 *    proxy and is therefore SAME-ORIGIN: a cross-origin image taints the canvas and
 *    getImageData throws. Counting bytes instead would count a re-sent identical frame
 *    as motion, which is exactly the stall this is meant to catch.
 */
function StreamStage({ camera, onProducing }: { camera: QueueCamera; onProducing: (ms: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const src = `/api/admin/live-stream?u=${encodeURIComponent(camera.streamUrl)}`;
  const isMjpeg = camera.kind === "mjpeg";

  // The producing clock. Kept in a ref so the frame callbacks never re-subscribe.
  const clock = useRef({ accumulated: 0, lastFrameAt: 0 });

  const tick = useCallback(() => {
    const now = performance.now();
    const { lastFrameAt } = clock.current;
    if (lastFrameAt === 0 || now - lastFrameAt > STALL_MS) {
      // A stall means the evidence starts over. Accumulating across it would let a
      // stream that produces one frame every three seconds reach the threshold.
      clock.current.accumulated = 0;
    } else {
      clock.current.accumulated += now - lastFrameAt;
    }
    clock.current.lastFrameAt = now;
    onProducing(clock.current.accumulated);
  }, [onProducing]);

  useEffect(() => {
    if (isMjpeg) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    let rvfcHandle = 0;

    const useRvfc = typeof (video as unknown as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";
    let interval: ReturnType<typeof setInterval> | null = null;
    let lastTime = -1;

    const startCounting = () => {
      if (useRvfc) {
        const loop = () => {
          tick();
          rvfcHandle = (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number })
            .requestVideoFrameCallback(loop);
        };
        rvfcHandle = (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number })
          .requestVideoFrameCallback(loop);
      } else {
        interval = setInterval(() => {
          if (video.currentTime !== lastTime) {
            lastTime = video.currentTime;
            tick();
          }
        }, 200);
      }
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      startCounting();
    } else {
      void (async () => {
        const Hls = (await import("hls.js")).default;
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setFailed("hls.js is not supported in this browser");
          return;
        }
        // Retries are BOUNDED, deliberately and low. hls.js defaults retry a failing
        // playlist for a very long time, and a deck sitting on one dead card would go
        // on asking a real operator for it until someone noticed. Two attempts is
        // enough to survive a dropped packet and not enough to be a nuisance.
        const instance = new Hls({
          enableWorker: true,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 2,
          manifestLoadingRetryDelay: 1_000,
          levelLoadingRetryDelay: 1_000,
          fragLoadingRetryDelay: 1_000,
        });
        hls = instance;
        instance.loadSource(src);
        instance.attachMedia(video);
        let nonFatal = 0;
        instance.on(Hls.Events.ERROR, (_e, data) => {
          // A stream erroring steadily without ever going fatal is the shape that
          // produced 1,644 requests in one sitting. Budget it and stop.
          if (!data.fatal && ++nonFatal > 8) {
            setFailed(`gave up after ${nonFatal} upstream errors (${data.details})`);
            instance.destroy();
            hls = null;
            return;
          }
          if (data.fatal) {
            // Said out loud rather than left as a black rectangle. "Refused" and
            // "dead" are different verdicts and the reviewer is the one recording it.
            setFailed(`${data.type}: ${data.details}`);
            instance.destroy();
            hls = null;
          }
        });
        startCounting();
      })();
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (rvfcHandle && "cancelVideoFrameCallback" in video) {
        (video as unknown as { cancelVideoFrameCallback: (h: number) => void }).cancelVideoFrameCallback(rvfcHandle);
      }
      if (hls) hls.destroy();
    };
  }, [src, isMjpeg, tick]);

  useEffect(() => {
    if (!isMjpeg) return;
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let previous: Uint8ClampedArray | null = null;

    const id = setInterval(() => {
      if (!img.naturalWidth) return;
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        if (previous && !identical(previous, data)) tick();
        previous = new Uint8ClampedArray(data);
      } catch {
        // Same-origin is what makes this legal; if it ever throws, say so rather than
        // silently reporting a stream as never producing.
        setFailed("cannot sample this stream (canvas is tainted)");
        clearInterval(id);
      }
    }, 200);
    return () => clearInterval(id);
  }, [isMjpeg, tick]);

  return (
    <div className="adm-frame lv-stage">
      {isMjpeg ? (
        <img ref={imgRef} src={src} alt={camera.name} className="lv-media" />
      ) : (
        <video ref={videoRef} className="lv-media" autoPlay muted playsInline />
      )}
      {failed ? <p className="adm-frame-msg">{failed}</p> : null}
    </div>
  );
}

function identical(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) return false;
  return true;
}
