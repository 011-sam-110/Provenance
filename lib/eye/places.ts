// The God's eye view's places and its link format. Pure: no DOM, no MapLibre, so the
// node test suite can hold every rule in this file (tests/unit/eye-places.test.ts).
//
// THE PAGE OWNS ITS ADDRESS. The console's map writes `?lat&lon&z&layers&base` back
// into the URL on every move (lib/share/deepLink.ts). The view cannot share that
// format: it carries a heading and a tilt the console's does not, and the console's
// writer would replace them on the first move. So WorldMap opens with `openAt` here,
// reads nothing from the URL and writes nothing back, and this file is the only
// reader and writer of /eye's query.
//
// THREE KINDS OF LINK, in the order they are tried:
//   /eye?place=westminster            a preset, framed by hand for a wide screen and
//                                     again for a 9:16 phone
//   /eye?cam=tfl:…&lat=…&lon=…        a camera's spot, opened from its detail panel
//   /eye?lat=…&lon=…&z=…&heading=…&tilt=…   any spot, opened by the person on the console's
//                                     map (components/console/EyePerson.tsx)
// A preset that also names a position (`place=…&lat=…&lon=…`) opens that position under
// the preset's name: `eyeLinkQuery` writes one, and any link kept from a view opens it.
// Anything else, including a link with a broken number in it, opens the first preset.

/** One camera position. MapLibre's own terms: tilt is pitch, heading is bearing. */
export interface EyeView {
  lat: number;
  lon: number;
  zoom: number;
  /** Degrees down from straight overhead. */
  tilt: number;
  /** Degrees clockwise from north. */
  heading: number;
}

export interface EyePlace {
  id: string;
  name: string;
  area: string;
  /** Framed for landscape and square screens. */
  wide: EyeView;
  /**
   * Framed for portrait screens. A 9:16 frame is not a narrow 16:9 one: the river or
   * the street that runs ACROSS a desktop frame has to run UP a phone's, or the phone
   * shows a strip of water and no cameras.
   */
  tall: EyeView;
}

/**
 * The reel presets, in the order they are offered. Each view was framed on live data
 * on 25 Oct 2026 (TfL cameras, river traffic, towers in shot), at 1440 x 900 and at a
 * 9:16 recording's 540 x 960, for the most camera cards that stand clear of the frame's
 * words with the landmark in shot.
 */
export const EYE_PLACES: readonly EyePlace[] = [
  {
    id: "westminster",
    name: "Westminster",
    area: "London",
    wide: { lat: 51.5013, lon: -0.1218, zoom: 15.9, tilt: 58, heading: 32 },
    tall: { lat: 51.5014, lon: -0.1196, zoom: 15.75, tilt: 52, heading: 292 },
  },
  {
    id: "tower-bridge",
    name: "Tower Bridge",
    area: "London",
    wide: { lat: 51.5062, lon: -0.0772, zoom: 15.7, tilt: 58, heading: 292 },
    // Looking south down the bridge, its north end's camera in shot.
    tall: { lat: 51.5068, lon: -0.0754, zoom: 15.5, tilt: 58, heading: 170 },
  },
  {
    id: "piccadilly",
    name: "Piccadilly Circus",
    area: "London",
    // Looking south over St James's: five TfL cameras round the Circus stand at once.
    wide: { lat: 51.50995, lon: -0.13424, zoom: 15.6, tilt: 56, heading: 180 },
    // Looking east along Shaftesbury Avenue.
    tall: { lat: 51.50995, lon: -0.13424, zoom: 15.6, tilt: 58, heading: 70 },
  },
];

export const DEFAULT_PLACE: EyePlace = EYE_PLACES[0];

export function placeById(id: string | null | undefined): EyePlace | undefined {
  if (!id) return undefined;
  return EYE_PLACES.find((p) => p.id === id);
}

/**
 * Below zoom 14 OpenFreeMap has no buildings to raise (lib/map/buildings.ts), so the
 * view would be flat imagery with a HUD on it. A link asking for less opens here.
 */
