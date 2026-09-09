// Imported HERE and not from globals.css on purpose, for two reasons. It is a
// console concern, so the route group is where it belongs and the marketing
// site cannot pick it up by accident. And a nested layout's CSS loads after the
// root layout's, which is the only way this file wins a specificity tie against
// the rules it is adding motion to — `@import` can only ever go at the top of
// globals.css, i.e. the losing end.
import "../console-motion.css";
import ReactDOM from "react-dom";
import { basemapWarmup, DEFAULT_BASEMAP } from "@/lib/basemaps";

/**
 * The console's only job at the layout level: start the basemap chain with the
 * HTML instead of after hydration.
 *
 * WHAT THE WAITING ACTUALLY LOOKS LIKE. Measured cold-cache on desktop against
 * production, worker-aware (a page-session CDP Network capture never sees
 * MapLibre's vector-tile fetches — the worker issues them, so `scripts/loadprof.mjs`
 * is blind to them and Playwright's `page.on("request")` is not):
 *
 *   canvas 0.67 s → style 1.0 s → TileJSON + sprite JSON + sprite PNG →
 *   first four tiles 2.3–2.4 s → `load` 2.7 s → first idle 3.0 s
 *
 * Nothing before 1.0 s is network-bound. The map canvas lives inside StageHost
 * behind `dynamic(() => import("@/components/WorldMap"))`, so the browser cannot
 * learn that `tiles.openfreemap.org` exists until React has hydrated, the chunk has
 * arrived and MapLibre has constructed a Map. The first request to that host then
 * pays DNS + TCP + TLS before it transfers a byte, and every later one —
 * TileJSON, sprite, glyphs, tiles — is queued behind it.
 *
 * `preconnect` moves the handshake to parse time; `preload` moves a style
 * document itself there. Both are hints: if the console is never reached, the
 * cost is one unused connection.
 *
 * THE MEASUREMENT ABOVE WAS TAKEN ON A VECTOR DEFAULT, and the default is now
 * `satellite`, so the shape of the wait has changed even though the fix has not.
 * There is no style document to fetch for a raster basemap — the style is inline
 * — so the 1.0 s style hop is simply gone. What remains on the critical path is
 * the imagery host and, for the country names WE draw over a style that ships
 * none of its own, the glyph host. Those are the two origins warmed here.
 *
 * DERIVED FROM THE REGISTRY, NEVER TYPED. `basemapWarmup(DEFAULT_BASEMAP)` reads
 * whatever the current default is and returns the right warm-up for its kind.
 * Writing a URL out here would warm the wrong thing the day that constant moves,
 * and — this is the part worth stating — NOTHING WOULD FAIL. The hint would go
 * unused and the real fetch would happen exactly as late as it does with no hint
 * at all. That silence is why tests/unit/map-first-paint.test.ts holds the line
 * on this file reading the registry rather than on any particular URL.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // `basemapWarmup` derives BOTH halves from the registry entry, which is what
  // keeps this correct across a change of default rather than only for a vector
  // one. This used to be an inline `typeof style === "string"` guard, and that
  // guard had a failure mode worth naming: it did not break when the default
  // became a raster basemap, it just silently warmed NOTHING while still reading
  // like an optimisation. A raster basemap has a real warm-up — its tile host and
  // its glyph host — and neither is discoverable until MapLibre is constructed.
  const { preloadStyle, preconnect } = basemapWarmup(DEFAULT_BASEMAP);

  // `anonymous` because that is how MapLibre asks for it: a cross-origin fetch
  // with default credentials sends none, and a preload whose CORS mode does not
  // match the real request is not reused — the browser fetches the document twice
  // and the hint has made things worse. Verified by counting requests to the
  // style URL on a cold load: it must stay at one.
  for (const origin of preconnect) ReactDOM.preconnect(origin, { crossOrigin: "anonymous" });
  if (preloadStyle) ReactDOM.preload(preloadStyle, { as: "fetch", crossOrigin: "anonymous" });
  return children;
}
