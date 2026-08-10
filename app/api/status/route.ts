import { SIGNALS } from "@/lib/signals/registry";
import { buildStatusReport } from "@/lib/sources/statusReport";

export const dynamic = "force-dynamic";

// GET /api/status — the capability report.
//
// For every layer we advertise: is it keyless, key-gated-and-configured, or
// key-gated-and-locked? Without this, a layer that renders nothing because this
// deployment holds no key looks exactly like a layer whose upstream has died, and
// a visitor reasonably concludes the product is broken. It is also what a
// self-hoster needs: the answer to "what do I have to sign up for?".
//
// SECRETS: this publishes env var NAMES and a present/absent boolean. It never
// reads, returns, logs or hints at a VALUE — the names are already documented in
// docs/API_KEYS.md, and telling someone that ACLED_EMAIL is unset reveals nothing.
export async function GET() {
  const report = buildStatusReport(SIGNALS, process.env, Date.now());
  return Response.json(report, {
    // Deployment-scoped and cheap to compute, but it must not get pinned in the
    // CDN across a redeploy that adds a key.
    headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
