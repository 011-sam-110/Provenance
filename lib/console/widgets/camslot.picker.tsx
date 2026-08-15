"use client";
// Search-and-add for a camera slot.
//
// TWO POOLS, DELIBERATELY IN THIS ORDER.
//   1. What the console already holds — the road-camera list (a shared, ref-counted
//      poller) and the cached webcam layer. Instant, no upstream call.
//   2. Windy, live, for the place you typed. The cached layer is an unranked ~2%
//      sample built from 14 fixed region boxes; measured 2026-08-15 it holds 0
//      webcams for Madrid, Paris, Barcelona and Amsterdam, while Windy's own answer
//      for the Madrid box is 528. Without step 2 this search tells a user there are
//      no cameras in cities full of them.
//
// The live step costs a geocode plus a Windy call, so it only runs when the user
// stops typing, and never on open.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCameras } from "@/lib/cameras/useCameras";
import { useWebcamDirectory } from "@/lib/webcams/titles";
import {
  parseYouTubeVideoId,
  streamKey,
  MAX_STREAMS,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";

const MAX_RESULTS = 60;
const DEBOUNCE_MS = 450;

/** Windy's own category names that mean "somewhere people walk". Matched
 *  case-insensitively against the `categories` array /api/webcam-search now emits —
 *  which is a far better filter than matching words in a title. */
const PLACE_CATEGORIES = new Set(["square", "city", "harbor", "park"]);

interface LiveHit {
  id: string;
  title: string;
  country?: string;
  region?: string;
  city?: string;
  categories?: string[];
}

interface Row {
  ref: StreamRef;
  label: string;
  sub: string;
  live?: boolean;
  categories?: string[];
}

export default function CamslotPicker({
  instanceId,
  streams,
  onClose,
}: {
  instanceId: string;
  streams: StreamRef[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [placesOnly, setPlacesOnly] = useState(false);
  const [live, setLive] = useState<{ hits: LiveHit[]; total: number; place: string; note: string | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const { cameras } = useCameras();
  // Shared with the slot captions, so the ~76 KB directory is fetched once for the
  // session rather than once per widget on screen.
  const webcams = useWebcamDirectory();
  const seq = useRef(0);

  const chosen = useMemo(() => new Set(streams.map(streamKey)), [streams]);
  const needle = q.trim().toLowerCase();

  // --- Live search: geocode the query, then ask Windy for that box ------------
  useEffect(() => {
    if (needle.length < 3) {
      setLive(null);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const g = await fetch(`/api/geocode?q=${encodeURIComponent(needle)}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const place = g?.results?.[0];
        if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
          if (mine === seq.current) {
            setLive(null);
            setSearching(false);
          }
          return;
        }
        const r = await fetch(`/api/webcam-search?lat=${place.lat}&lon=${place.lon}`, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
        if (mine !== seq.current) return;
        setLive(
          r
            ? {
                hits: Array.isArray(r.webcams) ? r.webcams : [],
                total: typeof r.total === "number" ? r.total : 0,
                place: place.name ?? needle,
                note: r.note ?? null,
              }
            : null,
        );
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [needle]);

  const matchesFilter = (cats: string[] | undefined) =>
    !placesOnly || (cats ?? []).some((c) => PLACE_CATEGORIES.has(c.toLowerCase()));

  const results = useMemo(() => {
    if (needle.length < 2) return [] as Row[];
    const out: Row[] = [];
    const seen = new Set<string>();

    const push = (row: Row) => {
      const key = streamKey(row.ref);
      if (seen.has(key) || out.length >= MAX_RESULTS) return;
      seen.add(key);
      out.push(row);
    };

    // Live hits first — they are the answer to what the user actually typed.
    for (const w of live?.hits ?? []) {
      if (!matchesFilter(w.categories)) continue;
      push({
        // Carry the title with the ref: this webcam came from the live bbox search
        // and is probably not in the cached directory, so without it the slot would
        // caption itself "Webcam 1606332744" the moment the page reloads.
        ref: { k: "webcam", id: w.id, t: w.title },
        label: w.title,
        sub: [w.city ?? w.region, w.country].filter(Boolean).join(" · ") || "webcam",
        live: true,
        categories: w.categories,
      });
    }
    for (const w of webcams) {
      if (!w.title?.toLowerCase().includes(needle)) continue;
      if (placesOnly) continue; // the cached layer carries no categories for older entries
      push({
        ref: { k: "webcam", id: w.id, t: w.title },
        label: w.title,
        sub: [w.country, w.region].filter(Boolean).join(" · ") || "webcam",
      });
    }
    if (!placesOnly) {
      for (const c of cameras) {
        if (!c.name.toLowerCase().includes(needle)) continue;
        push({
          ref: { k: "cam", id: c.id },
          label: c.name,
          sub: `${c.country} · new frame every ${c.refreshSeconds}s`,
        });
      }
    }
    return out;
  }, [needle, webcams, cameras, live, placesOnly]);

  const commit = (next: StreamRef[]) => {
    import("@/lib/console/store").then((m) =>
      m.shellLayoutStore.configure(instanceId, { streams: next.slice(0, MAX_STREAMS) }),
    );
  };

  const add = (ref: StreamRef) => {
    if (chosen.has(streamKey(ref)) || streams.length >= MAX_STREAMS) return;
    commit([...streams, ref]);
  };

  const addAllShown = () => {
    const room = MAX_STREAMS - streams.length;
    if (room <= 0) return;
    const next = [...streams];
    for (const r of results) {
      if (next.length >= MAX_STREAMS) break;
      if (chosen.has(streamKey(r.ref))) continue;
      next.push(r.ref);
    }
    commit(next);
  };

  const remove = (key: string) => commit(streams.filter((s) => streamKey(s) !== key));

  // Chips name the place, not the internal key. Falling back to the id is ugly but
  // true — inventing a place name would not be.
  const labelFor = (s: StreamRef): string => {
    if (s.k === "yt") return "YouTube stream";
    if (s.k === "webcam") {
      return (
        webcams.find((w) => w.id === s.id)?.title ??
        live?.hits.find((h) => h.id === s.id)?.title ??
        s.t ??
        s.id.replace(/^windy:/, "Webcam ")
      );
    }
    return cameras.find((c) => c.id === s.id)?.name ?? s.id;
  };

  const addPasted = () => {
    const id = parseYouTubeVideoId(paste);
    if (!id) {
      setPasteError("That is not a YouTube video link. Channel links are not supported yet.");
      return;
    }
    setPasteError(null);
    setPaste("");
    add({ k: "yt", videoId: id });
  };

  const full = streams.length >= MAX_STREAMS;

  return (
    <div className="tn-cs-picker" role="dialog" aria-label="Add cameras to this slot">
      <div className="tn-cs-picker-head">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search a place — Madrid, Trafalgar Square, Shibuya…"
          aria-label="Search cameras and webcams"
        />
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="tn-cs-picker-meta">
        <button
          className={placesOnly ? "tn-cs-chip is-on" : "tn-cs-chip"}
          aria-pressed={placesOnly}
          onClick={() => setPlacesOnly((v) => !v)}
          title="Windy's own categories: squares, city views, harbours and parks"
        >
          Squares &amp; public spaces
        </button>
        {searching && <span className="tn-cs-picker-label">searching {q.trim()}…</span>}
        {!searching && live && (
          <span className="tn-cs-picker-label">
            {live.total > live.hits.length
              ? `${live.hits.length} of ${live.total} near ${live.place}`
              : `${live.hits.length} near ${live.place}`}
          </span>
        )}
        {results.length > 0 && !full && (
          <button className="tn-cs-chip" onClick={addAllShown}>
            ＋ Add all {Math.min(results.length, MAX_STREAMS - streams.length)}
          </button>
        )}
      </div>

      <div className="tn-cs-picker-list">
        {needle.length >= 2 && !searching && results.length === 0 && (
          <p className="tn-w-empty">
            {live?.note
              ? live.note
              : live
                ? `Windy has no webcams near ${live.place}.`
                : `Nothing matching “${q.trim()}”. Try a city or a landmark — the live search needs a place it can find on a map.`}
          </p>
        )}
        {results.map((r) => {
          const key = streamKey(r.ref);
          const already = chosen.has(key);
          return (
            <button
              key={key}
              className="tn-cs-hit"
              disabled={already || full}
              onClick={() => add(r.ref)}
            >
              <span className="tn-cs-hit-name">{r.label}</span>
              <span className="tn-cs-hit-sub">
                {already ? "already in this slot" : r.sub}
                {r.live && !already && " · live"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="tn-cs-picker-paste">
        <input
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            setPasteError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addPasted();
            if (e.key === "Escape") onClose();
          }}
          placeholder="…or paste a YouTube video link"
          aria-label="Paste a YouTube video link"
        />
        <button onClick={addPasted} disabled={full}>
          Add
        </button>
      </div>
      {pasteError && <p className="tn-cs-picker-err">{pasteError}</p>}

      {streams.length > 0 && (
        <div className="tn-cs-picker-chosen">
          <span className="tn-cs-picker-label">
            In this slot — {streams.length}/{MAX_STREAMS}
          </span>
          {streams.map((s) => (
            <button
              key={streamKey(s)}
              onClick={() => remove(streamKey(s))}
              aria-label={`Remove ${labelFor(s)}`}
              title={labelFor(s)}
            >
              {labelFor(s)} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
