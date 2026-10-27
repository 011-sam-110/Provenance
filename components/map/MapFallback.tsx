// What a map page shows when the browser cannot draw the map.
//
// MapLibre needs WebGL, and without it /eye and /app used to show Next's
// "Application error" page (measured 2026-10-27, see lib/map/webgl.ts). This says
// what happened in plain words and offers the two things that work in any browser:
// the camera directory, which is server-rendered, and the source code. The source
// link is not decoration: this plate replaces the frame that carried it, and AGPL-3.0
// section 13 asks every page to offer the source.
//
// No picture of the scene. A stored still of the satellite imagery would be a copy of
// Esri's World Imagery, and nobody has checked its terms for that.

import { BRAND } from "@/lib/brand";
import styles from "./MapFallback.module.css";

export const NO_WEBGL_TITLE = "The map can't start in this browser";

export default function MapFallback({ tone, place }: { tone: "dark" | "light"; place?: string }) {
  return (
    <section className={styles.plate} data-tone={tone} data-map-fallback role="alert">
      <div className={styles.body}>
        {place && <p className={styles.place}>{place}</p>}
        <h2 className={styles.title}>{NO_WEBGL_TITLE}</h2>
        <p>It needs WebGL, which this browser has switched off or does not have.</p>
        <p>To see the map, switch on hardware acceleration in the browser&apos;s settings, then reload this page.</p>
        <p>The traffic cameras work in any browser.</p>
        <div className={styles.acts}>
          <a className={styles.primary} href="/cameras">
            Browse every traffic camera
          </a>
          <a className={styles.secondary} href={BRAND.repoUrl} target="_blank" rel="noreferrer noopener">
            Source code
          </a>
        </div>
      </div>
    </section>
  );
}
