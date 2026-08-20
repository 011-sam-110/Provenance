import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCandidates, readLedger } from "@/lib/discovery/store";
import type { AdmittedFeed } from "@/lib/discovery/types";
import { PROMOTED_FILE_HEADER } from "@/lib/discovery/devOnly";

/**
 * Write `lib/sources/discovered.data.ts` from the admitted candidates.
 *
 * DEV ONLY (404 in production). This is the step that puts a discovered network on
 * the live map, and it is deliberately a separate, explicit action rather than a side
 * effect of the last approval — the file it writes is source code, and the person who
 * triggers it should be about to read the diff.
 *
 * WHAT IT REFUSES. A feed with an `admit` verdict but no camera judged good is not
 * written. That combination means somebody pressed admit without looking, and the
 * review record on the row would then say `sampled: 0`, which is a claim about
 * diligence that nobody made. It is easier to catch here than in review.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  let by = "";
  try {
    by = String(((await req.json()) as Record<string, unknown>).by ?? "").trim();
  } catch {
    /* handled below */
  }
  if (!by) {
    return NextResponse.json({ error: "by is required — an admission needs an author." }, { status: 400 });
  }

  const candidates = readCandidates();
  const ledger = readLedger();
  const admittedIds = ledger.feeds.filter((f) => f.verdict === "admit").map((f) => f.candidateId);

  const feeds: AdmittedFeed[] = [];
  const skipped: Array<{ id: string; why: string }> = [];

  for (const id of admittedIds) {
    const candidate = candidates.find((c) => c.id === id);
    if (!candidate) {
      skipped.push({ id, why: "admitted, but no candidate with that id is in the queue any more" });
      continue;
    }
    const verdicts = ledger.cameras.filter((v) => v.candidateId === id);
    const good = verdicts.filter((v) => v.verdict === "good");
    if (good.length === 0) {
      skipped.push({ id, why: "admitted with no camera judged good — somebody pressed admit without looking" });
      continue;
    }
    if (candidate.gates.some((g) => g.status === "fail")) {
      skipped.push({ id, why: "a gate fails: " + candidate.gates.filter((g) => g.status === "fail").map((g) => g.gate).join(", ") });
      continue;
    }
    const feedVerdict = ledger.feeds.find((f) => f.candidateId === id);
    const blocked = verdicts
      .filter((v) => v.verdict === "bad-image" || v.verdict === "bad-pin" || v.verdict === "not-a-camera")
      .map((v) => v.nativeId);
    feeds.push({
      ...candidate.descriptor,
      // The reviewer's wording wins over anything the catalogue offered.
      ...(feedVerdict?.name ? { name: feedVerdict.name } : {}),
      ...(feedVerdict?.attribution ? { attribution: feedVerdict.attribution } : {}),
      review: {
        by,
        at: feedVerdict?.at ?? new Date().toISOString(),
        sampled: verdicts.length,
        good: good.length,
        note: feedVerdict?.reason,
      },
      ...(blocked.length ? { blocked } : {}),
    });
  }

  const body = PROMOTED_FILE_HEADER + JSON.stringify(feeds, null, 2) + ";\n";
  writeFileSync(join(process.cwd(), "lib", "sources", "discovered.data.ts"), body, "utf8");

  return NextResponse.json({
    ok: true,
    written: feeds.length,
    countries: [...new Set(feeds.map((f) => f.country))].sort(),
    skipped,
    // Said out loud because the count is pinned by two tests and the person who just
    // changed it should know that before they see a red suite and assume they broke it.
    note:
      feeds.length > 0
        ? "CAMERA_FEED_COUNT is now 14 + " + feeds.length + ". claude-md-counts and readme-counts will fail until CLAUDE.md and README.md state the new figures — that is the guard working, not a regression."
        : undefined,
  });
}
