"use client";
// The Search group: the stage geocoder, which used to be a box floating in the
// middle of the map.
//
// <MapSearch/> is mounted verbatim — there is exactly one geocoder in the app and
// forking it here would be the second. The "/" prefix chip comes with it: it is
// the affordance that teaches the shortcut, and the rail icon cannot carry it.
//
// FOCUS ON MOUNT IS THIS COMPONENT'S JOB, not focusStageSearch()'s. When "/" is
// pressed with the group closed, React has not rendered the input yet on that
// tick, so there is nothing for the caller to focus. Owning it here means both
// paths — already open, and opened by the shortcut — end the same way.

import { useEffect, useRef } from "react";
import MapSearch from "@/components/console/MapSearch";

/** The id on the search frame, so the shell's "/" shortcut can find the input. */
export const STAGE_SEARCH_ID = "stage-search";

export default function SearchFlyout() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = ref.current?.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.focus();
      // select() as well as focus(), so a second "/" types over an old query
      // rather than appending to it.
      input.select();
    }
  }, []);

  return (
    <div className="tnx-maprail-search" id={STAGE_SEARCH_ID} ref={ref}>
      <span className="tnx-maprail-search-pfx" aria-hidden>
        /
      </span>
      <MapSearch />
    </div>
  );
}
