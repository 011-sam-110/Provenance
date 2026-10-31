"use client";
// THE SEARCH PILL, top left of the map. Type a place → keyless Photon geocode (debounced) →
// pick a match → it drops a PIN there and flies the camera to it. Pins accumulate (see
// lib/map/pins) and are walked with the PinNavigator; you can also drop one by right-clicking
// the map. Dormant-safe: a flaky geocoder shows an inline note and never throws.
//
// IT SAYS WHAT IT FINDS. The design's placeholder was "Search places, cameras, sources", and
// this box searches none of the last two: the cameras are only in memory while their layer is
// on, and the source list has its own box in the Sources panel. So the placeholder names the
// three things it does find, and the magnifier says the rest: a longer one is cut at 360 wide.
//
// AN IP OR A DOMAIN GETS ONE MORE ROW, first: "Locate network" (lib/recon/ipLocate.ts).
// It does not drop a pin. It opens the network dossier and draws an AREA, the
// country or a circle with a published radius, never a point: a typed IP can be a
// person's, and pins are saved and synced. A network target is NOT sent to the
// geocoder: no place is an IP, and the privacy page's place-search row would stop
// being the whole story of where the typed text goes.
//
// "CAMERAS NEAR ME" IS THE ROW AN EMPTY BOX OFFERS, and it came from PlaceSearch.tsx, which
// had not been mounted for some time while /privacy went on describing it. It asks the
// browser for a location ONLY when it is pressed. A refusal or a failure is a calm line in
// the list, and the box still works by typing.
//
// MOUNTED BESIDE THE HUD IN StageHost, so a focused widget or a stage with no map has no box,
// and focusMapSearch below answers false.
//
// ESCAPE BELONGS TO THIS BOX while the key lands in it (`data-owns-escape`; the sidebar's
// ladder is in components/shell/ConsoleSidebar.tsx). One press closes the list, the next
// empties the box, and the next gives focus back to where it came from. It stops the key
// there, because the Inspector's own listener would otherwise close the object behind it.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { mapViewStore } from "@/lib/mapView";
import { pinsStore } from "@/lib/map/pins";
import { overlay } from "@/lib/overlay";
import type { GeocodeResult } from "@/lib/geo/geocode";
import { networkTargetOf } from "@/lib/recon/geo";
import { ipLocateStore } from "@/lib/recon/ipLocate";
import { SearchGlyph } from "@/components/shell/inspector/ToolIcons";

const DEBOUNCE_MS = 350; // keeps us under the community geocoder's ~1 req/s
const INPUT_ID = "tn-map-search";

interface NearCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  available: boolean;
  source: string;
  live: boolean;
  km: number;
}

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

/** Where focus was before the search chord, so leaving the box can put it back. */
let cameFrom: HTMLElement | null = null;

/**
 * The console's search chord. Returns false when there is no box on screen to focus.
 *
 * THE BOOLEAN IS THE CONTRACT, and tests/unit/search-shortcut-contract.test.ts holds it:
 * ConsoleShell preventDefaults only on a truthy return, so a chord that can do nothing does
 * not eat the character the visitor typed. "On screen" is checked rather than assumed,
 * because a closed dock on a wall board keeps this box mounted and hides it with
 * `visibility: hidden`.
 */
export function focusMapSearch(): boolean {
  const input = document.getElementById(INPUT_ID);
  if (!(input instanceof HTMLInputElement)) return false;
  if (input.getClientRects().length === 0 || getComputedStyle(input).visibility === "hidden") return false;
  const active = document.activeElement;
  cameFrom = active instanceof HTMLElement && active !== document.body ? active : null;
  // focus() and select(), so a second press types over an old query rather than adding to it.
  input.focus();
  input.select();
  return true;
}

