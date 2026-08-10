import { parseFcdoAdvisory, type FcdoPayload, type AdvisoryView } from "@/lib/geo/travelAdvisory";
import { fcdoSlug } from "@/lib/geo/fcdoSlugs.data";

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

interface Cached {
  at: number;
  view: AdvisoryView | null;
  reason?: string;
}
const cache = new Map<string, Cached>();
const TTL_MS = 6 * 60 * 60 * 1000; // the FCDO updates continuously but not by the minute
const UA = "OpenData/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export async function GET(req: Request) {
  const iso2 = (new URL(req.url).searchParams.get("iso2") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) {
    return Response.json({ advisory: null, reason: "Needs a two-letter country code." });
  }

  const slug = fcdoSlug(iso2);
  if (!slug) {
    return Response.json({
      advisory: null,
      reason: "The UK FCDO does not publish travel advice for this territory.",
    });
  }

  const hit = cache.get(iso2);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json({ advisory: hit.view, reason: hit.reason });
  }

  let view: AdvisoryView | null = null;
  let reason: string | undefined;
  try {
    const res = await fetch(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      view = parseFcdoAdvisory((await res.json()) as FcdoPayload, iso2);
      if (!view) reason = "The FCDO page for this country could not be read.";
    } else {
      reason = `The FCDO returned HTTP ${res.status}.`;
    }
  } catch {
    // Keep last-good rather than flapping to null on one bad request.
    view = hit?.view ?? null;
    reason = view ? undefined : "Could not reach the FCDO.";
  }
  cache.set(iso2, { at: Date.now(), view, reason });
  return Response.json({ advisory: view, reason });
}
