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
import { useWebcamTitles, useWebcamDirectory } from "@/lib/webcams/titles";
import { useWebcamPlaces, webcamPlaceState } from "@/lib/webcams/places";
import { useNow } from "@/lib/shell/useNow";
import { usePointWeather } from "@/lib/console/widgets/camslot.conditions.store";
import { coordKey, type Coord } from "@/lib/weather/pointWeather";
import { provenanceReport } from "@/lib/console/widgets/camslot.provenance";
import {
  formatLocalClock,
  zoneOffsetLabel,
  type PlaceKind,
} from "@/lib/console/widgets/camslot.conditions";
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

/**
 * Where this tile's conditions claim comes from.
 *
 * THE OVERLAY CANNOT BE THIS AND SHOULD NOT TRY. It has room for three short strings
 * and a hover title; this has room for the station, the distance, both timestamps and
 * — the case the panel really exists for — the reading the tile REFUSED.
 *
 * Refusing to assert a disqualified reading is not the same as concealing that one
 * exists. Without this panel a user cannot tell "nobody measures this road" apart from
 * "somebody measures it and we did not accept their number", and those are very
 * different facts about the world. See camslot.provenance.ts for the rule.
 *
 * Every string rendered here was decided by a pure, node-tested function. This
 * component adds no wording of its own beyond the two sentences that explain whose
 * threshold refused a reading, which are here rather than in the pure layer because
 * they are about US, not about the data.
 */
function ConditionsPanel({ stream, refreshSeconds }: { stream: StreamRef; refreshSeconds: number }) {
  // Same 30s cadence as the wall overlay's clock: fine enough that a displayed minute
  // is never stale for a whole minute, coarse enough to cost nothing.
  const now = useNow(30_000);

  const { cameras, status: camerasStatus } = useCameras();
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);
  const directory = useWebcamDirectory();

  const dirRow = useMemo(
    () => (stream.k === "webcam" ? directory.find((w) => w.id === stream.id) : undefined),
    [directory, stream],
  );
  // Only ask /api/webcam-place for an id the cached ~2% directory genuinely lacks.
  const missingIds = useMemo(
    () =>
      stream.k === "webcam" && !(Number.isFinite(dirRow?.lat) && Number.isFinite(dirRow?.lon))
        ? [stream.id]
        : [],
    [stream, dirRow],
  );
  const places = useWebcamPlaces(missingIds);

  const place = useMemo((): { kind: PlaceKind | null; coord: Coord | null; pending: boolean } => {
    // A YouTube embed is a video, not a place. Null kind, and the claim says so.
    if (stream.k === "yt") return { kind: null, coord: null, pending: false };
    if (stream.k === "cam") {
      const row = byId.get(stream.id);
      const coord = row ? { lat: row.lat, lon: row.lon } : null;
      // Pending only while the poller's first load is genuinely outstanding. An id the
      // registry has finished loading and still does not know is a real absence.
      return { kind: "camera", coord, pending: !coord && camerasStatus === "loading" };
    }
    const s = webcamPlaceState(dirRow?.lat, dirRow?.lon, places, stream.id);
    return { kind: "webcam", coord: s.coord, pending: s.pending };
  }, [stream, byId, camerasStatus, dirRow, places]);

  const coords = useMemo(() => (place.coord ? [place.coord] : []), [place.coord]);
  const { data: weatherByCoord, failed: weatherFailed } = usePointWeather(coords);
  const weather = place.coord
    ? weatherByCoord.get(coordKey(place.coord.lat, place.coord.lon))
    : undefined;

  const row = stream.k === "cam" ? byId.get(stream.id) : undefined;
  const report = provenanceReport({
    kind: place.kind,
    surface: row?.surface,
    weather,
    pending: place.pending,
    weatherFailed,
    lastSampledAt: row?.lastSampledAt,
    refreshSeconds,
    now,
  });

  const clock = weather ? formatLocalClock(weather.timeZone, now) : "";
  const offset = weather ? zoneOffsetLabel(weather.timeZone, now, weather.utcOffsetSeconds) : "";

  return (
    <section className="tn-csd-prov" aria-label="Where this tile's conditions claim comes from">
      <div className="tn-csd-prov-head">
        <span className="tn-csd-prov-claim" data-tier={report.claim.tier}>
          {report.claim.label && <b>{report.claim.label}</b>}
          {report.claim.text}
        </span>
        {clock && (
          <span className="tn-csd-prov-clock">
            {clock} <span>{offset}</span>
          </span>
        )}
      </div>

      <p className="tn-csd-prov-basis">{report.claim.title}</p>

      {report.refused && (
        <div className="tn-csd-prov-refused">
          <p>
            <b>Measured, and not shown.</b> The nearest road-weather station reports{" "}
            <b>{report.refused.state}</b>. We are not presenting that as the road in this
            picture, because it fails {report.refused.rule}.
          </p>
          <p>{report.refused.reason}</p>
          <p className="tn-csd-prov-owner">
            {report.refused.ruleOwner === "ours"
              ? "That threshold is ours, not the operator's. The figures below are the ones we applied, so you can weigh the reading yourself and disagree with us."
              : "That is the operator's own verdict on its own reading. We pass it through rather than second-guessing it."}
          </p>
        </div>
      )}

      {report.rows.length > 0 && (
        <dl className="tn-csd-prov-rows">
          {report.rows.map((r) => (
            <div key={r.term}>
              <dt>{r.term}</dt>
              <dd>
                <span>{r.value}</span>
                {r.note && <span className="tn-csd-prov-note">{r.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {report.credits.length > 0 && (
        <p className="tn-csd-prov-credit">{report.credits.join(" · ")}</p>
      )}
    </section>
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

          {/* Keyed on the stream so switching tabs remounts rather than carrying one
              stream's resolved place into another's panel for a frame. */}
          <ConditionsPanel
            key={streamKey(selected)}
            stream={selected}
            refreshSeconds={refreshFor(selected)}
          />

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
