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
import { useWebcamTitles, useWebcamDirectory } from "@/lib/webcams/titles";
import { useWebcamPlaces } from "@/lib/webcams/places";
import { camslotPrefs } from "@/lib/console/widgets/camslot.prefs";
import CamslotPicker from "@/lib/console/widgets/camslot.picker";
import CamslotDetail from "@/lib/console/widgets/camslot.detail";
import { useHistoryRecorder } from "@/lib/cameras/history";
import { streamHealth, useStreamHealth, liveStreams, benchedNote } from "@/lib/console/widgets/camslot.health";
import { pickStore } from "@/lib/console/widgets/camslot.pick";
import { shellLayoutStore } from "@/lib/console/store";
import {
  sanitizeCamslotConfig,
  nextIndex,
  streamKey,
  embedUrl,
  conditionsOn,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";
import {
  roadClaim,
  weatherChip,
  formatLocalClock,
  zoneOffsetLabel,
  overlayDensity,
  type PlaceKind,
  type Density,
} from "@/lib/console/widgets/camslot.conditions";
import { CamslotConditions } from "@/lib/console/widgets/camslot.overlay";
import { usePointWeather } from "@/lib/console/widgets/camslot.conditions.store";
import { coordKey, type Coord } from "@/lib/weather/pointWeather";

/**
 * A coordinate pair, or null if either half is missing or not a real number.
 *
 * Number.isFinite() is not a type guard, so it cannot narrow the optional lat/lon on
 * a webcam directory row — hence the explicit typeof. Worth a named function rather
 * than an inline ternary because "we do not know where this is" is the input that
 * makes the conditions overlay say "no data" instead of guessing, and guessing a
 * position (map centre, country centroid) is banned outright for this feature.
 */
function finiteCoord(lat: number | undefined, lon: number | undefined): Coord | null {
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** Windy's image tokens last ~10 minutes and /api/webcam-image is bounded by that. */
const WEBCAM_REFRESH_SECONDS = 600;
/** Used only until the real row arrives. The slowest real cadence, so we never ask
 *  for a frame faster than any operator actually publishes one. */
const FALLBACK_REFRESH_SECONDS = 300;

/** A clock that ticks once a minute. The bench has a five-minute retry window, so
 *  re-evaluating it every second would re-render every slot on the board sixty times
 *  more often than the answer can change. */
function useNowCoarse(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The conditions overlay's clock ticks every 30s — fine-grained enough that "14:32"
 *  never sits stale for a whole minute, coarse enough that it costs nothing next to
 *  the once-a-minute bench clock above. One interval in the parent, not one per
 *  mounted overlay — see camslot.overlay.tsx's header note on why `now` is a prop. */
function useNow30s(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useCamslotPaused(): boolean {
  return useSyncExternalStore(
    camslotPrefs.subscribe,
    () => camslotPrefs.get().paused,
    () => false,
  );
}

/** The webcam analogue of CameraImage. /api/webcam-image re-resolves Windy's
 *  short-lived token server-side, so the client only ever holds an id. */
function WebcamImage({ id, alt, onOutcome }: { id: string; alt: string; onOutcome: (ok: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  if (failed) return <div className="tn-cs-dead">This webcam is not answering.</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/webcam-image?id=${encodeURIComponent(id)}`}
      alt={alt}
      onLoad={() => onOutcome(true)}
      onError={() => {
        setFailed(true);
        onOutcome(false);
      }}
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

  // Record the day strip from the WALL, not only from the focus view. Called before
  // any early return, because hooks cannot be conditional. Without this the history
  // only covers however long someone happened to keep a slot focused, which is not
  // "throughout the day" by any reading. It is safe to call from several mounted
  // places at once: the recorder dedupes on ETag/Content-Length, so a second caller
  // for the same stream confirms the cache rather than writing twice.
  // `!hidden` means the prefetched-but-invisible view does not record — a frame
  // nobody has seen is not part of their day.
  useHistoryRecorder(stream, refreshSeconds, !hidden);

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
        <WebcamImage
          id={stream.id}
          alt={label}
          onOutcome={(ok) => streamHealth.report(stream, ok)}
        />
      ) : (
        <CameraImage
          id={stream.id}
          alt={label}
          attribution=""
          license=""
          refreshSeconds={refreshSeconds}
          onOutcome={(ok) => streamHealth.report(stream, ok)}
        />
      )}
    </div>
  );
}

function CamslotBody({ instanceId, config }: WidgetBodyProps) {
  // Config is untrusted even here: it arrives from ?c= links and from live
  // configure() calls, so it is re-validated rather than cast.
  const cfg = useMemo(() => sanitizeCamslotConfig(config), [config]);
  const all = cfg.streams;
  const paused = useCamslotPaused();

  // A stream that has failed twice is BENCHED: taken out of rotation and not
  // fetched again for five minutes. Without this a dead id is re-requested on every
  // rotation pass — QA measured ~19 hits on one 404 in under two minutes, against
  // free public feeds we have no contract with. `health` is an observation about
  // now, deliberately not persisted and not in config.
  const health = useStreamHealth();
  const benchTick = useNowCoarse();
  const streams = useMemo(() => liveStreams(all, health, benchTick), [all, health, benchTick]);
  const unavailable = useMemo(() => benchedNote(all, health, benchTick), [all, health, benchTick]);

  const [i, setI] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [visible, setVisible] = useState(true);
  const [picking, setPicking] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Two routes out of an empty slot, and they are deliberately different things.
  // The PICKER is a dialog owned by this slot: search a place, paste a YouTube
  // link, add or remove streams here. MAP PICKING is not owned by this slot at all
  // — it turns the map into a selection surface and the cameras collect in a shared
  // basket, which is what lets the user choose the destination at send time rather
  // than committing to one before they have found anything.
  const openPicker = useCallback(() => setPicking(true), []);
  const pickOnMap = useCallback(() => pickStore.setMode("picking"), []);

  // Names and cadences come from the shared camera poller — ref-counted, so several
  // slots share one 60s poll instead of each starting their own.
  const { cameras, status: camerasStatus } = useCameras();
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);
  // A slot restored from a ?c= link carries ids and nothing else, so titles have to
  // be resolved separately or every caption reads "Webcam 1229966910".
  const webcamTitles = useWebcamTitles();
  // The conditions overlay also needs COORDINATES, which titles.ts's title map does
  // not carry (see useWebcamTitles' own comment on why it dropped them). The full
  // directory rows do — reuse the same shared fetch (both hooks read one module
  // store, see lib/webcams/titles.ts), just for `lat`/`lon` this time.
  const webcamDirectory = useWebcamDirectory();
  const webcamDirById = useMemo(() => new Map(webcamDirectory.map((w) => [w.id, w])), [webcamDirectory]);

  // Webcams missing from the directory sample (the real case: windy:1606332744,
  // Madrid, on the default Streets board) get resolved one id at a time through
  // /api/webcam-place. Only ask for ids the directory genuinely lacks a position
  // for — never re-resolve one the directory already answered.
  const missingWebcamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of streams) {
      if (s.k !== "webcam") continue;
      const row = webcamDirById.get(s.id);
      if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) ids.add(s.id);
    }
    return Array.from(ids);
  }, [streams, webcamDirById]);
  const webcamPlaces = useWebcamPlaces(missingWebcamIds);

  // Where each stream IS, for the conditions overlay. `cam` rows carry lat/lon
  // directly; `webcam` rows come from the directory first, the per-id resolver on a
  // miss; `yt` streams have no place at all — kind: null, which is what makes
  // roadClaim() say "no data" rather than inventing a map-centre or country
  // centroid, both of which are banned outright for this feature.
  const placeStateFor = useCallback(
    (s: StreamRef): { kind: PlaceKind | null; coord: Coord | null; pending: boolean } => {
      if (s.k === "yt") return { kind: null, coord: null, pending: false };
      if (s.k === "cam") {
        const row = byId.get(s.id);
        const coord = finiteCoord(row?.lat, row?.lon);
        // "pending" only while we genuinely do not know yet — the camera poller's
        // first load hasn't resolved. Once it has and the id still has no row (a
        // deregistered camera, say), that is a real absence, not a pending state.
        return { kind: "camera", coord, pending: !coord && camerasStatus === "loading" };
      }
      const dirRow = webcamDirById.get(s.id);
      const dirCoord = finiteCoord(dirRow?.lat, dirRow?.lon);
      if (dirCoord) return { kind: "webcam", coord: dirCoord, pending: false };
      const resolved = webcamPlaces.get(s.id);
      if (resolved) return { kind: "webcam", coord: resolved, pending: false };
      // webcamTitles is null until the shared directory's first load resolves —
      // reused here as the "do we genuinely not know yet" signal.
      return { kind: "webcam", coord: null, pending: webcamTitles === null };
    },
    [byId, camerasStatus, webcamDirById, webcamPlaces, webcamTitles],
  );

  // Every coordinate in the PLAYLIST, not only the current stream — so rotating
  // between streams is a pure map lookup with no request and no flash. See
  // camslot.conditions.store.ts's file header for why this is one board-wide store.
  const conditionCoords = useMemo(
    () => streams.map((s) => placeStateFor(s).coord).filter((c): c is Coord => c !== null),
    [streams, placeStateFor],
  );
  const { data: weatherByCoord, failed: weatherFailed } = usePointWeather(conditionCoords);

  const conditionsNow = useNow30s();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [density, setDensity] = useState<Density>("hidden");

  // How much overlay fits — a pure function of the stage's own box, re-measured on
  // resize. Mirrors the IntersectionObserver effect just below: same shape, same
  // cleanup discipline.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setDensity(overlayDensity(el.clientWidth, el.clientHeight));
    // Measure FIRST, then observe. The order matters: density starts at "hidden" so
    // the overlay never paints at the wrong size for a frame, which means a browser
    // without ResizeObserver would otherwise leave it hidden forever rather than
    // merely un-responsive. One measurement is the honest floor.
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      // Falling back to the id is ugly but true; inventing a place name would not be.
      // Directory first (authoritative and current), then the title we stored when
      // it was added, then the bare id. Never a made-up name.
      if (s.k === "webcam") return webcamTitles?.get(s.id) ?? s.t ?? `Webcam ${s.id.replace(/^windy:/, "")}`;
      return byId.get(s.id)?.name ?? s.id;
    },
    [byId, webcamTitles],
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
      count: all.length,
      freshLabel: streams.length > 0 ? "live views" : undefined,
    });
  }, [report, streams.length]);

  const safeIndex = i < streams.length ? i : 0;
  // Typed as possibly-absent on purpose: an empty playlist is a normal state, and
  // narrowing on `current` below is what keeps the populated branch type-safe.
  const current: StreamRef | undefined = streams[safeIndex];
  const upcoming = rotates ? streams[nextIndex(safeIndex, streams.length)] : undefined;

  // The conditions overlay's data for whichever stream is CURRENTLY on screen.
  // Rotating to a different stream is a pure lookup into `weatherByCoord` — no
  // request, no flash — because every place in the playlist was already
  // subscribed above, not just this one.
  const currentPlaceState = current ? placeStateFor(current) : null;
  const currentCoord = currentPlaceState?.coord ?? null;
  const currentWeather = currentCoord ? weatherByCoord.get(coordKey(currentCoord.lat, currentCoord.lon)) : undefined;
  const currentSurface = current?.k === "cam" ? byId.get(current.id)?.surface : undefined;
  const currentSampledAt = current?.k === "cam" ? byId.get(current.id)?.lastSampledAt : undefined;

  const claim = current
    ? roadClaim({
        kind: currentPlaceState!.kind,
        surface: currentSurface,
        weather: currentWeather,
        pending: currentPlaceState!.pending,
        weatherFailed,
        now: conditionsNow,
      })
    : null;
  const weatherChipForCurrent = weatherChip(currentWeather);
  const clockForCurrent = currentWeather ? formatLocalClock(currentWeather.timeZone, conditionsNow) : "";
  const offsetForCurrent = currentWeather
    ? zoneOffsetLabel(currentWeather.timeZone, conditionsNow, currentWeather.utcOffsetSeconds)
    : "";

  // ONE tree, both states. The picker used to be rendered inside each branch, so
  // adding the first camera moved it to a different position in the tree — React
  // unmounted and remounted it, and the user's search results and query vanished at
  // the exact moment they were using them.
  return (
    <div
      className="tn-cs"
      ref={hostRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {!current ? (
        <div className="tn-cs-empty">
          {/* Two different nothings, and conflating them would be a lie. An empty
              playlist invites a pick; a playlist whose every stream has stopped
              answering must say so, or the user reads "add a camera" and concludes
              they never added one. */}
          {all.length > 0 ? (
            <>
              <span className="tn-cs-note">{unavailable ?? "Nothing in this slot is answering."}</span>
              {/* This branch used to dead-end: one button into the picker and no way
                  back to the map at all, on the one state a user is most likely to
                  want to replace what is here. Both routes now appear. The picker's
                  label stays "change", not "add" — the slot is NOT empty, and the
                  note directly above has just said so. */}
              <button className="tn-cs-add" onClick={() => openPicker()}>
                Change what is in this slot
              </button>
              <button className="tn-cs-add" onClick={() => pickOnMap()}>
                ◎ Pick cameras on the map
              </button>
            </>
          ) : (
            <>
              <button className="tn-cs-add" onClick={() => openPicker()}>
                ＋ Add a camera
              </button>
              {/* An EMPTY slot is the one you most want to fill from the map, and the
                  header controls only render once a slot has something in it — so
                  without this the primary path ("give me a blank tile, let me drag a
                  box over Soho") had no way in. */}
              <button className="tn-cs-add" onClick={() => pickOnMap()}>
                ◎ Pick cameras on the map
              </button>
              <span>Search a place, paste a YouTube link, or collect cameras from the map</span>
            </>
          )}
        </div>
      ) : (
        <>
      <div className="tn-cs-stage" ref={stageRef} data-fit={cfg.fit ?? "cover"}>
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
        {/* Mounted directly on the stage, never inside .tn-cs-view — that class
            carries `style={{display:"none"}}` on the hidden prefetch view, and an
            overlay nested inside it would vanish with it. Keyed by streamKey so a
            rotation never shows the previous camera's numbers for a frame. */}
        {conditionsOn(cfg) && claim && (
          <CamslotConditions
            key={streamKey(current)}
            claim={claim}
            weather={weatherChipForCurrent}
            place={{ clock: clockForCurrent, offset: offsetForCurrent }}
            refreshSeconds={refreshFor(current)}
            lastSampledAt={currentSampledAt}
            density={density}
            now={conditionsNow}
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
        {/* The overlay's own on/off switch lives HERE, not in .tn-cs-ctl — that
            cluster is opacity:0 until hover (globals.css:4744-4745), and a
            provenance control (what is this tile claiming, and can I turn it off)
            must not be hover-only. .tn-cs-bar has no hover rule at all. */}
        <button
          className={conditionsOn(cfg) ? "tn-cs-chip is-on" : "tn-cs-chip"}
          aria-pressed={conditionsOn(cfg)}
          aria-label={conditionsOn(cfg) ? "Hide road, weather and time" : "Show road, weather and time"}
          onClick={() =>
            shellLayoutStore.configure(instanceId, { conditions: conditionsOn(cfg) ? "off" : undefined })
          }
        >
          ⓘ
        </button>
      </div>

      {unavailable && <p className="tn-cs-note">{unavailable}</p>}

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
        <button aria-label="Add or remove cameras" onClick={() => openPicker()}>
          ＋
        </button>
      </div>

      {/* An auto-changing region must not be announced continuously — that would
          interrupt a screen-reader user indefinitely. The position marker and the
          picker's list are the accessible route through the playlist instead. */}
      <span className="tn-cs-sr" aria-live="off">
        {labelFor(current)} — {safeIndex + 1} of {streams.length}
        {hasEmbed && streams.length > 1
          ? ". Rotation is off while a YouTube stream is in this slot"
          : ""}
        {paused && rotates ? ". Paused" : ""}
        {/* Same words the visible overlay uses — none coined here — so a
            screen-reader user gets the same three facts, through the one region
            this playlist is already allowed to announce. */}
        {conditionsOn(cfg) && claim
          ? `. ${claim.label ? `${claim.label}: ` : ""}${claim.text}${
              weatherChipForCurrent ? `, ${weatherChipForCurrent.text}` : ""
            }${clockForCurrent ? `, ${clockForCurrent} ${offsetForCurrent}`.trim() : ""}`
          : ""}
      </span>
        </>
      )}

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

/**
 * What THIS slot is called, as opposed to what this KIND of widget is called.
 *
 * WidgetFrame renders `type.title` for every instance, so the four camera walls on
 * the Streets board all carried the identical header "CAMERA WALL" while their
 * configs said London, Madrid and Prague. `CamslotConfig.name` was set by the
 * preset and rendered nowhere. That is most of why "I can't tell which widget a
 * camera would go into" was true — the destinations were literally indistinguishable.
 *
 * Registry meta calls this and falls back to `type.title` when it returns undefined,
 * so the contract is: return a name this slot has EARNED, or nothing.
 *
 *  1. `name` — what the board author or the user called it. Always wins.
 *  2. A one-stream slot with a title in its own config. "London: Trafalgar Square"
 *     is a better header than "Camera wall" and it costs nothing to read. Only
 *     `StreamRef.t` on a webcam qualifies: the directory lookup and the camera
 *     poller are React hooks, and a header is not worth a fetch.
 *  3. Otherwise undefined. A rotating slot has no single subject, and naming it
 *     after whichever stream happens to be first would be a header that changes
 *     meaning without changing text.
 *
 * Never "" — an empty string is a truthy-looking falsy value that would render as a
 * blank header instead of falling back, which is worse than the problem this fixes.
 * `config` is untrusted (it rides inside `?c=` links), so it is sanitized, not cast.
 */
export function camslotTitle(config: Record<string, unknown>): string | undefined {
  const cfg = sanitizeCamslotConfig(config);
  if (cfg.name) return cfg.name;
  if (cfg.streams.length !== 1) return undefined;
  const only = cfg.streams[0];
  if (only.k !== "webcam") return undefined;
  const t = (only.t ?? "").trim();
  return t || undefined;
}

export const CAMSLOT_WIDGET = {
  id: "camslot",
  title: "Camera wall",
  // Optional registry meta: WidgetFrame prefers titleOf(instance.config) and falls
  // back to `title`. Declared here whether or not `WidgetType` has learned the
  // property yet — CAMSLOT_WIDGET is a named const, not an inline literal, so
  // `registerWidget(CAMSLOT_WIDGET)` is a plain assignability check with no excess-
  // property check, and an extra method neither fails to compile nor gets stripped.
  // No cast is involved, so if the shared type ever declares an INCOMPATIBLE
  // `titleOf` this line goes red rather than quietly disagreeing.
  titleOf: camslotTitle,
  icon: "🎦",
  category: "Cameras",
  defaultHeight: 260,
  defaultConfig: { streams: [], intervalMs: 5000 },
  component: CamslotBody,
  // The focus view: a scrubbable strip of the frames this browser already fetched.
  // Same widget id, so it needs no new WIDGET_EXPLAINERS entry.
  detail: CamslotDetail,
  help: {
    what: "A slot you fill with live views: road cameras, city webcams, or a YouTube stream you paste. Give it one and it stays put; give it several and it cycles through them, so a handful of tiles can hold dozens of places.",
    source: "Public transport-agency camera feeds, Windy webcams, and any YouTube video you paste",
  },
};
registerWidget(CAMSLOT_WIDGET);

export default CamslotBody;
