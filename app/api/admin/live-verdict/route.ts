import { NextResponse } from "next/server";
import { isProduction } from "@/lib/discovery/devOnly";
import { MIN_PRODUCING_MS, type RejectedCamera } from "@/lib/liveness/ledger";
import {
  clearVerdict,
  pending,
  readLiveLedger,
  readQueue,
  recordAdmission,
  recordRejection,
  writeLiveLedger,
} from "@/lib/liveness/queue";

/**
 * Record one per-camera live verdict.
 *
 * DEV ONLY (404 in production). The ledger is a file in the working tree, so a review
 * session ends with a diff showing which cameras were admitted and on what evidence.
 *
 * THE ONE RULE THIS ROUTE EXISTS TO ENFORCE. An admission must carry `producingMs`, and
 * it must be at least MIN_PRODUCING_MS. The deck also keeps its admit control locked
 * until then, but a client-side lock is a convenience, not a guarantee — anything that
 * can POST could otherwise write "a human watched this" about a stream nobody watched.
 * The whole product claim rests on that being impossible rather than merely discouraged,
 * so the check lives on the write path.
 *
 * `by` is required and not defaulted, for the reason /api/admin/verdict gives: a verdict
 * with no author is a verdict nobody is answerable for.
 */

export const dynamic = "force-dynamic";

const REJECT_REASONS = new Set(["dead", "wrong-pin", "not-a-camera", "unsure", "feed-abandoned"]);

/** A GET here 404s like every other admin route, so /privacy stays exactly true. */
export async function GET() {
  return new Response(null, { status: 404 });
}

export async function POST(req: Request) {
  if (isProduction()) return new NextResponse(null, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body was not JSON." }, { status: 400 });
  }

  const by = String(body.by ?? "").trim();
  if (!by) return NextResponse.json({ error: "by is required — a verdict needs an author." }, { status: 400 });

  const feed = String(body.feed ?? "");
  if (!feed) return NextResponse.json({ error: "feed is required." }, { status: 400 });

  const signedAt = new Date().toISOString();
  let ledger = readLiveLedger();

  // Shift+X: reject everything still pending in this feed. Judgment, not data entry —
  // when nine of a feed's first ten cameras are dead, swiping the remaining four
  // hundred one at a time tells you nothing you do not already know.
  if (body.kind === "abandon-feed") {
    const queue = readQueue();
    const rest = pending(queue, ledger).filter((c) => c.feed === feed);
    for (const cam of rest) {
      ledger = recordRejection(ledger, {
        cameraId: cam.cameraId,
        feed,
        reason: "feed-abandoned",
        signedAt,
      });
    }
    writeLiveLedger(ledger);
    return NextResponse.json({ ok: true, abandoned: rest.length });
  }

  const cameraId = String(body.cameraId ?? "");
  if (!cameraId) return NextResponse.json({ error: "cameraId is required." }, { status: 400 });

  // Undo. Puts the ledger back to not knowing rather than recording a second opinion.
  if (body.verdict === null) {
    ledger = clearVerdict(ledger, feed, cameraId);
    writeLiveLedger(ledger);
    return NextResponse.json({ ok: true, cleared: true });
  }

  const verdict = String(body.verdict ?? "");

  if (verdict === "admit") {
    const cam = readQueue().cameras.find((c) => c.cameraId === cameraId && c.feed === feed);
    if (!cam) {
      return NextResponse.json({ error: "That camera is not in the current queue." }, { status: 400 });
    }
    const producingMs = Number(body.producingMs);
    if (!Number.isFinite(producingMs) || producingMs < MIN_PRODUCING_MS) {
      return NextResponse.json(
        {
          error:
            `An admission must record at least ${MIN_PRODUCING_MS}ms of continuous frames. ` +
            `Got ${Number.isFinite(producingMs) ? producingMs : "nothing"}.`,
        },
        { status: 400 },
      );
    }
    ledger = recordAdmission(ledger, {
      cameraId,
      feed,
      streamUrl: cam.streamUrl,
      kind: cam.kind,
      producingMs: Math.round(producingMs),
      signedAt,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    });
    writeLiveLedger(ledger);
    return NextResponse.json({ ok: true, admitted: cameraId });
  }

  if (!REJECT_REASONS.has(verdict)) {
    return NextResponse.json({ error: "Unknown verdict: " + verdict }, { status: 400 });
  }

  // How long the reviewer waited is kept with the rejection. A hasty "dead" on a stream
  // that had not finished connecting is the one mistake here that leaves no trace
  // anywhere else — the camera simply never appears again.
  const waitedMs = Number(body.waitedMs);
  ledger = recordRejection(ledger, {
    cameraId,
    feed,
    reason: verdict as RejectedCamera["reason"],
    signedAt,
    ...(Number.isFinite(waitedMs) ? { waitedMs: Math.round(waitedMs) } : {}),
  });
  writeLiveLedger(ledger);
  return NextResponse.json({ ok: true, rejected: cameraId });
}
