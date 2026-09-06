import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * DEEP-LINK SHIM. Links and OG cards already shared in the wild were minted against
   * `/` carrying `?v=` (board) or `?c=` (layout). The console now lives at /app, so
   * those are forwarded there with the query intact — without this, every link anyone
   * has already posted lands on marketing copy instead of the map they sent.
   *
   * WHY IT LIVES HERE AND NOT IN THE PAGE. It used to be a `searchParams` read inside
   * app/(site)/page.tsx, and that is what made `/` dynamic: Next opts a page into
   * dynamic rendering the moment it accepts `searchParams`, for EVERY request, not
   * just the ones carrying a query. So the landing page paid a full React server
   * render per visitor — never cached, `X-Vercel-Cache: MISS` forever — to serve a
   * redirect that almost nobody triggers. The routing layer applies these rules with
   * no function invocation at all, so the common case now costs nothing.
   *
   * TWO RULES, NOT ONE. `has` entries are AND-ed within a rule, so a single rule
   * listing both keys would only fire for a link carrying `?v=` AND `?c=`.
   *
   * The original query survives: Next's redirect handler spreads the incoming query
   * into the destination before anything else, so unlisted keys are preserved too.
   */
  async redirects() {
    return ["v", "c"].map((key) => ({
      source: "/",
      has: [{ type: "query" as const, key }],
      destination: "/app",
      // Temporary. /app is where the console lives today; a 308 would be cached
      // permanently by every browser that ever followed one of these links.
      permanent: false,
    }));
  },
  // Allow an isolated build dir so a verification `next build` doesn't fight a
  // concurrently-running `next dev` over `.next` (defaults to `.next`).
  /**
   * CACHE POLICY FOR `public/`.
   *
   * MEASURED, 2026-09-06, one production day: 1,083,357 static-asset requests against
   * 8,717 `/app` loads — 124 per page load, and 78% of ALL traffic to the site.
   * `/icons/icon-192.png` alone was fetched 22,242 times.
   *
   * The cause is that Vercel serves `public/` with `max-age=0, must-revalidate`, so a
   * browser re-asks for every asset on every load. It gets a 304 and no bytes move,
   * which is why this never showed up as bandwidth — but each conditional request is
   * still a billed edge request AND a billed observability event, and observability
   * was 46% of the bill.
   *
   * WHY `stale-while-revalidate` AND NOT `immutable`. Nothing under `public/` is
   * content-hashed — `/webcams/t/r01332311.json` keeps its name when the harvest is
   * re-run — so `immutable` would pin a stale file for the whole max-age with no way
   * to push a correction. SWR gets essentially the same saving (the traffic is repeat
   * loads and long-lived tabs, all inside a day) while a change still propagates.
   *
   * `/sw.js` is deliberately ABSENT: a service worker that a browser will not re-check
   * cannot be updated, and this one owns the offline shell.
   */
  async headers() {
    // Assets that change only on deploy and whose staleness is cosmetic.
    const assets = "public, max-age=86400, stale-while-revalidate=604800";
    // Harvested data. Same mechanism, shorter leash: a re-harvest should land the
    // same day, not the same week.
    const data = "public, max-age=3600, stale-while-revalidate=86400";

    const rule = (source: string, value: string) => ({
      source,
      headers: [{ key: "Cache-Control", value }],
    });

    return [
      rule("/icons/:path*", assets),
      rule("/textures/:path*", assets),
      rule("/sky/:path*", assets),
      rule("/brand/:path*", assets),
      rule("/favicon.svg", assets),
      rule("/geo/:path*", data),
      rule("/webcams/:path*", data),
    ];
  },
  distDir: process.env.TN_DIST_DIR || ".next",
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // satellite.js v7's barrel re-exports a WASM threading runtime
      // (dist/wasm/*) that imports `node:worker_threads` / `node:module`.
      // We only use the classic synchronous SGP4 path (twoline2satrec +
      // propagate), so that runtime is bundled-but-never-executed. Strip the
      // `node:` scheme and stub those built-ins in the BROWSER bundle so
      // webpack can resolve them; nothing at runtime ever touches them.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        worker_threads: false,
        module: false,
        // node:http2, reached via lib/http/h2.ts <- lib/sources/actpr.ts. The plugin
        // above rewrites `node:http2` to `http2`, which has no browser resolution, so
        // #136 (Puerto Rico) failed THREE production deploys with "Can't resolve
        // 'http2'" while `tsc --noEmit` and all 2,445 tests stayed green — vitest runs
        // in a node environment, where the import resolves fine. Production silently
        // went on serving the previous build.
        //
        // THIS LINE IS A GUARD, NOT THE FIX, and the distinction matters. The actual
        // defect is that components/shell/ConsoleShell.tsx is a client component and
        // imports CAMERA_FEED_COUNT from the adapter registry, which drags all ~39
        // adapter modules into the BROWSER bundle for the sake of one integer.
        // CLAUDE.md already forbids exactly this for the hero globe. Stubbing http2
        // stops the build failing; it does not stop the adapters being shipped to the
        // browser. Fix that separately — and do not read this entry as evidence the
        // problem is handled.
        http2: false,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
      // satellite.js's barrel also re-exports dist/wasm/**, whose runtime pulls
      // `#wasm-multi-thread` -> wasm-build/pthreads-release/index.js. That file
      // uses TOP-LEVEL AWAIT, which makes every module that statically imports
      // satellite.js an async module. The async-ness propagates up the graph to
      // components/WorldMap.tsx, so its `next/dynamic` chunk resolves to a
      // component that never finishes mounting: the centre stage stayed blank
      // with NO console error and NO failed request. We only ever use the
      // classic synchronous SGP4 path (twoline2satrec + propagate), so cut the
      // WASM entry points out of the browser bundle completely.
      config.resolve.alias = {
        ...config.resolve.alias,
        "#wasm-multi-thread": false,
        "#wasm-single-thread": false,
      };
    }
    return config;
  },
};

export default nextConfig;
