"use client";
// Camera slot focus view — the day-history strip lives HERE, not on the rotating
// wall tile (spec §9): the wall's job is a glance, this is where a user comes back
// to look at what it saw. A YouTube ref gets an honest "no history" state instead
// of a real but embarrassingly empty strip — an embed is opaque, there is no still
// frame to have captured.
//
// Recording keeps running while this view is open (useHistoryRecorder below), as a
// second source alongside whatever the wall tile itself does — dedupe is by frame
// fingerprint (ETag / Content-Length), not by which caller ran first, so having
// both mounted never double-writes.
import { useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import { CameraImage } from "@/components/CameraImage";
import { useCameras } from "@/lib/cameras/useCameras";
import { useWebcamTitles } from "@/lib/webcams/titles";
import {
  sanitizeCamslotConfig,
  streamKey,
  embedUrl,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";
import {
  useHistoryRecorder,
  useHistoryStatus,
  useDayStrip,
  getFrameNear,
  type StripBucket,
} from "@/lib/cameras/history";

const WEBCAM_REFRESH_SECONDS = 600;
const FALLBACK_REFRESH_SECONDS = 300;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The webcam analogue of CameraImage — /api/webcam-image re-resolves Windy's
 *  short-lived token server-side, so the client only ever holds an id. */
function WebcamStill({ id, alt }: { id: string; alt: string }) {
  const [failed, setFailed] = useState(false);
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

function DayStrip({
  buckets,
  selectedTs,
  onScrub,
}: {
  buckets: StripBucket[];
  selectedTs: number | null;
  onScrub: (ts: number | null) => void;
}) {
  const filled = buckets.filter((b) => b.ts != null).length;
  return (
    <div className="tn-csd-strip">
      <div className="tn-csd-strip-head">
        <span>Today</span>
        <span className="tn-csd-strip-count">
          {filled} of {buckets.length} slots have a captured frame
        </span>
      </div>
      <div className="tn-csd-strip-row" role="list" aria-label="Captured frames through the day">
        {buckets.map((b, i) => (
          <button
            key={i}
            type="button"
            role="listitem"
            className={`tn-csd-bucket${b.ts == null ? " gap" : ""}${selectedTs === b.ts ? " active" : ""}`}
            disabled={b.ts == null}
            aria-label={b.ts != null ? `Frame captured at ${formatClock(b.ts)}` : "No frame captured in this window"}
            title={b.ts != null ? formatClock(b.ts) : "No frame captured in this window"}
            onClick={() => onScrub(b.ts)}
          />
        ))}
      </div>
      {selectedTs != null && (
        <button type="button" className="tn-csd-live" onClick={() => onScrub(null)}>
          ↺ Back to live
        </button>
      )}
    </div>
  );
}

export default function CamslotDetail({ config }: WidgetDetailProps) {
  // Never cast: this arrives from a ?c= share link exactly like the wall widget's
  // own config does, so it gets the same validation.
  const cfg = useMemo(() => sanitizeCamslotConfig(config), [config]);
  const streams = cfg.streams;

  const { cameras } = useCameras();
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);
  const webcamTitles = useWebcamTitles();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected: StreamRef | undefined = streams.find((s) => streamKey(s) === selectedKey) ?? streams[0];

  const labelFor = (s: StreamRef): string => {
    if (s.k === "yt") return "YouTube stream";
    if (s.k === "webcam") return webcamTitles?.get(s.id) ?? `Webcam ${s.id.replace(/^windy:/, "")}`;
    return byId.get(s.id)?.name ?? s.id;
  };
  const refreshFor = (s: StreamRef): number => {
    if (s.k === "webcam") return WEBCAM_REFRESH_SECONDS;
    if (s.k === "cam") return byId.get(s.id)?.refreshSeconds ?? FALLBACK_REFRESH_SECONDS;
    return FALLBACK_REFRESH_SECONDS;
  };

  useHistoryRecorder(selected, selected ? refreshFor(selected) : FALLBACK_REFRESH_SECONDS, true);
  const buckets = useDayStrip(selected, WINDOW_MS);
  const status = useHistoryStatus();

  const [scrubTs, setScrubTs] = useState<number | null>(null);
  const [scrubUrl, setScrubUrl] = useState<string | null>(null);

  const onScrub = (ts: number | null) => {
    if (scrubUrl) URL.revokeObjectURL(scrubUrl);
    setScrubUrl(null);
    setScrubTs(ts);
    if (ts == null || !selected) return;
    getFrameNear(streamKey(selected), ts).then((f) => {
      if (f) setScrubUrl(f.url);
    });
  };

  const selectStream = (s: StreamRef) => {
    if (scrubUrl) URL.revokeObjectURL(scrubUrl);
    setScrubUrl(null);
    setScrubTs(null);
    setSelectedKey(streamKey(s));
  };

  if (streams.length === 0) {
    return (
      <div className="tn-csd">
        <p className="tn-w-empty">This slot has no cameras yet. Add one from the wall tile first.</p>
      </div>
    );
  }

  return (
    <div className="tn-csd">
      {streams.length > 1 && (
        <div className="tn-csd-tabs" role="tablist" aria-label="Streams in this slot">
          {streams.map((s) => {
            const isSelected = !!selected && streamKey(selected) === streamKey(s);
            return (
              <button
                key={streamKey(s)}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={isSelected ? "active" : ""}
                onClick={() => selectStream(s)}
              >
                {labelFor(s)}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <>
          <div className="tn-csd-stage">
            {scrubUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={scrubUrl} alt={`${labelFor(selected)}, captured earlier`} />
            ) : selected.k === "yt" ? (
              <iframe
                className="tn-cs-frame"
                src={embedUrl(selected.videoId)}
                title={labelFor(selected)}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : selected.k === "webcam" ? (
              <WebcamStill id={selected.id} alt={labelFor(selected)} />
            ) : (
              <CameraImage
                id={selected.id}
                alt={labelFor(selected)}
                attribution=""
                license=""
                refreshSeconds={refreshFor(selected)}
              />
            )}
          </div>

          <div className="tn-csd-name">
            {labelFor(selected)}
            {scrubTs != null && <span className="tn-csd-scrub-label">, captured {formatClock(scrubTs)}</span>}
          </div>

          {selected.k === "yt" ? (
            <p className="tn-w-empty">
              No history for a YouTube stream. The embed is opaque, so there is no frame to capture.
            </p>
          ) : (
            <>
              {status.pausedFull && (
                <p className="tn-csd-full">
                  History storage is full, so older frames are being dropped to make room for new ones.
                  Nothing is lost from the live view, only from what can be scrubbed back to.
                </p>
              )}
              <DayStrip buckets={buckets} selectedTs={scrubTs} onScrub={onScrub} />
              <p className="tn-csd-caveat">
                Only covers time this board was open on screen. A backgrounded or closed tab
                captures nothing.
                {streams.length > 1 &&
                  ` With ${streams.length} streams sharing this slot's rotation, each one is only on
                  screen part of the time, so gaps here are normal, not a fault.`}{" "}
                Frames stay on this device and are never sent anywhere.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
