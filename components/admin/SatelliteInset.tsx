"use client";

/**
 * A satellite mosaic centred on a candidate's coordinate, with a crosshair.
 *
 * WHY SATELLITE AND NOT A STREET MAP. The question a reviewer is answering is "is
 * there a road here", and a labelled street map answers a different one — it will show
 * a road name at a coordinate that is 400 m into a field, because the label is drawn
 * from the nearest way. Imagery shows the carriageway, the gantry and the layby, so a
 * pin that is plausible-but-wrong is visible in about a second.
 *
 * The tiles come from the same ArcGIS World Imagery service `lib/basemaps.ts` already
 * uses for the console's satellite basemap, so this adds no new upstream and no new
 * attribution obligation beyond the one the product already carries.
 *
 * Nine tiles, translated so the coordinate lands dead centre. No MapLibre instance:
 * this component is mounted and thrown away once per camera, and standing up a WebGL
 * map for a static 700 m square would cost more than the picture beside it.
 */

const TILE = 256;
const GRID = 3; // 3x3 tiles around the centre tile

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function SatelliteInset({ lat, lon, zoom = 17 }: { lat: number; lon: number; zoom?: number }) {
  const { x, y } = tileXY(lat, lon, zoom);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const fx = x - tx;
  const fy = y - ty;

  // Where the point sits inside the 3x3 mosaic, in pixels from its top-left.
  const pointPx = { x: (1 + fx) * TILE, y: (1 + fy) * TILE };
  const size = GRID * TILE;

  const tiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const n = 2 ** zoom;
      const wrappedX = ((tx + dx) % n + n) % n;
      const clampedY = ty + dy;
      if (clampedY < 0 || clampedY >= n) continue;
      tiles.push({
        key: dx + ":" + dy,
        // ArcGIS World Imagery orders the path {z}/{y}/{x}, not {z}/{x}/{y}. Getting
        // that round the wrong way returns a valid tile of somewhere else entirely,
        // which is the worst possible failure for a tool that checks locations.
        url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${clampedY}/${wrappedX}`,
        left: (dx + 1) * TILE,
        top: (dy + 1) * TILE,
      });
    }
  }

  return (
    <div className="adm-map" style={{ position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: size,
          height: size,
          left: "50%",
          top: "50%",
          transform: `translate(${-pointPx.x}px, ${-pointPx.y}px)`,
        }}
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.key}
            src={t.url}
            alt=""
            width={TILE}
            height={TILE}
            style={{ position: "absolute", left: t.left, top: t.top, display: "block" }}
          />
        ))}
      </div>
      <svg
        viewBox="0 0 40 40"
        aria-hidden
        style={{ position: "absolute", left: "50%", top: "50%", width: 40, height: 40, marginLeft: -20, marginTop: -20 }}
      >
        <circle cx="20" cy="20" r="9" fill="none" stroke="#22b8d8" strokeWidth="2" />
        <circle cx="20" cy="20" r="1.6" fill="#22b8d8" />
        <path d="M20 0v7M20 33v7M0 20h7M33 20h7" stroke="#22b8d8" strokeWidth="1.5" />
      </svg>
      <span
        style={{
          position: "absolute",
          right: 6,
          bottom: 4,
          fontSize: 10,
          color: "rgba(255,255,255,0.72)",
          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
        }}
      >
        Imagery © Esri, Maxar, Earthstar Geographics
      </span>
    </div>
  );
}
