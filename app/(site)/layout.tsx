import "../provenance.css";

// THIS LAYOUT NO LONGER LOADS A FONT, AND THAT IS THE POINT.
//
// It used to load three, all open source — which mattered on a page whose argument is
// that open source is what makes a number checkable: Archivo for display (with its
// `wdth` axis, so the headlines sat at ~118), Public Sans for body, IBM Plex Mono for
// the utility role. The contrast axis was WIDTH — an expanded display against a
// normal-width body against a mono. That axis is gone by request; everything is Inter.
//
// They lived HERE rather than in the root layout so the console at /app never
// downloaded the marketing faces. With one shared family that argument inverts: this
// group nests inside app/layout.tsx, which already self-hosts Inter and publishes it
// as `--tn-font-sans` on <html>, so a second `Inter()` call here would emit a second
// @font-face family for the same bytes and buy nothing. provenance.css defines
// `--pv-font-display` / `--pv-font-body` / `--pv-font-mono` from `--tn-font-sans`
// instead, so all three ROLE names survive and every `font-family: var(--pv-*)` rule
// downstream is untouched.
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
    <div className="pv-root pv-night pv-bar-night">{children}</div>
  );
}
