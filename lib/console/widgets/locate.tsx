"use client";
/**
 * Locate widget — photo geolocation on the console. Drop / link a photo and it
 * estimates WHERE it was taken (the same keyless "picarta.ai" flow as the /locate
 * route, via POST /api/geolocate), then plots ranked candidates by flying the SHARED
 * globe to them (mapViewStore.flyToPoint) instead of spinning up a second map. Honest
 * by design — every hit is labelled an estimate with the model's own confidence.
 *
 * All the upload → locate state lives in the shared useGeolocate hook (reused by the
 * page and the focus view); this file is just the compact card. The richer focus view
 * with an overview map + confidence bars lives in ./locate.detail.
 */
import { useEffect, useRef, useState } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useGeolocate } from "@/lib/geolocate/useGeolocate";
import { mapViewStore } from "@/lib/mapView";
import type { ResolvedCandidate } from "@/lib/geolocate/types";
import LocateDetail from "./locate.detail";
import "./locate.css";

/** Fly the shared globe to an estimated candidate. Photo geolocation is coarse, so
 *  land at a regional zoom rather than street level. */
export function flyToCandidate(c: ResolvedCandidate): void {
  mapViewStore.flyToPoint({ lat: c.lat, lon: c.lon, zoom: 9 });
}

function LocateBody(_props: WidgetBodyProps) {
  const g = useGeolocate();
  const report = useWidgetReport();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { candidates, selected } = g;

  // Report count + an export payload (CSV / GeoJSON of the estimates) to the frame.
  useEffect(() => {
    report({
      alerts: [],
      count: candidates.length,
      freshLabel: candidates.length ? "estimate" : undefined,
      export: {
        name: "locate",
        rows: candidates.map((c, i) => ({
          rank: i + 1,
          place: c.place || "Unnamed location",
          country: c.country ?? "",
          lat: c.lat,
          lon: c.lon,
          confidence: c.confidence,
        })),
        geo: candidates.map((c) => ({
          lat: c.lat,
          lon: c.lon,
          properties: { place: c.place, country: c.country ?? "", confidence: c.confidence },
        })),
      },
    });
  }, [candidates, report]);

  // Fly the globe to the top estimate as soon as a fresh result lands.
  useEffect(() => {
    if (g.result && candidates.length > 0) flyToCandidate(candidates[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.result]);

  const choose = (i: number) => {
    g.select(i);
    const c = candidates[i];
    if (c) flyToCandidate(c);
  };

  return (
    <div className="tnl">
      <div
        className={`tnl-drop${dragging ? " is-drag" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && f.type.startsWith("image/")) g.pickFile(f);
        }}
      >
        {g.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tnl-thumb" src={g.previewUrl} alt="Photo to geolocate" />
        ) : (
          <p><strong>Drop a photo</strong> or click to choose</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => g.pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="tnl-controls">
        <input
          className="tnl-url"
          type="url"
          placeholder="…or paste an image URL"
          value={g.imageUrl}
          onChange={(e) => g.onUrlChange(e.target.value)}
        />
        <button className="tnl-btn" onClick={g.locate} disabled={!g.canLocate || g.loading}>
          {g.loading ? "Locating…" : "Locate"}
        </button>
      </div>

      {g.error && <div className="tnl-error">{g.error}</div>}

      {candidates.length > 0 && (
        <div className="tnl-results">
          {candidates.map((c, i) => (
            <button
              key={`${c.lat},${c.lon},${i}`}
              className={`tnl-cand${selected === i ? " is-active" : ""}`}
              onClick={() => choose(i)}
              title="Fly the map here"
            >
              <span className="tnl-rank">{i + 1}</span>
              <span className="tnl-cand-main">
                <span className="tnl-cand-place">{c.place || "Unnamed location"}</span>
                {c.country && <span className="tnl-cand-sub"> · {c.country}</span>}
              </span>
              <span className="tnl-conf tn-num">{Math.round(c.confidence * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      {candidates.length === 0 && !g.loading && !g.error && (
        <p className="tn-w-empty">Drop or link a photo to estimate where it was taken.</p>
      )}

      {g.note && candidates.length > 0 && <div className="tnl-note">{g.note}</div>}
    </div>
  );
}

export const LOCATE_WIDGET = {
  id: "locate",
  title: "Locate",
  icon: "📍",
  category: "Tools",
  defaultHeight: 320,
  defaultConfig: {},
  component: LocateBody,
  detail: LocateDetail,
  help: {
    what: "Drop or link a photo and it estimates where on Earth it was taken, then flies the globe to the ranked candidates. Every hit is labelled an estimate with the model's own confidence.",
    // NOT Picarta — the old note named a vendor we have never called. /api/geolocate
    // runs a GeoCLIP sidecar when one is configured and falls back to a vision LLM.
    source: "GeoCLIP geo-embedding model, or a vision-LLM fallback, via /api/geolocate",
  },
};
registerWidget(LOCATE_WIDGET);
