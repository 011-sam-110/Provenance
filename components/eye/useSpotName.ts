"use client";

import { useEffect, useState } from "react";
import { fetchPlaceName } from "@/lib/console/eyeCoverageClient";
import { placeName } from "@/lib/console/eyePerson";
import type { EyeTarget } from "@/lib/eye/places";

/**
 * What a spot is called, looked up by this page from the coordinates it opened at. The link carries
 * no name on purpose: a crafted link must not be able to title the page, so the only words that can
 * reach the title are the geocoder's own for those coordinates. Rounded to about 100 m, which is
 * plenty for a town and all the server's log needs. Null until it answers, and for a place with no
 * name, such as the sea: the title then stays the coordinates. A film or a recording asks for nothing.
 */
export function useSpotName(target: EyeTarget | null, film: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  const lat = target?.kind === "spot" ? Math.round(target.view.lat * 1000) / 1000 : null;
  const lon = target?.kind === "spot" ? Math.round(target.view.lon * 1000) / 1000 : null;
  useEffect(() => {
    setName(null);
    if (lat === null || lon === null || film) return;
    let current = true;
    void fetchPlaceName({ lat, lon }).then((results) => {
      if (current) setName(placeName(results, ""));
    });
    return () => {
      current = false;
    };
  }, [lat, lon, film]);
  return name;
}
