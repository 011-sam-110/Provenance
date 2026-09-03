import Mark from "@/components/brand/Mark";
import { BRAND } from "@/lib/brand";

/**
 * The site's one piece of chrome: the mark, the name, and the three places worth
 * going. Nothing else.
 *
 * IT IS NOT A BAR OVER THE HERO. The plate, the hairline and the blur are all
 * suppressed while the night stage is behind it, so the top of the page is the
 * stage and not a strip of furniture laid across it. It becomes glass only once
 * the hero has cleared and there is document underneath that the type needs
 * separating from.
 *
 * That handover is pure CSS. `ScrollGround` already toggles `.pv-bar-night` on
 * `.pv-root` for exactly this condition — the ground DIRECTLY BENEATH the bar,
 * which during the hero exit is not the same as the page's — so provenance.css
 * hangs both states off that one class. Do not add a scroll listener here: this
 * page has exactly one, by design, and a second would fight it.
 *
 * WHAT USED TO BE HERE. A live camera count fetched from /api/coverage, and a
 * teal dot standing in for a logo. The count went because the bar is navigation
 * and a number is not a destination — the page still has to earn that claim, and
 * still does, in the hero status rail and the generated source wall, both of
 * which are measured and both of which the verifier checks. Dropping it also
 * takes the last client-side fetch off the landing page, which is why there is
 * no "use client" above.
 */
export default function InstrumentBar() {
  return (
    <nav className="pv-bar" aria-label="Site">
      <a className="pv-wordmark" href="#top">
        {/* No `title`: it sits against the wordmark, so a label here would put a
            second "Provenance" in the accessibility tree. `idle` runs the slow
            orbit on the ring dots — the ambient "this thing is live" tell. */}
        <Mark size={24} idle />
        {/* In its own span so the narrow-viewport rule can take the LETTERS away
            without taking the accessible name with them — below 30rem the mark
            alone is the home link, and a link whose only content is an
            aria-hidden SVG has no name at all. */}
        <span className="pv-wordmark-text">{BRAND.name}</span>
      </a>

      <span className="pv-bar-rule" aria-hidden="true" />

      <span className="pv-bar-links">
        {/* The two things that back the claim the page is making — every source,
            and what each of them is doing right now. The repo link lives in the
            footer and in the hero's second button, per AGPL §13. */}
        <a className="pv-bar-jump" href="#sources">
          Sources
        </a>
        <a className="pv-bar-jump" href="#ledger">
          Status
        </a>
        <a className="pv-bar-go" href="/app">
          Open the map →
        </a>
      </span>
    </nav>
  );
}
