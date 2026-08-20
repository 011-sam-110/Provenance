import { NextResponse } from "next/server";
import { isProduction } from "@/lib/discovery/devOnly";
import { runDiscovery } from "@/lib/discovery/run";
import { readCandidates, readLedger, writeCandidates } from "@/lib/discovery/store";
import { getRegistry } from "@/lib/sources/registry";

/**
 * Start a discovery run and write the queue.
 *
 * DEV ONLY (404 in production).
 *
 * MERGING, NOT REPLACING. A run that overwrote the queue would silently discard the
 * candidates a reviewer had already ruled on, and then re-propose them next time
 * under the same id — so a decision would never stick. Candidates already carrying a
 * feed verdict are kept as they are; everything else is refreshed, because a stale
 * sample URL is a picture that will not load when someone tries to review it.
 */

export const dynamic = "force-dynamic";

// NO maxDuration, deliberately, and this cost a deployment to learn.
//
// A sweep across thirteen portals with a politeness delay takes minutes, so this route
// declared `maxDuration = 800`. The build compiled, typechecked and generated every
// page — and then the deployment failed at "Deploying outputs" with nothing in the
// build log, because the value is above what the plan allows and that is enforced when
// the function config is applied, not when it is compiled.
//
// The right fix is to delete it rather than lower it. This route returns 404 in
// production, so it has no production execution to bound; the only place it runs is a
// dev server, where the setting does nothing at all. A limit that only ever applies
// where the route cannot run is not a limit, it is a way to break a deploy.

/**
 * A GET to a POST-only route is answered by Next with 405 before any handler runs, so
 * these three routes said "method not allowed" in production while every other admin
 * route said 404. That is a small thing and it is still a difference between what the
 * /privacy page claims and what the deployment does: the page tells a reader that every
 * route under here returns 404 and invites them to check. Two of the three verbs
 * disagreed.
 *
 * Nothing was reachable either way -- the POST 404s -- and the route's existence is in a
 * public repository anyway, so this is not a leak. It is a sentence on a page whose only
 * value is being exactly true, and the cheaper fix was to correct the page. Correcting
 * the deployment is the right one.
 */
export async function GET() {
  return new Response(null, { status: 404 });
}

export async function POST(req: Request) {
  if (isProduction()) {
    return new NextResponse(null, { status: 404 });
  }

  let opts: Record<string, unknown> = {};
  try {
    opts = (await req.json()) as Record<string, unknown>;
  } catch {
    // A run with no body is the default sweep, which is a reasonable thing to want.
  }

  // The overlap gate needs to know what is already served. If the registry cannot be
  // reached the run still goes ahead, and the gate says it did not check rather than
  // quietly reporting no overlap — a missing check that reads as a pass is how a
  // duplicate network gets admitted.
  let existing: Awaited<ReturnType<typeof getRegistry>> = [];
  let registryNote: string | undefined;
  try {
    existing = await getRegistry();
  } catch {
    registryNote = "The live registry could not be read, so the overlap gate did not run this time.";
  }

  const log: string[] = [];
  const report = await runDiscovery({
    portals: Array.isArray(opts.portals) ? (opts.portals as string[]) : undefined,
    socrata: opts.socrata !== false,
    arcgis: opts.arcgis !== false,
    limit: typeof opts.limit === "number" ? opts.limit : 40,
    existing: existing.map((c) => ({ id: c.id, source: c.source, lat: c.lat, lon: c.lon })),
    signal: req.signal,
    onProgress: (line) => log.push(line),
  });

  const ledger = readLedger();
  const decided = new Set(ledger.feeds.map((f) => f.candidateId));
  const previous = readCandidates();
  const kept = previous.filter((c) => decided.has(c.id));
  const fresh = report.candidates.filter((c) => !decided.has(c.id));
  const merged = [...kept, ...fresh];
  writeCandidates(merged);

  return NextResponse.json({
    ok: true,
    report: { ...report, candidates: undefined },
    counts: report.counts,
    perPortal: report.perPortal,
    queued: fresh.length,
    keptDecided: kept.length,
    registryNote,
    log,
  });
}