export const EYE_MIN_ZOOM = 14.5;
export const EYE_MAX_ZOOM = 19;
/** MapLibre's own default ceiling. Tilting further shows the sky. */
export const EYE_MAX_TILT = 60;
/** The furthest north or south a link may ask for. Past it the link counts as broken. */
export const EYE_MAX_LAT = 85;
/** What a spot or camera link gets when it names no tilt: oblique, like the presets. */
export const EYE_DEFAULT_TILT = 55;
/** A camera link opens close enough for its card to stand among the buildings. */
export const EYE_CAMERA_ZOOM = 16.4;
export const EYE_SPOT_ZOOM = 16;

/**
 * Camera ids are `${source}:${nativeId}` (lib/types.ts), and the native half is the
 * operator's own, so it is held loosely: no spaces, nothing that is markup.
 */
const CAMERA_ID = /^[a-z0-9-]{1,32}:[^\s<>"'&]{1,160}$/;

export type EyeTarget =
  | { kind: "place"; place: EyePlace; view: EyeView }
  | { kind: "camera"; cameraId: string; view: EyeView }
  | { kind: "spot"; view: EyeView };

function num(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The link's `lat` and `lon`, when both are numbers on the map; otherwise null. */
function readSpot(params: URLSearchParams): { lat: number; lon: number } | null {
  const lat = num(params.get("lat"));
  const lon = num(params.get("lon"));
  if (lat == null || lon == null || Math.abs(lat) > EYE_MAX_LAT || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Any heading into [0, 360). */
export function wrapHeading(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/**
 * Read a link. Never throws: a broken or missing value falls back, it does not fail.
 *
 * @param portrait  true on a portrait screen, which picks a preset's `tall` framing.
 */
export function parseEyeLink(params: URLSearchParams, portrait: boolean): EyeTarget {
  const place = placeById(params.get("place"));
  const spot = readSpot(params);
  if (place) {
    const framed = portrait ? place.tall : place.wide;
    if (!spot) return { kind: "place", place, view: framed };
    // A place link that also names a camera position: the way back from the console.
    // What it leaves out falls back to the place's own framing.
    return {
      kind: "place",
      place,
      view: {
        lat: spot.lat,
        lon: spot.lon,
        zoom: clamp(num(params.get("z")) ?? framed.zoom, EYE_MIN_ZOOM, EYE_MAX_ZOOM),
        tilt: clamp(num(params.get("tilt")) ?? framed.tilt, 0, EYE_MAX_TILT),
        heading: wrapHeading(num(params.get("heading")) ?? framed.heading),
      },
    };
  }

  if (spot) {
    const { lat, lon } = spot;
    const cam = params.get("cam");
    const isCamera = cam != null && CAMERA_ID.test(cam);
    const zoom = num(params.get("z"));
    const tilt = num(params.get("tilt"));
    const heading = num(params.get("heading"));
    const view: EyeView = {
      lat,
      lon,
      zoom: clamp(zoom ?? (isCamera ? EYE_CAMERA_ZOOM : EYE_SPOT_ZOOM), EYE_MIN_ZOOM, EYE_MAX_ZOOM),
      tilt: clamp(tilt ?? EYE_DEFAULT_TILT, 0, EYE_MAX_TILT),
      heading: wrapHeading(heading ?? 0),
    };
    return isCamera ? { kind: "camera", cameraId: cam!, view } : { kind: "spot", view };
  }

  return { kind: "place", place: DEFAULT_PLACE, view: portrait ? DEFAULT_PLACE.tall : DEFAULT_PLACE.wide };
}

const r = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** The query for one camera position, rounded to what a link needs. */
function viewQuery(view: EyeView, p: URLSearchParams): void {
  p.set("lat", String(r(view.lat, 5)));
  p.set("lon", String(r(view.lon, 5)));
  p.set("z", String(r(clamp(view.zoom, EYE_MIN_ZOOM, EYE_MAX_ZOOM), 2)));
  p.set("heading", String(Math.round(wrapHeading(view.heading)) % 360));
  p.set("tilt", String(Math.round(clamp(view.tilt, 0, EYE_MAX_TILT))));
}

/** A link to a preset. */
export function eyePlaceHref(id: string): string {
  return `/eye?place=${encodeURIComponent(id)}`;
}

/**
 * A link to any spot. A view looking straight down gets the default tilt instead, because
 * a flat view is the console, not this.
 */
export function eyeSpotHref(view: EyeView): string {
  const p = new URLSearchParams();
  viewQuery({ ...view, tilt: view.tilt < 20 ? EYE_DEFAULT_TILT : view.tilt }, p);
  return `/eye?${p.toString()}`;
}

/** A link that opens centred on one camera. */
export function eyeCameraHref(cameraId: string, lat: number, lon: number): string {
  const p = new URLSearchParams();
  p.set("cam", cameraId);
  p.set("lat", String(r(lat, 5)));
  p.set("lon", String(r(lon, 5)));
  return `/eye?${p.toString()}`;
}

/**
 * The console's own layer keys (ACTIVE_LAYERS in lib/layers.ts) for what this view
 * draws: road cameras of both tiers and aircraft. Vessels are left out because `ships`
 * is only a PLANNED key there; the console draws them as a signal layer.
 */
export const EYE_CONSOLE_LAYERS = ["livecams", "staticcams", "planes"] as const;

export interface ConsoleLinkOptions {
  /** Open the Sources rail on arrival (`sources=open`, lib/console/sourcesLink.ts). */
  sources?: boolean;
  /**
   * Carry this view's layers and its satellite ground. ONLY for a browser with no saved
   * console board: the console saves a link's `layers=` over the visitor's own toggles,
   * so a returning visitor must keep theirs. EyeHud decides, from localStorage, when the
   * link is used.
   */
  scene?: boolean;
  /**
   * This view's own link, from `eyeLinkQuery`, carried as `eye=`. The console no longer
   * reads it: its way back was removed for the person on its map, and `withoutArrivalFlags`
   * drops the param from the address, so a link that carries one still opens cleanly.
   */
  back?: string;
}

/**
 * The console at this spot, in the console's own link format (lib/share/url.ts). Only
 * the camera goes back unless `scene` is set: the console keeps its own layers and
 * basemap per browser.
 */
export function consoleHref(view: Pick<EyeView, "lat" | "lon" | "zoom">, opts: ConsoleLinkOptions = {}): string {
  const p = new URLSearchParams();
  p.set("lat", String(r(view.lat, 5)));
  p.set("lon", String(r(view.lon, 5)));
  p.set("z", String(r(clamp(view.zoom, 0, EYE_MAX_ZOOM), 2)));
  if (opts.scene) {
    p.set("layers", EYE_CONSOLE_LAYERS.join(","));
    p.set("base", "satellite");
  }
  if (opts.sources) p.set("sources", "open");
  // Last, so the link still reads `lat…&z…` first and `sources=open` before it.
  if (opts.back) p.set(EYE_RETURN_PARAM, opts.back);
  return `/app?${p.toString()}`;
}

/** The part of localStorage the check below reads. */
export interface ItemReader {
  getItem(key: string): string | null;
}

/**
 * Does this browser hold a saved console board? `key` is the variant spine's own key
 * (PERSIST_KEY in lib/variants/store.ts), passed in so this file stays free of the
 * console's stores. A storage that throws (blocked site data, a private window) holds
 * nothing the console could keep, so it counts as no board.
 */
export function hasSavedBoard(storage: ItemReader | undefined, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) != null;
  } catch {
    return false;
  }
}

/**
 * The console link's param that carries this view's own link. Its value is a query string,
 * `eyeLinkQuery`'s. The console only drops it (lib/console/sourcesLink.ts).
 */
export const EYE_RETURN_PARAM = "eye";

/**
 * The query (no `?`) that reopens this view: the place or the camera it was opened
 * from, then the camera position, rounded and clamped as every link here is. A spot
 * names no target, only the position.
 */
export function eyeLinkQuery(target: EyeTarget, view: EyeView): string {
  const p = new URLSearchParams();
  if (target.kind === "place") p.set("place", target.place.id);
  else if (target.kind === "camera") p.set("cam", target.cameraId);
  viewQuery(view, p);
  return p.toString();
}
