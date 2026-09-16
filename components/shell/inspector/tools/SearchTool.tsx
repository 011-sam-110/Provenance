"use client";
// The Search tool — the console's geocoder, and the first panel on the Inspector
// rail. It was the stage rail's Search flyout (components/console/maprail/
// SearchFlyout.tsx) and moved here with the rail: the box floats in a panel beside
// the map it moves rather than over it.
//
// <MapSearch/> IS MOUNTED VERBATIM. There is exactly one geocoder in the app and
// forking it here would be the second. The "/" prefix chip comes with it: it is the
// affordance that teaches the shortcut, and a 18px magnifier on the rail cannot
// carry it.
//
// FOCUS ON MOUNT IS THIS COMPONENT'S JOB, not focusInspectorSearch()'s. When the
// shortcut is pressed with the rail closed, React has not rendered the input yet on
// that tick, so there is nothing for the caller to focus. Owning it here means both
// paths — already open, and opened by the shortcut — end the same way.

import { useEffect, useRef } from "react";
import MapSearch from "@/components/console/MapSearch";

/** The id on the search frame, so focusInspectorSearch() can find the input. */
export const INSPECTOR_SEARCH_ID = "inspector-search";

export default function SearchTool() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = ref.current?.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.focus();
      // select() as well as focus(), so a second press of the shortcut types over an
      // old query rather than appending to it.
      input.select();
    }
  }, []);

  // NO HEAD OF ITS OWN. The panel head — the tool's name and the ✕ that closes it —
  // is rendered once by InspectorPanel, so two tools cannot grow two different
  // headers. This renders the body and nothing else.
  return (
    <>
      <div className="tn-insp-search" id={INSPECTOR_SEARCH_ID} ref={ref}>
        <span className="tn-insp-search-pfx" aria-hidden>
          /
        </span>
        <MapSearch />
      </div>
      <p className="tn-insp-tool-foot">
        Enter drops a pin on the first match and flies there. Pins accumulate, and the
        arrows under the map walk back through them.
      </p>
    </>
  );
}
