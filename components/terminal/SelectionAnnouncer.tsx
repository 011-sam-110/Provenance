"use client";
// The selection announcement, with no bar around it.
//
// The Terminal's 24px footer used to print SEL — "what did I just click?" — and it
// was the one part of that bar wired into the accessibility tree: role="status",
// aria-live="polite", announced when it changed. The bar is gone; the announcement
// is not, because removing a live region is an accessibility regression that looks
// like a visual change in the diff and is invisible in a screenshot.
//
// It is safe as a live region for the same reason it always was: it changes only
// when the USER selects or clears. Nothing in it churns on a timer, which is the
// failure tests/unit/shell-a11y.test.ts guards against elsewhere — and it is why
// the ticker that shared that bar had to mark itself aria-hidden.
//
// The strings still come from footerLine() in lib/terminal/selection: pure,
// unit-tested, and it guarantees three non-empty strings including the empty state.
// Joined with a middot here rather than laid out in slots, because there is no
// longer a bar whose columns could collapse — only a sentence to be read out.
//
// CSS: none of its own. `.tn-sr-only` already exists in app/globals.css and is the
// same class the header's `a11y-status-line` uses.

import { footerLine, useTerminalSelection } from "@/lib/terminal/selection";

export default function SelectionAnnouncer() {
  const sel = useTerminalSelection();
  const { title, coord, meta } = footerLine(sel);

  return (
    <div className="tn-sr-only" role="status" aria-live="polite" data-testid="a11y-selection-line">
      {`${title} · ${coord} · ${meta}`}
    </div>
  );
}
