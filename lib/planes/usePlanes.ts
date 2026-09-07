"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { WorldObject } from "@/lib/world";
import { buildTrailPath, pushHistory, type TrailPoint } from "@/lib/planes/trail";
import { filterToScope } from "@/lib/scopeFilter";
import { useScope } from "@/lib/shell/scope";

const POLL_INTERVAL_MS = 12_000;

/** A plane's breadcrumb path: recent positions + a projected point ahead. */
export interface PlaneTrail {
  id: string;
  color: string;
  /** [lat, lon, altKm] tuples. */
  points: [number, number, number][];
}

export interface PlanesLayer {
  objects: WorldObject[];
  trails: PlaneTrail[];
}

interface PlanesResponse {
  count: number;
  planes: WorldObject[];
}

/**
 * Polls /api/planes (adsb.lol, already classified server-side) and returns the
 * live aircraft plus a breadcrumb TRAIL per plane. Position history is kept
 * client-side across polls (the server only knows "now"), capped per plane and
 * pruned when a plane leaves coverage. Keeps the last good data on fetch error.
 */
export function usePlanes(): PlanesLayer {
  const [layer, setLayer] = useState<PlanesLayer>({ objects: [], trails: [] });
  const historyRef = useRef<Map<string, TrailPoint[]>>(new Map());
  const lastGoodRef = useRef<PlanesLayer>({ objects: [], trails: [] });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/planes");
        if (!res.ok) return; // keep last good
        const data = (await res.json()) as PlanesResponse;
        if (cancelled) return;

        const prev = historyRef.current;
        const next = new Map<string, TrailPoint[]>();
        const trails: PlaneTrail[] = [];

        for (const o of data.planes) {
          const cur: TrailPoint = { lat: o.lat, lon: o.lon, altKm: o.altKm ?? 0 };
          const hist = pushHistory(prev.get(o.id) ?? [], cur);
          next.set(o.id, hist);
          // Trail = history (minus the current, which buildTrailPath re-adds) +
          // current + projected-ahead.
          const path = buildTrailPath(
            hist.slice(0, -1),
            cur,
            o.heading ?? 0,
            (o.meta?.velocityMs as number | null) ?? null,
          );
          trails.push({
            id: o.id,
            color: o.color ?? "#fbbf24",
            points: path.map((p) => [p.lat, p.lon, p.altKm] as [number, number, number]),
          });
        }

        historyRef.current = next; // prunes planes no longer present
        const result = { objects: data.planes, trails };
        lastGoodRef.current = result;
        setLayer(result);
      } catch {
        if (!cancelled) setLayer(lastGoodRef.current);
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const scope = useScope();
  return useMemo(() => {
    const objects = filterToScope(layer.objects, scope, (o) => o);
    if (objects === layer.objects) return layer; // World: same array, same identity
    const keep = new Set(objects.map((o) => o.id));
    return { objects, trails: layer.trails.filter((t) => keep.has(t.id)) };
  }, [layer, scope]);
}
