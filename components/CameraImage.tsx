"use client";
import { useEffect, useState } from "react";
import { AttributionBadge } from "@/components/AttributionBadge";
import { frameBucket } from "@/lib/cameras/freshness";
import { pictureOutcome, readPicture } from "@/lib/console/widgets/camslot.picture";
import type { StreamOutcome } from "@/lib/console/widgets/camslot.health";

export function CameraImage(props: {
  id: string; alt: string; attribution: string; license: string; refreshSeconds: number;
  /** Optional: told how each frame went, so a caller that rotates through many
   *  cameras can stop re-fetching one that has stopped answering. Optional because
   *  /camera/[id] and the existing camera wall neither need nor want the bookkeeping.
   *
   *  A frame that LOADED is also looked at (camslot.picture.ts): an operator's
   *  "unavailable" card or a black frame is reported as what it is rather than as a
   *  success, because it is a 200 the fetch alone cannot tell from a picture. Only a
   *  caller that asked for outcomes pays for the look. */
  onOutcome?: (outcome: StreamOutcome) => void;
}) {
  const { id, alt, attribution, license, refreshSeconds, onOutcome } = props;
  // The buster is derived from the CLOCK, not from how long this component has been
  // mounted (see frameBucket). The interval below only exists to re-render when the
  // window rolls over — it is not what produces the value, which is why a tile that
  // unmounts and comes back does not reset to a stale frame.
  const [bucket, setBucket] = useState(() => frameBucket(Date.now(), refreshSeconds));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setBucket(frameBucket(Date.now(), refreshSeconds));
    const t = setInterval(
      () => setBucket(frameBucket(Date.now(), refreshSeconds)),
      Math.max(1, refreshSeconds) * 1000,
    );
    return () => clearInterval(t);
  }, [refreshSeconds, id]);

  // A de-registered id 404s, and a bare <img> renders the browser's broken-image
  // glyph for it. The existing "Feed offline" placeholder keys off `camera.available`,
  // which an id that has left the registry never has — it is simply absent from
  // /api/cameras — so this is the only place that particular failure can be caught.
  if (failed) {
    return (
      <figure style={{ margin: 0 }} className="tn-cam-dead">
        <span>This camera is not answering.</span>
      </figure>
    );
  }

  return (
    <figure style={{ margin: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/proxy?id=${encodeURIComponent(id)}&_=${bucket}`}
        alt={alt}
        onLoad={(e) => onOutcome?.(pictureOutcome(readPicture(e.currentTarget)))}
        onError={() => {
          setFailed(true);
          onOutcome?.(false);
        }}
      />
      <figcaption><AttributionBadge attribution={attribution} license={license} /></figcaption>
    </figure>
  );
}
