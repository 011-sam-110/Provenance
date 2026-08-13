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
  return (
    <div className={`pv-root pv-night ${archivo.variable} ${publicSans.variable} ${plexMono.variable}`}>
      {children}
    </div>
  );
}
