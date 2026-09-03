import { Archivo, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "../provenance.css";

// The landing page's three faces, all open source — which matters on a page whose
// argument is that open source is what makes a number checkable. The typography
// should not be the one proprietary thing on it.
//
// The contrast axis here is WIDTH, not serif-vs-sans: an expanded display against
// a normal-width body against a mono utility face. Archivo is loaded with its wdth
// axis so the headlines can sit at ~118 without a fake horizontal scale.
//
// These live in the (site) group's layout, not the root, so the console at /app
// never downloads them.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--pv-font-display",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--pv-font-body",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--pv-font-mono",
  display: "swap",
});

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // `pv-night` is server-rendered because the page opens on the night hero. It is
  // ScrollGround's to own from the first scroll frame onward, but leaving it off
  // the initial HTML meant every cold load painted a bone instrument bar and
  // daylight type over a black stage until hydration corrected it.
  //
  // `pv-bar-night` joins it for the same reason and by the same argument. It is
  // now the class that decides whether the bar has a background AT ALL, so off
  // the initial HTML every cold load flashed a full glass plate across the black
  // stage until hydration. Safe for the rest of the group: /privacy renders no
  // `.pv-bar`, so the class matches nothing there. A future (site) page with a
  // bar but NO hero would need to clear it — ScrollGround only removes it when a
  // [data-pv-hero] exists.
  return (
    <div
      className={`pv-root pv-night pv-bar-night ${archivo.variable} ${publicSans.variable} ${plexMono.variable}`}
    >
      {children}
    </div>
  );
}
