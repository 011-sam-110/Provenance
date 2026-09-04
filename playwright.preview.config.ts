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
const token = process.env.VERCEL_OIDC_TOKEN;
const baseURL = process.env.PREVIEW_URL;

if (!baseURL) throw new Error("PREVIEW_URL is not set");
if (!token) throw new Error("VERCEL_OIDC_TOKEN is not set — run under `vercel env run`");

export default defineConfig({
  testDir: "./tests/e2e",
  // A remote deployment is slower than localhost and the map pulls real tiles.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL,
    extraHTTPHeaders: { "x-vercel-trusted-oidc-idp-token": token },
  },
});
