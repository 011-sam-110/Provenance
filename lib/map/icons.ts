// MapLibre symbol-icon registration for the unified engine.
//
// The camera + plane layers are symbol layers that pick an `icon-image` by name
// per feature. These helpers rasterise the hand-drawn SVG pictograms from
// lib/icons/svg.ts into RGBA images and register them on the map via addImage.
// DOM-dependent (canvas/Image) so this lives apart from the pure FC builders.

import type maplibregl from "maplibre-gl";
import {
  ICON_SVG,
  cameraRegionColor,
  CAMERA_DEFAULT_REGION,
  CAMERA_OFFLINE_COLOR,
  PLANE_META,
  SAT_META,
  SIGNAL_ICON_KEYS,
  WEBCAM_COLOR,
} from "@/lib/icons/svg";

/** Rasterise an SVG pictogram into an image MapLibre can use as a symbol icon. */
export function rasterizeIcon(
  svg: string,
  px = 80,
): Promise<{ width: number; height: number; data: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const sized = svg.replace("<svg ", `<svg width="${px}" height="${px}" `);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(image, 0, 0, px, px);
      const d = ctx.getImageData(0, 0, px, px);
      resolve({ width: px, height: px, data: new Uint8Array(d.data.buffer.slice(0)) });
    };
    image.onerror = reject;
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sized);
  });
}

// Register one region-tinted icon per (feed shape × region colour) so the symbol
// layer can pick the right one per camera with a data-driven expression.
export async function loadCameraIcons(map: maplibregl.Map): Promise<void> {
  const feeds: [string, keyof typeof ICON_SVG][] = [
    ["still", "cam-still"],
    ["video", "cam-video"],
  ];
  const regions: [string, string][] = [
    ["tfl", cameraRegionColor("tfl")],
    ["caltrans", cameraRegionColor("caltrans")],
    ["scdot", cameraRegionColor("scdot")],
    ["digitraffic", cameraRegionColor("digitraffic")],
    ["castlerock", cameraRegionColor("castlerock")],
    ["tripcheck", cameraRegionColor("tripcheck")],
    ["drivebc", cameraRegionColor("drivebc")],
    ["default", CAMERA_DEFAULT_REGION.color],
  ];
  await Promise.all([
    ...feeds.flatMap(([feed, iconKey]) =>
      regions.map(async ([rk, color]) => {
        const name = `cam-${feed}-${rk}`;
        if (map.hasImage(name)) return;
        const img = await rasterizeIcon(ICON_SVG[iconKey].replaceAll("currentColor", color));
        if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      }),
    ),
    // One muted-slate "offline" variant per feed shape so unavailable cameras
    // drop their live region colour (the honesty signal). Picked by icon-image
    // when a feature's `available` is false.
    ...feeds.map(async ([feed, iconKey]) => {
      const name = `cam-${feed}-offline`;
      if (map.hasImage(name)) return;
      const img = await rasterizeIcon(ICON_SVG[iconKey].replaceAll("currentColor", CAMERA_OFFLINE_COLOR));
      if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    }),
  ]);
}

/** Register one heading-up plane icon per type (coloured by PLANE_META). */
export async function loadPlaneIcons(map: maplibregl.Map): Promise<void> {
  await Promise.all(
    Object.values(PLANE_META).map(async (meta) => {
      if (map.hasImage(meta.key)) return;
      const img = await rasterizeIcon(ICON_SVG[meta.key].replaceAll("currentColor", meta.color));
      if (!map.hasImage(meta.key)) map.addImage(meta.key, img, { pixelRatio: 2 });
    }),
  );
}

/** Register the single rose-tinted Windy webcam icon. */
export async function loadWebcamIcons(map: maplibregl.Map): Promise<void> {
  if (map.hasImage("webcam")) return;
  const img = await rasterizeIcon(ICON_SVG.webcam.replaceAll("currentColor", WEBCAM_COLOR));
  if (!map.hasImage("webcam")) map.addImage("webcam", img, { pixelRatio: 2 });
}

/** Register one icon per satellite category (coloured by SAT_META). */
export async function loadSatelliteIcons(map: maplibregl.Map): Promise<void> {
  await Promise.all(
    Object.values(SAT_META).map(async (meta) => {
      if (map.hasImage(meta.key)) return;
      const img = await rasterizeIcon(ICON_SVG[meta.key].replaceAll("currentColor", meta.color));
      if (!map.hasImage(meta.key)) map.addImage(meta.key, img, { pixelRatio: 2 });
    }),
  );
}

/**
 * Register every event/signal pictogram as a WHITE sprite. The colour-coded disc
 * (the circle layer) carries the hue + magnitude; the white pictogram on top names
 * the hazard. One image per icon (no per-source colour variants) keeps it cheap.
 */
export async function loadSignalIcons(map: maplibregl.Map): Promise<void> {
  await Promise.all(
    SIGNAL_ICON_KEYS.map(async (key) => {
      if (map.hasImage(key)) return;
      const img = await rasterizeIcon(ICON_SVG[key].replaceAll("currentColor", "#ffffff"));
      if (!map.hasImage(key)) map.addImage(key, img, { pixelRatio: 2 });
    }),
  );
}

