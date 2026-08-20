import { assertDevOnly } from "@/lib/discovery/devOnly";
import { ReviewDeck } from "@/components/admin/ReviewDeck";
import { readCandidates, readLedger } from "@/lib/discovery/store";

/**
 * /admin/verify — look at every camera before it reaches the map.
 *
 * DEV ONLY (404 in production; the gate is repeated here rather than left to the
 * layout, because a layout is a rendering concern and this is a security one).
 */

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  assertDevOnly();

  return (
    <>
      <h1 className="adm-h1">Verify cameras</h1>
      <p className="adm-lede">
        One camera at a time. Judge the picture and the pin, then admit or reject the whole feed.
        Nothing here is on the map yet, and nothing reaches it without a signed verdict.{" "}
        <kbd>&rarr;</kbd> good · <kbd>&larr;</kbd> dead picture · <kbd>P</kbd> wrong pin ·{" "}
        <kbd>N</kbd> not a camera · <kbd>U</kbd> unsure · <kbd>R</kbd> reload the picture ·{" "}
        <kbd>&#9003;</kbd> back · <kbd>&#8679;A</kbd> admit the feed.
      </p>
      <ReviewDeck candidates={readCandidates()} ledger={readLedger()} />
    </>
  );
}
