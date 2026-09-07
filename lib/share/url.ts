// Pure, isomorphic codec for the shareable deep-link view state (M6).
//
// The whole map view — camera (lat/lon/zoom), which layers are on, the basemap,
// and any open dossier object — is encoded into URL query params so a view can be
// bookmarked, shared (Slack/Twitter/recruiter) and restored on load. No DOM, no
// stores: just (ViewState ⇄ query string), so the round-trip is unit-testable in
// the node vitest env. The impure glue (reading the live map + history.replaceState)
// lives in lib/share/deepLink.ts.
//
// Param names are short + stable (they show up in shared URLs):
//   lat, lon — map centre (clamped to ±90 / ±180)
//   z        — map zoom (clamped 0–18, the engine's maxZoom)
//   layers   — csv of the ACTIVE layers currently ON (e.g. "cameras,planes")
//   base     — basemap key, validated against the live registry, so every entry in
//              lib/basemaps.ts deep-links with no edit here (dark | positron |
//              streets | satellite | topo)
//   obj      — namespaced WorldObject id of the open dossier (opaque internal key)
//   sig      — csv of signal ids diverging from the board's defaults
//
// THE BOARD (`?v=`) IS DELIBERATELY NOT HERE. It used to be, and reading it back on
// the SERVER — `generateMetadata` picking a per-board social card — is what made the
// whole `/app` route dynamic for every visitor, cached nowhere. The board is now
// in-session UI state: it persists per browser (lib/variants/persist), it is never
// read from or written to the URL, and a legacy `/app?v=aviation` link lands on the
// default board with the param falling out of the address bar on the first write.
// Same defect, same fix as `/` — see tests/unit/console-static.test.ts.

import { ACTIVE_LAYERS, type LayerKey } from "@/lib/layers";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import { MAP_SIGNALS } from "@/lib/signals/registry";

export interface ViewState {
  lat?: number;
  lon?: number;
  zoom?: number;
  /** Active layers currently ON. An empty array means "all active layers off". */
  layers?: LayerKey[];
  basemap?: BasemapKey;
  /** Namespaced id of the open dossier object, if any. */
  obj?: string;
  /** On-signal ids (divergence from the variant's defaults). */
  sig?: string[];
}

const LAT_MAX = 90;
const LON_MAX = 180;
const ZOOM_MIN = 0;
const ZOOM_MAX = 19; // mirrors WorldMap maxZoom (raised for street-level buildings)
const OBJ_MAX_LEN = 96; // opaque internal key — keep shared links sane

const VALID_LAYERS = new Set<string>(ACTIVE_LAYERS);
const VALID_BASEMAPS = new Set<string>(Object.keys(BASEMAPS));
// MAP_SIGNALS: a shared ?sig= URL may only turn on things that are actually layers.
const VALID_SIGNALS = new Set<string>(MAP_SIGNALS.map((s) => s.id));
const SIG_MAX = 40;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function num(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Serialise a view state to a query string (no leading "?"). Absent keys are omitted. */
export function encodeViewState(state: ViewState): string {
  const p = new URLSearchParams();
  if (state.lat != null && Number.isFinite(state.lat)) {
    p.set("lat", String(round(clamp(state.lat, -LAT_MAX, LAT_MAX), 5)));
  }
  if (state.lon != null && Number.isFinite(state.lon)) {
    p.set("lon", String(round(clamp(state.lon, -LON_MAX, LON_MAX), 5)));
  }
  if (state.zoom != null && Number.isFinite(state.zoom)) {
    p.set("z", String(round(clamp(state.zoom, ZOOM_MIN, ZOOM_MAX), 2)));
  }
  if (state.layers) {
    // Canonical order, valid keys only, de-duplicated. "" = all off (round-trips).
    p.set("layers", ACTIVE_LAYERS.filter((k) => state.layers!.includes(k)).join(","));
  }
  if (state.basemap && VALID_BASEMAPS.has(state.basemap)) {
    p.set("base", state.basemap);
  }
  if (state.obj && state.obj.length <= OBJ_MAX_LEN) {
    p.set("obj", state.obj);
  }
  if (state.sig?.length) {
    const ids = state.sig.filter((s) => VALID_SIGNALS.has(s)).slice(0, SIG_MAX);
    p.set("sig", ids.join(","));
  }
  return p.toString();
}

/** Parse + validate a view state. Invalid/garbage params are dropped, never thrown. */
export function decodeViewState(params: URLSearchParams): ViewState {
  const out: ViewState = {};

  const lat = num(params.get("lat"));
  if (lat != null) out.lat = clamp(lat, -LAT_MAX, LAT_MAX);
  const lon = num(params.get("lon"));
  if (lon != null) out.lon = clamp(lon, -LON_MAX, LON_MAX);
  const zoom = num(params.get("z"));
  if (zoom != null) out.zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);

  if (params.has("layers")) {
    const keys = (params.get("layers") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is LayerKey => VALID_LAYERS.has(s));
    out.layers = ACTIVE_LAYERS.filter((k) => keys.includes(k)); // de-dupe + canonical order
  }

  const base = params.get("base");
  if (base && VALID_BASEMAPS.has(base)) out.basemap = base as BasemapKey;

  const obj = params.get("obj");
  if (obj && obj.length <= OBJ_MAX_LEN) out.obj = obj;

  // `v` is read by nothing and re-emitted by nothing: a legacy board link decodes to
  // the same view as one without it.
  if (params.has("sig")) {
    out.sig = (params.get("sig") ?? "")
      .split(",").map((s) => s.trim())
      .filter((s) => VALID_SIGNALS.has(s)).slice(0, SIG_MAX);
  }

  return out;
}
