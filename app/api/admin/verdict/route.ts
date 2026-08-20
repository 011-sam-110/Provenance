import { NextResponse } from "next/server";
import { isProduction } from "@/lib/discovery/devOnly";
import {
  readLedger,
  recordCameraVerdict,
  recordFeedVerdict,
  removeCameraVerdict,
  writeLedger,
} from "@/lib/discovery/store";
import type { CameraVerdict, FeedVerdict } from "@/lib/discovery/types";

/**
 * Record one reviewer decision.
 *
 * DEV ONLY (404 in production). The ledger it writes is a file in the working tree,
 * so a review session ends with `git diff` showing exactly which cameras a person
 * looked at and what they concluded — which is the audit trail this product's whole
 * argument rests on, and it is a better one than a row in a table nobody can see.
 *
 * `by` is required and is not defaulted. A verdict with no author is a verdict nobody
 * is answerable for, and this repository ships an agent-written descriptor and a
 * human-written one through the same pipeline; telling them apart afterwards is only
 * possible if the difference is recorded at the time.
 */

export const dynamic = "force-dynamic";

const CAMERA_VERDICTS = new Set(["good", "bad-image", "bad-pin", "not-a-camera", "unsure"]);
const FEED_VERDICTS = new Set(["admit", "reject", "hold"]);

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body was not JSON." }, { status: 400 });
  }

  const kind = String(body.kind ?? "");
  const candidateId = String(body.candidateId ?? "");
  const by = String(body.by ?? "").trim();
  if (!candidateId) return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
  if (!by) return NextResponse.json({ error: "by is required — a verdict needs an author." }, { status: 400 });

  const at = new Date().toISOString();
  let ledger = readLedger();

  if (kind === "camera") {
    const nativeId = String(body.nativeId ?? "");
    if (!nativeId) return NextResponse.json({ error: "nativeId is required." }, { status: 400 });
    // An explicit clear is how the review UI's undo works: it puts the ledger back to
    // not knowing, rather than recording a second opinion beside the first.
    if (body.verdict === null) {
      ledger = removeCameraVerdict(ledger, candidateId, nativeId);
      writeLedger(ledger);
      return NextResponse.json({ ok: true, cleared: true, ledger });
    }
    const verdict = String(body.verdict ?? "");
    if (!CAMERA_VERDICTS.has(verdict)) {
      return NextResponse.json({ error: "Unknown camera verdict: " + verdict }, { status: 400 });
    }
    const entry: CameraVerdict = {
      candidateId,
      nativeId,
      verdict: verdict as CameraVerdict["verdict"],
      at,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    };
    ledger = recordCameraVerdict(ledger, entry);
    writeLedger(ledger);
    return NextResponse.json({ ok: true, ledger });
  }

  if (kind === "feed") {
    const verdict = String(body.verdict ?? "");
    if (!FEED_VERDICTS.has(verdict)) {
      return NextResponse.json({ error: "Unknown feed verdict: " + verdict }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    // Required for reject and hold so the next run knows not to re-propose blindly —
    // a queue that keeps offering something you already turned down is a queue people
    // stop using.
    if (verdict !== "admit" && !reason) {
      return NextResponse.json({ error: "A reason is required to reject or hold a feed." }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const attribution = typeof body.attribution === "string" ? body.attribution.trim() : "";
    // Required to admit, and only to admit. A catalogue's idea of a publisher is a
    // mailbox or an Esri account slug, and this ends up on a public attribution line.
    if (verdict === "admit" && (!name || !attribution)) {
      return NextResponse.json(
        { error: "An operator name and an attribution line are required to admit a feed." },
        { status: 400 },
      );
    }
    const entry: FeedVerdict = {
      candidateId,
      verdict: verdict as FeedVerdict["verdict"],
      at,
      reason: reason || undefined,
      name: name || undefined,
      attribution: attribution || undefined,
    };
    ledger = recordFeedVerdict(ledger, entry);
    writeLedger(ledger);
    return NextResponse.json({ ok: true, ledger });
  }

  return NextResponse.json({ error: "kind must be 'camera' or 'feed'." }, { status: 400 });
}
