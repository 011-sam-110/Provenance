"use client";
// One live station (ISS preferred) for the orbit-follow, shared by the
// console controller (components/console/IssOrbit.tsx) and the trimmed
// /demo-cinematic page. Dormant-safe throughout: a failed fetch or a dead
// propagation resolves to `load: "unavailable"`, never a throw.
//
// WHY THIS IS NOT lib/satellites/useSatellites. That hook ends in
// filterToScopes(sourceRegions("satellites")), and sourceRegions answers `[]`
// (empty world set) until the console shell seeds a preset — on a standalone
// route every station would be filtered to nothing while the fetch itself
// reports ok. This hook fetches the same keyless /api/satellites?group=stations
// route and propagates locally with the same SGP4 helpers, deliberately
// without the console's crop.

import { useEffect, useRef, useState } from "react";
import type { SatRec } from "satellite.js";
import { satellitesPayloadOk, type SatelliteLoad } from "@/lib/satellites/useSatellites";
import { buildSatrec, propagateAt } from "@/lib/satellites/propagate";

const ISS_NORAD_ID = "25544";

/** The station's live sub-point — all the orbit follow needs. */
export interface IssStation {
  lat: number;
  lon: number;
  label: string;
}

export function useIssStation(): { station: IssStation | null; load: SatelliteLoad } {
  const [load, setLoad] = useState<SatelliteLoad>("loading");
  const [station, setStation] = useState<IssStation | null>(null);
  const satrecRef = useRef<SatRec | null>(null);
  const nameRef = useRef("");

  // Fetch the TLE once; the ISS row wins, else the first station in the group.
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    fetch("/api/satellites?group=stations")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!satellitesPayloadOk(d)) {
          setLoad("unavailable");
          return;
        }
        const recs = (d.satellites ?? []) as { name: string; noradId: string; line1: string; line2: string }[];
        const pick = recs.find((r) => r.noradId === ISS_NORAD_ID) ?? recs[0];
        if (!pick) {
          setLoad("unavailable");
          return;
        }
        try {
          satrecRef.current = buildSatrec(pick.line1, pick.line2);
          nameRef.current = pick.name;
          setLoad("ok");
        } catch {
          setLoad("unavailable");
        }
      })
      .catch(() => {
        if (!cancelled) setLoad("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-propagate the sub-point each second, exactly like useSatellites' tick.
  useEffect(() => {
    const tick = () => {
      const satrec = satrecRef.current;
      if (!satrec) {
        setStation(null);
        return;
      }
      const sp = propagateAt(satrec, new Date());
      if (!sp) {
        setStation(null);
        return;
      }
      setStation({ lat: sp.lat, lon: sp.lon, label: nameRef.current });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [load]);

  return { station, load };
}
