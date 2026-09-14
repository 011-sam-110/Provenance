"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import type { SatRec } from "satellite.js";
import type { WorldObject } from "@/lib/world";
import { buildSatrec, propagateAt, orbitalPeriodMin } from "@/lib/satellites/propagate";
import { classifySatellite } from "@/lib/satellites/classify";
import { SAT_META } from "@/lib/icons/svg";
import { filterToScope } from "@/lib/scopeFilter";
import { filterToScopes, useSourceScopes } from "@/lib/shell/sourceScope";
import { useScope } from "@/lib/shell/scope";

interface ApiSat {
  name: string;
  noradId: string;
  line1: string;
  line2: string;
}

interface Built extends ApiSat {
  satrec: SatRec;
  periodMin: number;
  icon: WorldObject["icon"];
  color: string;
  typeLabel: string;
}

export type SatelliteLoad = "loading" | "ok" | "unavailable";

/** Did an /api/satellites body actually deliver a TLE set? The route answers a CelesTrak
 *  failure with 200, `satellites: []` and `error: "celestrak_unavailable"`, so reading
 *  only `satellites` turned an outage into an endless "Loading satellites…". */
export function satellitesPayloadOk(d: unknown): boolean {
  const p = d as { satellites?: unknown; error?: unknown } | null;
  return !!p && typeof p.error !== "string" && Array.isArray(p.satellites) && p.satellites.length > 0;
}

/**
 * Fetches the TLE set ONCE, then propagates every satellite locally on a timer
 * so the layer revolves smoothly (server polling would make them jump). Returns
 * the current satellite WorldObject[] for GlobeView's object layer.
 *
 * @param group  CelesTrak group (default "visual" — bright, recognisable sats).
 * @param stepMs Propagation cadence in ms (default 1000; lower = smoother/heavier).
 */
export function useSatellites(group = "visual", stepMs = 1000): WorldObject[] {
  return useSatelliteFeed(group, stepMs).objects;
}

/** `useSatellites` plus whether the TLE load actually succeeded, for callers that must
 *  tell "still loading" from "CelesTrak did not answer". */
export function useSatelliteFeed(group = "visual", stepMs = 1000): { objects: WorldObject[]; load: SatelliteLoad } {
  const [objects, setObjects] = useState<WorldObject[]>([]);
  const [load, setLoad] = useState<SatelliteLoad>("loading");
  const builtRef = useRef<Built[]>([]);

  // Load TLEs and build satrecs once per group.
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    fetch(`/api/satellites?group=${encodeURIComponent(group)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setLoad(satellitesPayloadOk(d) ? "ok" : "unavailable");
        const recs = (d.satellites ?? []) as ApiSat[];
        builtRef.current = recs
          .map((r): Built | null => {
            try {
              const category = classifySatellite(r.name);
              // Drop spent upper stages, rocket bodies and fragments — they're
              // dead hardware, not live objects worth tracking, and just clutter
              // the layer. (The classifier still tags them so we can filter here.)
              if (category === "debris") return null;
              const meta = SAT_META[category];
              return {
                ...r,
                satrec: buildSatrec(r.line1, r.line2),
                periodMin: orbitalPeriodMin(r.line2),
                icon: meta.key,
                color: meta.color,
                typeLabel: meta.label,
              };
            } catch {
              return null;
            }
          })
          .filter((b): b is Built => b !== null);
      })
      .catch(() => {
        builtRef.current = [];
        if (!cancelled) setLoad("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [group]);

  // Recompute sub-points on each tick → smooth revolution.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next: WorldObject[] = [];
      for (const b of builtRef.current) {
        const sp = propagateAt(b.satrec, now);
        if (!sp) continue;
        next.push({
          kind: "satellite",
          id: `sat:${b.noradId}`,
          lat: sp.lat,
          lon: sp.lon,
          altKm: sp.altKm,
          label: b.name,
          color: b.color,
          icon: b.icon,
          typeLabel: b.typeLabel,
          meta: {
            noradId: b.noradId,
            objectName: b.name,
            line1: b.line1,
            line2: b.line2,
            altKm: sp.altKm,
            velocityKmS: sp.velocityKmS,
            periodMin: b.periodMin,
            typeLabel: b.typeLabel,
          },
        });
      }
      setObjects(next);
    };
    tick();
    const timer = setInterval(tick, stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);

  // PER-SOURCE, not the one global scope. Areas are additive, so this source is
  // unrestricted when World has it on and cropped to the rings of the areas that
  // asked for it otherwise. The map-rail Draw filter still applies on top of both.
  // See lib/shell/sourceScope.ts.
  const scope = useScope();
  const rings = useSourceScopes("satellites");
  const scoped = useMemo(
    () => filterToScopes(filterToScope(objects, scope, (o) => o), rings, (o) => o),
    [objects, scope, rings],
  );
  return { objects: scoped, load };
}
