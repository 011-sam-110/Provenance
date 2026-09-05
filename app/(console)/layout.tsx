import ReactDOM from "react-dom";
import { BASEMAPS, DEFAULT_BASEMAP } from "@/lib/basemaps";

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
 * `preconnect` moves the handshake to parse time; `preload` moves the style
 * document itself there. Both are hints: if the console is never reached, or the
 * visitor arrives on a raster basemap, the cost is one unused connection.
 *
 * DERIVED FROM THE REGISTRY, NEVER TYPED. DEFAULT_BASEMAP is `streets`
 * (OpenFreeMap Liberty) and not the `positron` the code around it keeps calling
 * "the calm light default" — ConsoleShell's skin↔basemap sync only ever swaps
 * between `dark` and `positron`, so it does not fire on a first load and `streets`
 * really is the first style fetched. Writing the URL out here would warm the wrong
 * document the day that constant moves, and nothing would fail: the preload would
 * go unused and the real style would be fetched exactly as late as it is today.
 * tests/unit/map-first-paint.test.ts holds that line.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { style } = BASEMAPS[DEFAULT_BASEMAP];
  // The raster entries (`satellite`, `topo`) carry an inline StyleSpecification
  // rather than a URL. There is no document to fetch for those, and their tile
  // hosts are a different origin from the vector styles' — so this warms nothing
  // rather than warming the wrong thing.
  if (typeof style === "string") {
    const { origin } = new URL(style);
    // `anonymous` because that is how MapLibre asks for it: a cross-origin fetch
    // with default credentials sends none, and a preload whose CORS mode does not
    // match the real request is not reused — the browser fetches the style twice
    // and the hint has made things worse. Verified by counting requests to the
    // style URL on a cold load: it must stay at one.
    ReactDOM.preconnect(origin, { crossOrigin: "anonymous" });
    ReactDOM.preload(style, { as: "fetch", crossOrigin: "anonymous" });
  }
  return children;
}
