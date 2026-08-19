import { NextResponse } from "next/server";
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
// A sweep across thirteen portals with a politeness delay is minutes, not seconds.
export const maxDuration = 800;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
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
