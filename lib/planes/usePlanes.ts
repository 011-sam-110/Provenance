"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { WorldObject } from "@/lib/world";
import { buildTrailPath, pushHistory, type TrailPoint } from "@/lib/planes/trail";
import { filterToScope } from "@/lib/scopeFilter";
import { filterToScopes, useSourceScopes } from "@/lib/shell/sourceScope";
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
  /**
   * Epoch ms the server pulled these positions from upstream (`fetchedAt` in the
   * /api/planes body), or null before the first snapshot. The poll runs every 12 s
   * but the snapshot changes about every 90 s, so THIS is the age of what is drawn,
   * not the time the poll returned.
   */
  fetchedAt: number | null;
}

interface PlanesResponse {
  count: number;
  planes: WorldObject[];
  fetchedAt?: number;
}

/** Pure: the data instant a /api/planes body carries, or null when it carries none. */
export function snapshotInstant(body: { fetchedAt?: unknown }): number | null {
  const t = body.fetchedAt;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * Polls /api/planes (adsb.lol, already classified server-side) and returns the
 * live aircraft plus a breadcrumb TRAIL per plane. Position history is kept
 * client-side across polls (the server only knows "now"), capped per plane and
 * pruned when a plane leaves coverage. Keeps the last good data on fetch error.
 */
export function usePlanes(): PlanesLayer {
  const [layer, setLayer] = useState<PlanesLayer>({ objects: [], trails: [], fetchedAt: null });
  const historyRef = useRef<Map<string, TrailPoint[]>>(new Map());
  const lastGoodRef = useRef<PlanesLayer>({ objects: [], trails: [], fetchedAt: null });

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
        const result = { objects: data.planes, trails, fetchedAt: snapshotInstant(data) };
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

  // PER-SOURCE, not the one global scope. Areas are additive, so this source is
  // unrestricted when World has it on and cropped to the rings of the areas that
  // asked for it otherwise. The map-rail Draw filter still applies on top of both.
  // See lib/shell/sourceScope.ts.
  const scope = useScope();
  const rings = useSourceScopes("planes");
  return useMemo(() => {
    const objects = filterToScopes(filterToScope(layer.objects, scope, (o) => o), rings, (o) => o);
    if (objects === layer.objects) return layer; // unrestricted: same array, same identity
    const keep = new Set(objects.map((o) => o.id));
    return { objects, trails: layer.trails.filter((t) => keep.has(t.id)), fetchedAt: layer.fetchedAt };
  }, [layer, scope, rings]);
}