// ── The dashed ring: a country figure with no outline to shade ───────────────
//
// lib/map/precisionMarks.ts gives a country-level feature a dashed ring when the
// outline file does not hold its country. A circle layer cannot be dashed, so the
// ring is a small image, one for each colour, drawn on a canvas when the style asks
// for it (WorldMap wires `styleimagemissing` to addRingImage).
//
// It is drawn to look UNLIKE a pin: no solid disc, no white edge ring, no pictogram.
// A pale centre, tinted with the colour of the feature, holds the figure. The dashes
// are dark ink on a thin white under-stroke, because the first version drew them in
// the feature colour and a pale amber dash on white could not be seen at all.

/** Prefix of every ring image id. The colour follows it: "sig-ring-#ea580c". */
export const RING_IMAGE_PREFIX = "sig-ring-";

const RING_PX = 68; // canvas pixels; 34 CSS px at pixelRatio 2

/**
 * Register the dashed ring for one image id, when the id is a ring id and the style
 * does not have it yet. Returns true when it added an image. Any other id is left
 * for whoever owns it.
 */
export function addRingImage(map: maplibregl.Map, id: string): boolean {
  if (!id.startsWith(RING_IMAGE_PREFIX) || map.hasImage(id)) return false;
  const color = id.slice(RING_IMAGE_PREFIX.length);
  // A colour straight from feature data: accept a hex colour and nothing else.
  const tint = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#64748b";
  const canvas = document.createElement("canvas");
  canvas.width = RING_PX;
  canvas.height = RING_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const c = RING_PX / 2;
  const r = c - 6;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fill();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.globalAlpha = 1;
  // A solid white line first, so the gaps between the dashes read on dark imagery.
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.setLineDash([8.5, 6]);
  ctx.lineCap = "butt";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#0f172a";
  ctx.stroke();
  const d = ctx.getImageData(0, 0, RING_PX, RING_PX);
  map.addImage(id, { width: RING_PX, height: RING_PX, data: new Uint8Array(d.data.buffer.slice(0)) }, { pixelRatio: 2 });
  return true;
}

// ── The hatch over an area of unknown status, and the diamond pin ───────────────────
//
// Both are per-colour images drawn on a canvas when the style first asks for one, the
// same way as the ring above (WorldMap wires `styleimagemissing` to each). A fill-pattern
// image carries its own colour, so the hatch needs one image for each feature colour.

/** Prefix of every hatch image id. The colour follows it: "sig-hatch-#8a8178". */
export const HATCH_IMAGE_PREFIX = "sig-hatch-";
/** Prefix of every diamond image id. The colour follows it: "sig-diamond-#1f4f8a". */
export const DIAMOND_IMAGE_PREFIX = "sig-diamond-";

const HATCH_PX = 24; // canvas pixels; one 12 CSS px tile at pixelRatio 2
/** The diamond's half-diagonal in CSS pixels. WorldMap scales icon-size by radius / this. */
export const DIAMOND_HALF_PX = 16;

const tintOf = (color: string) => (/^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#64748b");

/**
 * Diagonal lines in the feature colour on a thin white casing, with clear gaps between:
 * the ground (or the imagery) shows through, so a hatched area reads as "not known" and
 * never as one more flat tint. The casing keeps the lines visible on dark satellite
 * imagery. The tile repeats without a seam: each line runs corner to corner of a square.
 */
export function addHatchImage(map: maplibregl.Map, id: string): boolean {
  if (!id.startsWith(HATCH_IMAGE_PREFIX) || map.hasImage(id)) return false;
  const tint = tintOf(id.slice(HATCH_IMAGE_PREFIX.length));
  const canvas = document.createElement("canvas");
  canvas.width = HATCH_PX;
  canvas.height = HATCH_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const S = HATCH_PX;
  const lines = () => {
    ctx.beginPath();
    for (const o of [-S, -S / 2, 0, S / 2, S]) {
      ctx.moveTo(o, S);
      ctx.lineTo(o + S, 0);
    }
  };
  ctx.lineCap = "square";
  lines();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 5;
  ctx.stroke();
  lines();
  ctx.strokeStyle = tint;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  const d = ctx.getImageData(0, 0, S, S);
  map.addImage(id, { width: S, height: S, data: new Uint8Array(d.data.buffer.slice(0)) }, { pixelRatio: 2 });
  return true;
}

/**
 * A diamond in the feature colour with a white edge: the round pin's own paint (a solid
 * mark, a white rim), turned into a different shape so two sides never differ by colour
 * alone. Drawn at DIAMOND_HALF_PX; the layer scales it with the pin's radius and the zoom.
 */
export function addDiamondImage(map: maplibregl.Map, id: string): boolean {
  if (!id.startsWith(DIAMOND_IMAGE_PREFIX) || map.hasImage(id)) return false;
  const tint = tintOf(id.slice(DIAMOND_IMAGE_PREFIX.length));
  const r = DIAMOND_HALF_PX * 2; // canvas pixels at pixelRatio 2
  const pad = 4;
  const size = (r + pad) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const c = size / 2;
  ctx.beginPath();
  ctx.moveTo(c, c - r);
  ctx.lineTo(c + r, c);
  ctx.lineTo(c, c + r);
  ctx.lineTo(c - r, c);
  ctx.closePath();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.lineJoin = "round";
  ctx.lineWidth = 4.4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  const d = ctx.getImageData(0, 0, size, size);
  map.addImage(id, { width: size, height: size, data: new Uint8Array(d.data.buffer.slice(0)) }, { pixelRatio: 2 });
  return true;
}