export default function MapSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [nearby, setNearby] = useState<NearCamera[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // Monotonic: the latest action wins over any answer still on its way.
  const reqRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const close = useCallback(() => {
    reqRef.current++;
    setOpen(false);
    setStatus(null);
    setLocating(false);
  }, []);

  // Debounced geocode.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setNearby([]);
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
  const empty = query.trim() === "";

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

  const openCamera = (c: NearCamera) => {
    mapViewStore.flyToPoint({ lat: c.lat, lon: c.lon, zoom: 13 });
    overlay.open({
      kind: "camera",
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      label: c.name,
      meta: { available: c.available },
    });
    setNearby([]);
    close();
  };

  // Geolocate ONLY here, on an explicit press.
  const nearMe = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("Location is not available in this browser.");
      return;
    }
    const myReq = ++reqRef.current;
    setLocating(true);
    setNearby([]);
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (myReq !== reqRef.current) return;
        const { latitude, longitude } = pos.coords;
        mapViewStore.flyToPoint({ lat: latitude, lon: longitude, zoom: 11 });
        setStatus("Finding the nearest cameras…");
        fetch(`/api/near?lat=${latitude}&lon=${longitude}&n=8`)
          .then((r) => r.json())
          .then((d) => {
            if (myReq !== reqRef.current) return;
            const cams = (d.cameras as NearCamera[]) ?? [];
            setNearby(cams);
            setLocating(false);
            setStatus(cams.length ? null : "No cameras found near you.");
          })
          .catch(() => {
            if (myReq !== reqRef.current) return;
            setNearby([]);
            setLocating(false);
            setStatus("Could not load nearby cameras.");
          });
      },
      (err) => {
        if (myReq !== reqRef.current) return;
        setLocating(false);
        setNearby([]);
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. You can still search by typing a place."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Your location is not available right now."
              : err.code === err.TIMEOUT
                ? "Finding your location timed out. Try again."
                : "Could not get your location.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  /** Up and down walk the rows and the box. Focus moves, so Enter presses the row. */
  const walk = (dir: 1 | -1) => {
    const rows = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (!rows || rows.length === 0) return;
    const at = [...rows].indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) rows[dir === 1 ? 0 : rows.length - 1]?.focus();
    else if ((at === 0 && dir === -1) || (at === rows.length - 1 && dir === 1)) inputRef.current?.focus();
    else rows[at + dir]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      walk(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      close();
      inputRef.current?.focus();
    } else if (query) {
      setQuery("");
      setResults([]);
      setNearby([]);
    } else {
      const back = cameFrom;
      cameFrom = null;
      if (back?.isConnected) back.focus();
      else inputRef.current?.blur();
    }
  };

  const showNearRow = empty && nearby.length === 0;
  const showList = open && (showNearRow || network != null || results.length > 0 || nearby.length > 0 || status != null);

  return (
    <div className="tn-mapsearch" ref={rootRef} data-owns-escape="" onKeyDown={onKeyDown}>
      <div className="tn-mapsearch-bar">
        <input
          id={INPUT_ID}
          ref={inputRef}
          className="tn-mapsearch-input"
          type="search"
          placeholder="Place, IP or domain"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            // Typing is a new action: it drops an answer on its way and any line about the
            // last one, including the location request's.
            reqRef.current++;
            setStatus(null);
            setLocating(false);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && network) { e.preventDefault(); locate(); }
            else if (e.key === "Enter" && results[0]) { e.preventDefault(); pick(results[0]); }
          }}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search for a place to drop a pin, or an IP or domain to locate its network"
        />
        <span className="tn-mapsearch-icon" aria-hidden>
          <SearchGlyph />
        </span>
      </div>

      {showList && (
        <div id={listId} className="tn-mapsearch-results" role="listbox" aria-label="Search results">
          {showNearRow && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="tn-mapsearch-item"
              disabled={locating}
              onClick={nearMe}
            >
              <span className="tn-mapsearch-item-name">{locating ? "Finding cameras near you…" : "Cameras near me"}</span>
              <span className="tn-mapsearch-item-meta">asks for your location</span>
            </button>
          )}
          {network && (
            <button type="button" role="option" aria-selected={false} className="tn-mapsearch-item" onClick={locate}>
              <span className="tn-mapsearch-item-name">Locate network: {network.value}</span>
              <span className="tn-mapsearch-item-meta">{network.kind === "ip" ? "IP" : "domain"}, area, no pin</span>
            </button>
          )}
          {!empty && results.map((r) => (
            <button
              key={`${r.name}:${r.lat},${r.lon}`}
              type="button"
              role="option"
              aria-selected={false}
              className="tn-mapsearch-item"
              onClick={() => pick(r)}
            >
              <span className="tn-mapsearch-item-name">{r.name}</span>
              {r.type && <span className="tn-mapsearch-item-meta">{r.type}</span>}
            </button>
          ))}
          {empty && nearby.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={false}
              className="tn-mapsearch-item"
              onClick={() => openCamera(c)}
            >
              <span className="tn-mapsearch-item-name">{c.name}</span>
              <span className="tn-mapsearch-item-meta tn-num">{c.km.toFixed(1)} km</span>
            </button>
          ))}
          {status && <div className="tn-mapsearch-status" role="status">{status}</div>}
        </div>
      )}
    </div>
  );
}
