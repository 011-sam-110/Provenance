"use client";
// Search-and-add for a camera slot.
//
// v1 searches the pools the console already holds: the road-camera list (a shared,
// ref-counted poller) and the cached webcam layer. That layer is a PARTIAL sample of
// Windy's catalogue built from fixed regional queries — measured, Madrid returns 0
// from it and 528 from Windy's own bbox endpoint — so the empty state has to say so
// rather than imply the city has no cameras. The live bbox search that fixes it
// properly is M2.
import { useMemo, useState } from "react";
import { useCameras } from "@/lib/cameras/useCameras";
import { useWebcamDirectory } from "@/lib/webcams/titles";
import {
  parseYouTubeVideoId,
  streamKey,
  MAX_STREAMS,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";

const MAX_RESULTS = 40;

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
  const { cameras } = useCameras();
  // Shared with the slot captions, so the ~76 KB directory is fetched once for the
  // session rather than once per widget on screen.
  const webcams = useWebcamDirectory();

  const chosen = useMemo(() => new Set(streams.map(streamKey)), [streams]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [] as { ref: StreamRef; label: string; sub: string }[];
    const out: { ref: StreamRef; label: string; sub: string }[] = [];

    // Webcams first: they are the city-square views this feature exists for, while
    // road cameras are mostly junctions and carriageways.
    for (const w of webcams) {
      if (out.length >= MAX_RESULTS) break;
      if (!w.title?.toLowerCase().includes(needle)) continue;
      out.push({
        ref: { k: "webcam", id: w.id },
        label: w.title,
        sub: [w.country, w.region].filter(Boolean).join(" · ") || "webcam",
      });
    }
    for (const c of cameras) {
      if (out.length >= MAX_RESULTS) break;
      if (!c.name.toLowerCase().includes(needle)) continue;
      out.push({
        ref: { k: "cam", id: c.id },
        label: c.name,
        sub: `${c.country} · new frame every ${c.refreshSeconds}s`,
      });
    }
    return out;
  }, [q, webcams, cameras]);

  const commit = (next: StreamRef[]) => {
    import("@/lib/console/store").then((m) =>
      m.shellLayoutStore.configure(instanceId, { streams: next.slice(0, MAX_STREAMS) }),
    );
  };

  const add = (ref: StreamRef) => {
    if (chosen.has(streamKey(ref)) || streams.length >= MAX_STREAMS) return;
    commit([...streams, ref]);
  };

  const remove = (key: string) => commit(streams.filter((s) => streamKey(s) !== key));

  // Chips name the place, not the internal key. Falling back to the id is ugly but
  // true — inventing a place name would not be.
  const labelFor = (s: StreamRef): string => {
    if (s.k === "yt") return "YouTube stream";
    if (s.k === "webcam") {
      return webcams.find((w) => w.id === s.id)?.title ?? s.id.replace(/^windy:/, "Webcam ");
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
          placeholder="Search a place — Trafalgar, Piccadilly, Piazza…"
          aria-label="Search cameras and webcams"
        />
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="tn-cs-picker-list">
        {q.trim().length >= 2 && results.length === 0 && (
          <p className="tn-w-empty">
            Nothing matching “{q.trim()}” in the cameras loaded here. The webcam layer is a partial
            sample of Windy&rsquo;s catalogue, so this is not evidence there is no camera there.
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
              <span className="tn-cs-hit-sub">{already ? "already in this slot" : r.sub}</span>
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
