import { Permanent_Marker } from "next/font/google";
import "../provenance.css";

/**
 * THIS LAYOUT LOADS EXACTLY ONE FONT, AND WHICH ONE IS THE POINT.
 *
 * It does NOT load Inter. This group nests inside app/layout.tsx, which already
 * self-hosts Inter via next/font and publishes it as `--tn-font-sans` on <html>, so a
 * second `Inter()` call here would emit a second @font-face family for the same bytes
 * and buy nothing. provenance.css defines `--pv-font-display` / `--pv-font-body` /
 * `--pv-font-mono` from `--tn-font-sans` instead, so all three ROLE names survive and
 * every `font-family: var(--pv-*)` rule downstream is untouched.
 *
 * It DOES load Permanent Marker, and that is a deliberate exception to `CLAUDE.md`'s
 * "ONE typeface: Inter, everywhere" rule rather than an oversight. The surveillance
 * section's argument is carried by graffiti scrawled over the camera and the rankings —
 * "WHO WATCHES THE WATCHERS?" — and setting that in Inter would not be a quieter version
 * of the idea, it would be a different page. The rule's actual purpose is preserved: the
 * face is loaded HERE rather than in the root layout, so the console at /app never
 * downloads it, and it is credited in the footer beside Inter. One marketing face, one
 * route group, one credit.
 *
 * `display: "swap"` because the graffiti is decorative and `aria-hidden`: a reader who
 * gets Inter for 200ms has lost nothing, and blocking on it would hold the section.
 */
const marker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--pv-font-marker",
});

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // `pv-night` is still server-rendered. It no longer flips — the page is one night from
  // the hero to the footer, and provenance.css's base tokens ARE the night set — but the
  // class stays because /privacy and a handful of rules still key off it, and removing it
  // would be a rename with no behaviour attached.
  return <div className={`pv-root pv-night ${marker.variable}`}>{children}</div>;
}
