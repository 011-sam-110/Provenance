"use client";
// The keyboard skip link — the first focusable thing on the console, off-screen
// until it takes focus.
//
// Why this exists: the console's first Tab stop used to be the top bar, and from
// there a keyboard or screen-reader user had to walk the whole chrome + every
// widget header before reaching the map, which is the product. There was no way
// past it.
//
// Two deliberate details:
//  • It moves focus itself rather than leaning on the browser's fragment-navigation
//    behaviour, and calls preventDefault() so no `#tn-map-stage` hash is ever
//    appended. The app's shareable state lives in query params (?v=, ?c=), and a
//    stray hash would ride along in every copied/shared URL.
//  • The target carries tabIndex={-1} (see ConsoleWorkspace) so it can actually
//    receive focus. Without that the link "works" visually — the browser scrolls —
//    while focus silently stays on the link, which is the classic broken skip link.

import { useCallback } from "react";

/** id of the console's centre stage. ConsoleWorkspace owns the element. */
export const SKIP_TARGET_ID = "tn-map-stage";

export default function SkipLink() {
  const onActivate = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(SKIP_TARGET_ID);
    if (!el) return; // no stage mounted yet — let the browser do the default thing
    e.preventDefault();
    el.focus({ preventScroll: true });
  }, []);

  return (
    <nav className="tn-skip-nav" aria-label="Skip links">
      <a className="tn-skip-link" href={`#${SKIP_TARGET_ID}`} onClick={onActivate}>
        Skip to the map
      </a>
    </nav>
  );
}
