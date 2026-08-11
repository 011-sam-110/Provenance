import { SIGNALS } from "@/lib/signals/registry";
import { buildStatusReport } from "@/lib/sources/statusReport";
import {
  describeEvidenceScope,
  installUpstreamObserver,
  instrumentSignalRegistry,
  observingSinceMs,
  snapshotEvidence,
} from "@/lib/sources/upstreamEvidence";

export const dynamic = "force-dynamic";

// GET /api/status — the capability report.
//
// For every layer we advertise: is it keyless, key-gated-and-configured,
// key-gated-and-refused, or key-gated-and-locked — and what has actually arrived?
// Without this, a layer that renders nothing because this deployment holds no key
// looks exactly like a layer whose upstream has died, and a visitor reasonably
// concludes the product is broken. It is also what a self-hoster needs: the answer
// to "what do I have to sign up for?".
//
// TWO SIDES, and keeping them apart is the point:
//   • CONFIGURATION — what we hold. Derived from the env bag. Free to compute.
//   • OBSERVATION   — what upstreams actually did with it, and what came back.
//     Read from an in-memory ledger (lib/sources/upstreamEvidence.ts) filled by
//     requests the app was already making.
//
// LATENCY. This handler does NOT probe anything. Adding a per-layer health check
// here would mean ~37 upstream round trips per hit, which is a denial-of-service
// gun pointed at our own providers and a multi-second endpoint. Instead the two
// installs below are one-time, idempotent wrappers whose per-event cost is a
// hostname Map lookup and an array length; this handler then reads the resulting
// Map. Measured against a local production build (`next start`, 20 sequential
// curls, warm): mean 6.0 ms, median 5.9 ms, max 8.4 ms — that is JSON for 37 layers
// and 5 capabilities, with zero network calls on the request path.
//
// ORDERING, stated because it bounds what the numbers mean. Instrumentation
// installs when this route module is first loaded. Next 15's production server
// preloads route entries at boot (experimental.preloadEntriesOnStart, on by default
// in next-server.js), so it is live before the first request: verified on a fresh
// `next start` whose very FIRST request was /api/signals/acled — that fetch, its row
// count and its upstream 403 were all recorded. Where preload does not happen, a
// layer fetched before this module loads is simply absent from the ledger and
// reports `flow.observed: false` — the honest reading, self-healing from that
// layer's next refresh.
//
// SECRETS: this publishes env var NAMES, hostnames, HTTP statuses, timestamps and
// counts. It never reads, returns, logs or hints at a VALUE — the names are already
// documented in docs/API_KEYS.md, and telling someone that ACLED_EMAIL is unset
// reveals nothing.
//
// EVIDENCE IS PER-PROCESS, AND PRODUCTION IS FRAGMENTED. The ledger this reads is
// module state (lib/sources/upstreamEvidence.ts) filled by requests THIS instance
// happened to serve. On a serverless deployment the request that talked to an
// upstream and the request reading this report are usually different processes,
// so a refusal that genuinely happened commonly never appears here — verified in
// prod 2026-08-11 (see upstreamEvidence.ts's "cross-instance honesty" section for
// the repro and why cross-instance persistence via unstable_cache was rejected:
// it has no write/merge primitive, and forcing one would let a less-informed
// instance silently erase a real refusal — a fabricated recovery, not a fix).
// `evidenceScope` below states this on every response so a reader of the raw
// JSON — not just the code comments — cannot mistake "this process observed
// nothing" for "this credential was checked and is fine".
installUpstreamObserver();
instrumentSignalRegistry(SIGNALS);

export async function GET() {
  const now = Date.now();
  const evidence = snapshotEvidence();
  const observingSince = observingSinceMs();
  const report = buildStatusReport(SIGNALS, process.env, now, {
    evidence,
    observingSince,
  });
  return Response.json(
    {
      ...report,
      // Sibling to `report.evidence` (which describes how to read a flow block),
      // this describes how much to trust the ledger itself was ever populated —
      // see describeEvidenceScope's caveat for the serverless-fragmentation risk.
      evidenceScope: describeEvidenceScope(evidence, observingSince, now),
    },
    {
      // Configuration is deployment-scoped, but the flow block moves with every
      // refresh, so the old 30s/120s window would have served a reader a two-minute-
      // old picture of what is arriving. Short enough to be current, long enough to
      // keep a hot-linked status page off the origin.
      headers: { "cache-control": "public, max-age=10, stale-while-revalidate=30" },
    },
  );
}
