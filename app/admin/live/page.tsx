import { assertDevOnly } from "@/lib/discovery/devOnly";
import { LiveDeck } from "@/components/admin/LiveDeck";
import { pending, readLiveLedger, readQueue } from "@/lib/liveness/queue";

/**
 * /admin/live — watch each live stream and admit it one camera at a time.
 *
 * DEV ONLY (404 in production; the gate is repeated here rather than left to the
 * layout, because a layout is a rendering concern and this is a security one).
 *
 * Separate from /admin/verify because the verdicts are different. That deck judges a
 * FEED from a sample; this one judges a CAMERA, and what it records is that the stream
 * was still producing frames when the verdict was signed.
 */

export const dynamic = "force-dynamic";

export default function LivePage() {
  assertDevOnly();

  const queue = readQueue();
  const ledger = readLiveLedger();
  const todo = pending(queue, ledger);

  return (
    <>
      <h1 className="adm-h1">Live cameras</h1>
      <p className="adm-lede">
        One camera at a time, and nothing reaches the map that you did not watch play. Admit unlocks once the stream
        has been producing frames continuously — a stream that yields one frame and stalls is not a live camera.{" "}
        <kbd>&rarr;</kbd> admit · <kbd>&larr;</kbd> dead · <kbd>P</kbd> wrong pin · <kbd>N</kbd> not a camera ·{" "}
        <kbd>U</kbd> unsure · <kbd>R</kbd> reload · <kbd>&#9003;</kbd> back · <kbd>&#8679;X</kbd> reject the rest of
        this feed.
      </p>
      <p className="adm-stat-note">
        {ledger.admitted.length} admitted · {ledger.rejected.length} rejected · {todo.length} waiting. Verdicts are
        written to <code>data/liveness/ledger.json</code>; commit the diff when you stop.
      </p>
      <LiveDeck queue={todo} />
    </>
  );
}
