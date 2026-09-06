import { parseFcdoAdvisory, type FcdoPayload, type AdvisoryView } from "@/lib/geo/travelAdvisory";
import { fcdoSlug } from "@/lib/geo/fcdoSlugs.data";
import { edgeCacheHeaders } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

// Country travel advisory — GET /api/advisory?iso2=XX.
//
// Was travel-advisory.info, which has stopped resolving: production returned
// {"advisory":null} for every country while the README still advertised the
// section as live. Now the UK FCDO's own advice on gov.uk — keyless, no signup,
// government primary source.
//
// Dormant-safe: any failure responds { advisory: null } (200), never a 5xx, and
// the dossier renders a labelled placeholder. `reason` says WHY, so "the FCDO
// publishes no advice for this territory" is distinguishable from "the lookup
// failed" — the distinction the old dead upstream destroyed.
//
// One government's advice to its own nationals is not a neutral world risk index.
// The payload carries `issuer` so the UI can say whose advice it is.
//
// EDGE CACHE. This route shipped with no Cache-Control at all, so it took Vercel's
// `max-age=0, must-revalidate` default and missed on every request - 8,479
// invocations in a production day for advice the FCDO revises on the order of weeks.
// The edge TTL is the SAME TTL_MS the in-process cache uses, so the two expire
// together. A DEGRADED answer is never cached, for the reason /api/signals/<id>
// gives: a cached failure keeps asserting a specific reason for the whole window,
// so a brief FCDO outage would be reported for six hours after it ended.

interface Cached {
  at: number;
  view: AdvisoryView | null;
  reason?: string;
  /** Whether the read that produced this entry actually succeeded. */
  ok: boolean;
}
const cache = new Map<string, Cached>();
const TTL_MS = 6 * 60 * 60 * 1000; // the FCDO updates continuously but not by the minute
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** Edge cache for a good read; nothing at all for a degraded one. */
function cacheHeaders(ok: boolean): Record<string, string> {
  return ok ? edgeCacheHeaders(TTL_MS) : { "Cache-Control": "no-store" };
}

export async function GET(req: Request) {
  const iso2 = (new URL(req.url).searchParams.get("iso2") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) {
    // Deterministic refusals - a pure function of the input and of committed slug
    // data - so they are as cacheable as a real answer.
    return Response.json(
      { advisory: null, reason: "Needs a two-letter country code." },
      { headers: edgeCacheHeaders(TTL_MS) },
    );
  }

  const slug = fcdoSlug(iso2);
  if (!slug) {
    return Response.json(
      {
        advisory: null,
        reason: "The UK FCDO does not publish travel advice for this territory.",
      },
      { headers: edgeCacheHeaders(TTL_MS) },
    );
  }

  const hit = cache.get(iso2);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json(
      { advisory: hit.view, reason: hit.reason },
      { headers: cacheHeaders(hit.ok) },
    );
  }

  let view: AdvisoryView | null = null;
  let reason: string | undefined;
  let ok = true;
  try {
    const res = await fetch(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      view = parseFcdoAdvisory((await res.json()) as FcdoPayload, iso2);
      if (!view) {
        reason = "The FCDO page for this country could not be read.";
        ok = false;
      }
    } else {
      reason = `The FCDO returned HTTP ${res.status}.`;
      ok = false;
    }
  } catch {
    // Keep last-good rather than flapping to null on one bad request.
    view = hit?.view ?? null;
    reason = view ? undefined : "Could not reach the FCDO.";
    ok = false;
  }
  cache.set(iso2, { at: Date.now(), view, reason, ok });
  return Response.json({ advisory: view, reason }, { headers: cacheHeaders(ok) });
}
