import { defineConfig } from "@playwright/test";

// Runs the repo's own e2e specs against a VERCEL PREVIEW instead of a local
// server. The preview is a real production build, made by Vercel, so this costs
// the machine no `next build`, no dev server, no disk and no commit charge —
// which is the whole point tonight.
//
// Deliberately NOT the repo's playwright.config.ts: that one carries a
// `webServer` block whose command is `npm run build && npm run start`, and
// pointing it at a remote URL would still trigger the local build it exists to
// avoid. This config has no webServer at all.
//
// The header is how a protected preview is reached. Per the
// access-protected-vercel-deployment skill, `x-vercel-trusted-oidc-idp-token`
// carries the caller's short-lived development token; it is read from the
// environment so it is never written down, and the run is wrapped in
// `vercel env run` so the value never appears in a command line either. Do NOT
// substitute `x-vercel-oidc-token` — different header, different purpose. And
// do not reach for disabling Deployment Protection: the control is correct.
//
// THE HEADER CANNOT BE USED BY A SPEC THAT ASSERTS ON THE MAP. Setting any custom
// request header makes the browser CORS-preflight cross-origin requests, and
// tiles.openfreemap.org — the default basemap, lib/basemaps.ts — answers 405 to
// OPTIONS. The basemap then dies silently, and an unloaded map draws nothing, which
// is indistinguishable from a correctly filtered one. Measured twice.
//
// So there is a second way in: PREVIEW_SHARE_URL, a `_vercel_share` link, which a
// spec visits once in a beforeEach to set an auth COOKIE and sets no header at all.
// When it is set, the header is omitted. Runs that already pass VERCEL_OIDC_TOKEN are
// unaffected.
const token = process.env.VERCEL_OIDC_TOKEN;
const share = process.env.PREVIEW_SHARE_URL;
const baseURL = process.env.PREVIEW_URL;

if (!baseURL) throw new Error("PREVIEW_URL is not set");
if (!token && !share) {
  throw new Error(
    "no way in: set VERCEL_OIDC_TOKEN (under `vercel env run`), or PREVIEW_SHARE_URL " +
      "for specs that assert on what the map draws",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  // A remote deployment is slower than localhost and the map pulls real tiles.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL,
    ...(share
      ? {}
      : { extraHTTPHeaders: { "x-vercel-trusted-oidc-idp-token": token as string } }),
  },
});
