"use client";
// In-overlay webcam body (the Windy "Webcams" layer — distinct from road CCTV).
// Rendered over the still-live globe by <FeedOverlay>. The Windy image token is
// short-lived, so the picture is pulled through the SSRF-safe /api/webcam-image
// proxy, which re-resolves a fresh URL server-side on every load. Windy's terms
// REQUIRE the "Webcams provided by Windy.com" credit plus a link back to the
// webcam's own Windy page, so both are shown beneath the image.

import { useEffect, useState } from "react";
import type { WorldObject } from "@/lib/world";
// The SAME failure policy the camera slots use, not a second one. `streamHealth` is
// keyed `webcam:<id>` via `streamKey`, so an id that fails here is already benched
// when a slot rotates onto it, and vice versa. Two strike counts for one class of
// failure is how they drift apart.
import {
  streamHealth,
  useStreamHealth,
  isBenched,
} from "@/lib/console/widgets/camslot.health";
import { streamKey } from "@/lib/console/widgets/camslot.model";

const REFRESH_SECONDS = 600; // matches the free-tier ~10 min image-token cadence

export default function WebcamDetail({ object }: { object: WorldObject }) {
  const detailUrl = (object.meta?.detailUrl as string | undefined) ?? "https://www.windy.com/webcams";
  const region = object.meta?.region as string | undefined;
  const country = object.meta?.country as string | undefined;
  const available = (object.meta?.available as boolean | undefined) ?? true;
  const place = [region, country].filter(Boolean).join(", ") || "Public webcam";

  // Cache-bust the proxied image on the token cadence so it stays current.
  //
  // THE BUSTER IS WHY THIS NEEDED A BENCH. `&_=` guarantees every refresh reaches the
  // origin rather than a cache, and this panel tracked no failures at all, so a
  // webcam whose image never resolves was re-requested every ten minutes for as long
  // as it stayed open. The access log for 2026-09-08..11 has 10,622 `404
  // /api/webcam-image` — a third of the endpoint — concentrated on a handful of ids
  // at ~400 requests each.
  //
  // The interval is torn down while benched, so a dead still costs neither a request
  // nor a timer. It is not permanent: `isBenched` frees the id again after
  // RETRY_AFTER_MS, and the next mount or re-render picks it back up, which is how a
  // webcam that comes back is noticed without a reload.
  const health = useStreamHealth();
  const benched = isBenched(health[streamKey({ k: "webcam", id: object.id })], Date.now());

  const [bust, setBust] = useState(0);
  useEffect(() => {
    if (benched) return;
    const t = setInterval(() => setBust((b) => b + 1), REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
  }, [benched]);

  return (
    <div className="cam-detail">
      <h2>{object.label}</h2>
      <p className="cam-sub">{place}</p>

      <figure style={{ margin: 0 }}>
        {benched ? (
          // Says what is true and no more: our own request for the picture failed,
          // twice. It does NOT say the webcam was removed — a 404 and a failed
          // upstream fetch are indistinguishable from an <img> error, and only one of
          // them means removed. Same wording rule as `benchedNote`.
          <div className="tn-cam-dead">This webcam is not answering.</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/webcam-image?id=${encodeURIComponent(object.id)}&_=${bust}`}
            alt={object.label}
            onError={() => streamHealth.report({ k: "webcam", id: object.id }, false)}
            onLoad={() => streamHealth.report({ k: "webcam", id: object.id }, true)}
          />
        )}
        <figcaption>
          <span className="attribution" data-testid="attribution">
            Webcams provided by{" "}
            <a href={detailUrl} target="_blank" rel="noopener noreferrer">
              Windy.com
            </a>
          </span>
        </figcaption>
      </figure>

      <div className="cam-meta">
        <span className="cam-status">
          <span className={`dot ${available ? "on" : "off"}`} aria-hidden />
          {available ? "Active" : "Inactive"}
        </span>
        <span>
          {object.lat.toFixed(4)}, {object.lon.toFixed(4)}
        </span>
        <span>Refresh {REFRESH_SECONDS}s</span>
      </div>

      <a className="cam-open" href={detailUrl} target="_blank" rel="noopener noreferrer">
        View on Windy ↗
      </a>
    </div>
  );
}
