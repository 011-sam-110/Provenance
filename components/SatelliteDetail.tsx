"use client";
// Body content for the overlay when a satellite is clicked. Renders the
// satellite's identity + live SATELLITE IMAGERY of the ground directly beneath
// it (the sub-satellite point) at click time, via Esri World Imagery's single-
// image export. Renders body content only — it sits inside the rail's Inspector tab.

import type { WorldObject } from "@/lib/world";
import { TypeIcon } from "@/lib/icons/Icon";

/** Esri World Imagery single-image export for a box around (lat, lon). */
function esriImagery(lat: number, lon: number, halfDeg = 0.4): string {
  // Widen the longitude span by 1/cos(lat) so the image isn't squashed away from the equator.
  const lonHalf = halfDeg / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const bbox = [lon - lonHalf, lat - halfDeg, lon + lonHalf, lat + halfDeg].map((n) => n.toFixed(5)).join(",");
  return (
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
    `?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=640,640&format=jpg&f=image`
  );
}

interface SatMeta {
  noradId?: string;
  objectName?: string;
  altKm?: number;
  velocityKmS?: number;
  periodMin?: number;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 14, color: "var(--tn-text)" },
  figure: { margin: 0, position: "relative", borderRadius: 10, overflow: "hidden", background: "var(--tn-surface-2)", aspectRatio: "1 / 1" },
  img: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  cap: { position: "absolute", left: 8, bottom: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.85)", color: "var(--tn-text-muted)", letterSpacing: "0.02em" },
  badge: { display: "inline-flex", alignItems: "center", gap: 7, alignSelf: "flex-start", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--tn-sat)", border: "1px solid rgba(124,58,237,0.35)", borderRadius: 999, padding: "3px 12px 3px 9px" },
  stats: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px 16px", margin: 0 },
  row: { display: "flex", flexDirection: "column", gap: 2 },
  dt: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--tn-text-faint)" },
  dd: { margin: 0, fontSize: 15, fontVariantNumeric: "tabular-nums", color: "var(--tn-text)" },
  note: { margin: 0, fontSize: 12, color: "var(--tn-text-muted)", lineHeight: 1.5 },
};

const srcLink: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--tn-sat)",
  textDecoration: "none",
  border: "1px solid rgba(124,58,237,0.35)",
  borderRadius: 999,
  padding: "3px 10px",
  whiteSpace: "nowrap",
};

export default function SatelliteDetail({ object }: { object: WorldObject }) {
  const m = (object.meta ?? {}) as SatMeta;
  const altKm = m.altKm ?? object.altKm ?? 0;
  const img = esriImagery(object.lat, object.lon);
  const norad = m.noradId?.trim();
  // Deep links to the exact object when we know its catalogue number, else the
  // provider home pages. CelesTrak = the orbital-element source; N2YO = a live
  // ground-track tracker satellite watchers actually use.
  const celestrak = norad
    ? `https://celestrak.org/satcat/table-satcat.php?CATNR=${encodeURIComponent(norad)}`
    : "https://celestrak.org/";
  const n2yo = norad ? `https://www.n2yo.com/satellite/?s=${encodeURIComponent(norad)}` : "https://www.n2yo.com/";

  return (
    <div style={styles.wrap}>
      <span style={styles.badge}>
        {object.icon && <TypeIcon icon={object.icon} color={object.color ?? "#a78bfa"} size={15} />}
        {object.typeLabel ?? "Satellite"} · live
      </span>
      <figure style={styles.figure}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img style={styles.img} src={img} alt={`Satellite imagery of the ground beneath ${object.label}`} loading="lazy" />
        <figcaption style={styles.cap}>
          Ground beneath ·{" "}
          <a
            href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            Imagery © Esri, Maxar
          </a>
        </figcaption>
      </figure>
      <dl style={styles.stats}>
        <div style={styles.row}><dt style={styles.dt}>NORAD ID</dt><dd style={styles.dd}>{m.noradId ?? "—"}</dd></div>
        <div style={styles.row}><dt style={styles.dt}>Altitude</dt><dd style={styles.dd}>{altKm.toFixed(0)} km</dd></div>
        <div style={styles.row}><dt style={styles.dt}>Speed</dt><dd style={styles.dd}>{(m.velocityKmS ?? 0).toFixed(2)} km/s</dd></div>
        <div style={styles.row}><dt style={styles.dt}>Period</dt><dd style={styles.dd}>{m.periodMin && Number.isFinite(m.periodMin) ? `${m.periodMin.toFixed(1)} min` : "—"}</dd></div>
        <div style={styles.row}><dt style={styles.dt}>Sub-point</dt><dd style={styles.dd}>{object.lat.toFixed(2)}, {object.lon.toFixed(2)}</dd></div>
      </dl>
      <p style={styles.note}>
        Real satellite imagery of the Earth directly beneath {object.label} at the moment you clicked.
        Orbit propagated locally with SGP4 from CelesTrak elements.
      </p>

      {/* ── Source (clickable upstream) ── */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--tn-sat)",
            marginBottom: 6,
          }}
        >
          Source
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a href={celestrak} target="_blank" rel="noreferrer noopener" style={srcLink}>
            {norad ? "CelesTrak record" : "CelesTrak"} ↗
          </a>
          <a href={n2yo} target="_blank" rel="noreferrer noopener" style={srcLink}>
            {norad ? "Track on N2YO" : "N2YO"} ↗
          </a>
        </div>
      </div>
    </div>
  );
}
