import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow an isolated build dir so a verification `next build` doesn't fight a
  // concurrently-running `next dev` over `.next` (defaults to `.next`).
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
