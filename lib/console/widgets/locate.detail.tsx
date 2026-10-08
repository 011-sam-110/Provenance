"use client";
// Locate focus view — the photo-geolocation console. Same upload → /api/geolocate flow
// as the compact card (shared useGeolocate hook), opened up: a large drop zone + image
// preview, a self-contained overview InsetMap that pins every estimate, a ranked list
// with confidence bars + the model's reasoning, and a CSV / GeoJSON export of the hits.
// Selecting a candidate flies BOTH the overview map (its own fit) and the shared globe
// (mapViewStore.flyToPoint). Honest throughout — results are labelled estimates.
import { useEffect, useMemo, useRef, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import { useGeolocate } from "@/lib/geolocate/useGeolocate";
import { mapViewStore } from "@/lib/mapView";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import ExportExtras from "@/components/console/ExportExtras";
import "./locate.css";

// Photo geolocation is coarse — land the globe at a regional zoom, not street level.
const FLY_ZOOM = 9;

/** The source line of the data dictionary. /api/geolocate runs GeoCLIP when one is
 *  configured and falls back to a vision language model (see locate.tsx). */
const LOCATE_SOURCE =
  "An estimate that a model made from the photo you gave: GeoCLIP when it is configured, else a vision language model. Not a measurement.";

const METHOD_LABEL: Record<string, string> = {
  "vision-ai": "vision-AI estimate",
  "geo-model": "open geo-model (GeoCLIP)",
};

export default function LocateDetail(_props: WidgetDetailProps) {
  const g = useGeolocate();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { candidates, selected } = g;

  // Fly the shared globe to the top estimate as soon as a fresh result lands.
  useEffect(() => {
    const top = candidates[0];
    if (g.result && top) mapViewStore.flyToPoint({ lat: top.lat, lon: top.lon, zoom: FLY_ZOOM });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.result]);

  const choose = (i: number) => {
    g.select(i);
    const c = candidates[i];
    if (c) mapViewStore.flyToPoint({ lat: c.lat, lon: c.lon, zoom: FLY_ZOOM });
  };

  const points: InsetPoint[] = useMemo(
    () => candidates.map((c, i) => ({ lat: c.lat, lon: c.lon, id: String(i), props: { name: c.place } })),
    [candidates],
  );

  const exportRows = useMemo(
    () => candidates.map((c, i) => ({
      rank: i + 1,
      place: c.place || "Unnamed location",
      country: c.country ?? "",
      lat: c.lat,
      lon: c.lon,
      confidence: c.confidence,
    })),
    [candidates],
  );
  const exportGeo = useMemo(
    () => candidates.map((c) => ({
      lat: c.lat,
      lon: c.lon,
      properties: { place: c.place, country: c.country ?? "", confidence: c.confidence },
    })),
    [candidates],
  );

  return (
    <div className="tnl-detail">
      <header className="tnl-d-head">
        <div>
          <div className="tnl-d-title">Photo geolocation</div>
          <div className="tnl-d-sub">
            Estimate where a photo was taken from its visual cues. Results are estimates, not GPS truth.
          </div>
        </div>
        {g.method && <span className="tnl-d-method">{METHOD_LABEL[g.method] ?? g.method}</span>}
      </header>

      <div className="tnl-d-grid">
        <section className="tnl-d-panel">
          <div
            className={`tnl-drop tnl-drop-lg${dragging ? " is-drag" : ""}`}
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
              <img className="tnl-thumb tnl-thumb-lg" src={g.previewUrl} alt="Photo to geolocate" />
            ) : (
              <>
                <p><strong>Drop a photo here</strong> or click to choose</p>
                <p className="tnl-hint">JPEG / PNG / WebP · stays on the server, never stored</p>
              </>
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
            {(g.canLocate || candidates.length > 0) && (
              <button className="tnl-btn tnl-btn-ghost" onClick={g.reset} disabled={g.loading}>
                Clear
              </button>
            )}
          </div>

          {g.error && <div className="tnl-error">{g.error}</div>}
          {g.note && candidates.length > 0 && <div className="tnl-note">{g.note}</div>}

          {candidates.length > 0 && (
            <div className="tnl-results">
              {candidates.map((c, i) => {
                const pct = Math.round(c.confidence * 100);
                return (
                  <button
                    key={`${c.lat},${c.lon},${i}`}
                    className={`tnl-cand tnl-cand-lg${selected === i ? " is-active" : ""}`}
                    onClick={() => choose(i)}
                    title="Fly the map here"
                  >
                    <span className="tnl-rank">{i + 1}</span>
                    <span className="tnl-cand-main">
                      <span className="tnl-cand-place">{c.place || "Unnamed location"}</span>
                      {c.country && <span className="tnl-cand-sub"> · {c.country}</span>}
                      <span className="tnl-cand-sub tn-num"> ({c.lat.toFixed(3)}, {c.lon.toFixed(3)})</span>
                      {c.reasoning && <span className="tnl-cand-reason">{c.reasoning}</span>}
                    </span>
                    <span className="tnl-conf-col">
                      <span className="tnl-conf tn-num">{pct}%</span>
                      <span className="tnl-conf-bar"><span className="tnl-conf-fill" style={{ width: `${pct}%` }} /></span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {candidates.length === 0 && !g.loading && !g.error && (
            <p className="tn-w-empty">Drop or link a photo to estimate where it was taken.</p>
          )}
        </section>

        <section className="tnl-d-map">
          {points.length > 0 ? (
            <InsetMap points={points} height={360} onSelect={(id) => choose(Number(id))} />
          ) : (
            <div className="tnl-d-map-empty">Estimated locations will appear here as pins.</div>
          )}
          {candidates.length > 0 && (
            <div className="tnl-d-export">
              <button
                onClick={() => downloadText(`${exportFilename("locate", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
              >⬇ CSV</button>
              <button
                onClick={() => downloadText(`${exportFilename("locate", Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}
              >⬇ GeoJSON</button>
              <ExportExtras name="locate" kind="locate" rows={exportRows} geo={exportGeo} source={LOCATE_SOURCE} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
