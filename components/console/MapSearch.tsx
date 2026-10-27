"use client";
// The central place-search bar floated over the top-centre of the globe. Type a
// place → keyless Photon geocode (debounced) → pick a match → it drops a PIN there
// and flies the camera to it. Pins accumulate (see lib/map/pins) and are walked with
// the PinNavigator; you can also drop one by right-clicking the map. Calm .tn-* look;
// dormant-safe (a flaky geocoder shows an inline note, never throws).
//
// AN IP OR A DOMAIN GETS ONE MORE ROW, first: "Locate network" (lib/recon/ipLocate.ts).
// It does not drop a pin. It opens the network dossier and draws an AREA, the
// country or a circle with a published radius, never a point: a typed IP can be a
// person's, and pins are saved and synced. A network target is NOT sent to the
// geocoder: no place is an IP, and the privacy page's place-search row would stop
// being the whole story of where the typed text goes.

import { useCallback, useEffect, useRef, useState } from "react";
import { mapViewStore } from "@/lib/mapView";
import { pinsStore } from "@/lib/map/pins";
import type { GeocodeResult } from "@/lib/geo/geocode";
import { networkTargetOf } from "@/lib/recon/geo";
import { ipLocateStore } from "@/lib/recon/ipLocate";

const DEBOUNCE_MS = 350; // keeps us under the community geocoder's ~1 req/s

// Choose a fly-to zoom from a result's extent: wide areas frame out, points zoom in.
function zoomForResult(r: GeocodeResult): number {
  if (!r.bbox) return 11;
  const [w, s, e, n] = r.bbox;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s));
  if (span > 4) return 5;
  if (span > 1) return 7;
  if (span > 0.2) return 9;
  if (span > 0.04) return 11;
  return 13;
}

export default function MapSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const reqRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    reqRef.current++;
    setOpen(false);
    setStatus(null);
  }, []);

  // Debounced geocode.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setStatus(null);
      return;
    }
    if (networkTargetOf(q)) {
      reqRef.current++; // drop any place search still in flight
      setResults([]);
      setStatus(null);
      setOpen(true);
      return;
    }
    const t = setTimeout(() => {
      const myReq = ++reqRef.current;
      setOpen(true);
      setStatus("Searching…");
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          if (myReq !== reqRef.current) return;
          const rs = (d.results as GeocodeResult[]) ?? [];
          setResults(rs);
          setStatus(rs.length ? null : "No matching places.");
        })
        .catch(() => {
          if (myReq !== reqRef.current) return;
          setResults([]);
          setStatus("Search is unavailable right now.");
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [close]);

  const network = networkTargetOf(query);

  const locate = () => {
    if (!network) return;
    void ipLocateStore.locate(network.value);
    setQuery("");
    setResults([]);
    close();
  };

  const pick = (r: GeocodeResult) => {
    pinsStore.add(r.lat, r.lon, r.name); // drop a pin + make it active
    mapViewStore.flyToPoint({ lat: r.lat, lon: r.lon, zoom: zoomForResult(r) });
    setQuery("");
    setResults([]);
    close();
  };

  return (
    <div className="tn-mapsearch" ref={rootRef}>
      <div className="tn-mapsearch-bar">
        <span className="tn-mapsearch-icon" aria-hidden>⌕</span>
        <input
          className="tn-mapsearch-input"
          type="search"
          placeholder="Search a place, an IP or a domain"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); close(); }
            else if (e.key === "Enter" && network) { e.preventDefault(); locate(); }
            else if (e.key === "Enter" && results[0]) { e.preventDefault(); pick(results[0]); }
          }}
          aria-label="Search for a place to drop a pin, or an IP or domain to locate its network"
        />
      </div>

      {open && (network != null || results.length > 0 || status != null) && (
        <div className="tn-mapsearch-results" role="listbox" aria-label="Search results">
          {network && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="tn-mapsearch-item is-network"
              onClick={locate}
            >
              <span className="tn-mapsearch-item-net" aria-hidden>◎</span>
              <span className="tn-mapsearch-item-name">Locate network: {network.value}</span>
              <span className="tn-mapsearch-item-meta">{network.kind === "ip" ? "IP" : "domain"} · area, no pin</span>
            </button>
          )}
          {results.map((r) => (
            <button
              key={`${r.name}:${r.lat},${r.lon}`}
              type="button"
              role="option"
              aria-selected={false}
              className="tn-mapsearch-item"
              onClick={() => pick(r)}
            >
              <span className="tn-mapsearch-item-pin" aria-hidden>📍</span>
              <span className="tn-mapsearch-item-name">{r.name}</span>
              {r.type && <span className="tn-mapsearch-item-meta">{r.type}</span>}
            </button>
          ))}
          {status && <div className="tn-mapsearch-status">{status}</div>}
        </div>
      )}
    </div>
  );
}
