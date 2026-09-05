"use client";
// /locate — keyless photo geolocation (a "picarta.ai" equivalent).
//
// Upload / drop / link a photo → the app estimates WHERE it was taken and plots
// ranked candidates on its own small MapLibre map. Self-contained: it does NOT
// import the shared WorldMap; it spins up a lightweight Positron map here and
// reuses lib/basemaps + /api/geocode via the /api/geolocate route. Honest by
// design — everything is labelled "estimated", with the method and a confidence.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { POSITRON_STYLE_URL } from "@/lib/basemaps";
import { useGeolocate } from "@/lib/geolocate/useGeolocate";
import type { ResolvedCandidate, GeolocateMethod } from "@/lib/geolocate/types";
import "./locate.css";

const METHOD_LABEL: Record<GeolocateMethod, string> = {
  "vision-ai": "vision-AI estimate",
  "geo-model": "open geo-model (GeoCLIP)",
};

export default function LocatePage() {
  // The upload → /api/geolocate → ranked-candidates state machine is shared with the
  // console `locate` widget via useGeolocate; this page keeps its own inset map below.
  const {
    imageUrl,
    previewUrl,
    loading,
    error,
    result,
    selected,
    candidates,
    canLocate,
    pickFile,
    onUrlChange,
    locate,
    select,
  } = useGeolocate();
  const [dragging, setDragging] = useState(false);

  return (
    <div className="loc-page">
      <header className="loc-header">
        <div>
          <h1>Photo Geolocation</h1>
          <p className="loc-sub">
            Estimate where a photo was taken from its visual cues — architecture, signage,
            vegetation, road furniture. Results are <strong>estimates</strong>, not GPS truth.
          </p>
        </div>
        <Link className="loc-back" href="/">
          ← Back to map
        </Link>
      </header>

      <div className="loc-body">
        <section className="loc-panel">
          <UploadCard
            dragging={dragging}
            setDragging={setDragging}
            previewUrl={previewUrl}
            imageUrl={imageUrl}
            onUrlChange={onUrlChange}
            pickFile={pickFile}
            locate={locate}
            loading={loading}
            canLocate={canLocate}
            method={result?.method}
          />

          {error && <div className="loc-error">{error}</div>}

          {candidates.length > 0 && (
            <>
              {result?.note && <div className="loc-note">{result.note}</div>}
              <div className="loc-results">
                <h2>Estimated locations</h2>
                {candidates.map((c, i) => (
                  <CandidateRow
                    key={`${c.lat},${c.lon},${i}`}
                    c={c}
                    rank={i + 1}
                    active={selected === i}
                    onClick={() => select(i)}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <ResultMap candidates={candidates} selected={selected} onSelect={select} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function UploadCard(props: {
  dragging: boolean;
  setDragging: (v: boolean) => void;
  previewUrl: string | null;
  imageUrl: string;
  onUrlChange: (v: string) => void;
  pickFile: (f: File | null) => void;
  locate: () => void;
  loading: boolean;
  canLocate: boolean;
  method?: GeolocateMethod;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { setDragging, pickFile } = props;

  return (
    <div className="loc-card">
      <div
        className={`loc-drop${props.dragging ? " is-drag" : ""}`}
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
          if (f && f.type.startsWith("image/")) pickFile(f);
        }}
      >
        <p>
          <strong>Drop a photo here</strong> or click to choose
        </p>
        <p>JPEG / PNG / WebP · stays on the server, never stored</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="loc-url-row">
        <input
          type="url"
          placeholder="…or paste an image URL"
          value={props.imageUrl}
          onChange={(e) => props.onUrlChange(e.target.value)}
        />
      </div>

      {props.previewUrl && (
        <div className="loc-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={props.previewUrl} alt="Photo to geolocate" />
        </div>
      )}

      <div className="loc-actions">
        <button className="loc-btn" onClick={props.locate} disabled={!props.canLocate || props.loading}>
          {props.loading ? "Locating…" : "Locate"}
        </button>
        {props.loading && <span className="loc-spinner" aria-hidden />}
        {props.method && <span className="loc-method">{METHOD_LABEL[props.method]}</span>}
      </div>
    </div>
  );
}

function CandidateRow(props: {
  c: ResolvedCandidate;
  rank: number;
  active: boolean;
  onClick: () => void;
}) {
  const { c, rank, active } = props;
  const pct = Math.round(c.confidence * 100);
  return (
    <button className={`loc-cand${active ? " is-active" : ""}`} onClick={props.onClick}>
      <span className="loc-rank">{rank}</span>
      <span>
        <span className="loc-cand-place">{c.place || "Unnamed location"}</span>
        {c.country && <span className="loc-cand-country"> · {c.country}</span>}
        <span className="loc-cand-country tn-num">
          {" "}
          ({c.lat.toFixed(3)}, {c.lon.toFixed(3)})
        </span>
        {c.reasoning && <div className="loc-cand-reason">{c.reasoning}</div>}
      </span>
      <span className="loc-conf">
        <span className="loc-conf-pct">{pct}%</span>
        <span className="loc-conf-bar">
          <span className="loc-conf-fill" style={{ width: `${pct}%` }} />
        </span>
      </span>
    </button>
  );
}

function ResultMap(props: {
  candidates: ResolvedCandidate[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ marker: maplibregl.Marker; el: HTMLElement }[]>([]);
  const readyRef = useRef(false);
  const { candidates, selected, onSelect } = props;

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      // POSITRON_STYLE_URL by name: Positron left the basemap registry with the
      // Dark/Light pair, but this small locate map still wants the calm light style.
      style: POSITRON_STYLE_URL,
      center: [0, 20],
      zoom: 1.2,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      readyRef.current = true;
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
      markersRef.current = [];
    };
  }, []);

  // Rebuild markers when candidates change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const { marker } of markersRef.current) marker.remove();
    markersRef.current = [];

    if (candidates.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    candidates.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "loc-pin";
      const span = document.createElement("span");
      span.textContent = String(i + 1);
      el.appendChild(span);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(i);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([c.lon, c.lat])
        .addTo(map);
      markersRef.current.push({ marker, el });
      bounds.extend([c.lon, c.lat]);
    });

    const fit = () =>
      candidates.length === 1
        ? map.easeTo({ center: [candidates[0].lon, candidates[0].lat], zoom: 6, duration: 800 })
        : map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 800 });
    if (readyRef.current) fit();
    else map.once("load", fit);
  }, [candidates, onSelect]);

  // Highlight + fly to the selected candidate.
  useEffect(() => {
    const map = mapRef.current;
    markersRef.current.forEach(({ el }, i) => el.classList.toggle("is-active", i === selected));
    if (map && selected != null && candidates[selected]) {
      const c = candidates[selected];
      map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 5), duration: 900, essential: true });
    }
  }, [selected, candidates]);

  return (
    <div className="loc-map-wrap">
      <div className="loc-map" ref={containerRef} />
      {candidates.length === 0 && (
        <div className="loc-map-empty">Estimated locations will appear here as pins.</div>
      )}
    </div>
  );
}
