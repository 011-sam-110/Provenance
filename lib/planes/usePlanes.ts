"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { WorldObject } from "@/lib/world";
import { buildTrailPath, pushHistory, type TrailPoint } from "@/lib/planes/trail";
import { capOverall, fullTrails, joinStoredLine, lineFromHistory, stepFullHistory } from "@/lib/planes/fullHistory";
import { fullTrailStore, storedLineStore, useFullTrail } from "@/lib/planes/fullTrail";
import { heardAt, pointAt, type TrackLine } from "@/lib/planes/trackLine";
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
  /**
   * Indexes into `points` where a new part starts because we hold no position for the plane
   * in between. Nothing is drawn across one. Only the Full flight trail line has them.
   */
  breaks?: number[];
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

/** The Full flight trail run of one hook: its lines, and what they last drew. */
interface FullRun {
  lines: Map<string, TrackLine>;
  /** The snapshot the lines have taken, by its instant. */
  at: number;
  trails: PlaneTrail[];
  /** Stored lines already joined on. */
  joined: Set<string>;
  /** A stored line arrived, so the same snapshot has to draw again. */
  dirty: boolean;
}

/**
 * Polls /api/planes (adsb.lol, already classified server-side) and returns the
 * live aircraft plus a breadcrumb TRAIL per plane. Position history is kept
 * client-side across polls, capped per plane and pruned when a plane leaves
 * coverage. Keeps the last good data on fetch error.
 *
 * `fullTrail` says this caller draws the lines, which only the map's own feed does. There, with
 * the Full flight trail switch on (lib/planes/fullTrail.ts), the lines come from
 * lib/planes/fullHistory.ts instead and a click can load the server's stored line. The 12-point
 * history below runs either way, so switching off puts back exactly the line it would have been.
 * A new line array is made only when something changed, because WorldMap's `setData` runs on
 * a change of array: the poll is every 12 s and the snapshot moves about every 90 s.
 */
export function usePlanes(opts: { unscoped?: boolean; fullTrail?: boolean } = {}): PlanesLayer {
  const [layer, setLayer] = useState<PlanesLayer>({ objects: [], trails: [], fetchedAt: null });
  const historyRef = useRef<Map<string, TrailPoint[]>>(new Map());
  const lastGoodRef = useRef<PlanesLayer>({ objects: [], trails: [], fetchedAt: null });

  const switchOn = useFullTrail();
  const fullOn = opts.fullTrail === true && switchOn;
  const fullOnRef = useRef(fullOn);
  fullOnRef.current = fullOn;
  const fullRunRef = useRef<FullRun | null>(null);
  const shortTrailsRef = useRef<PlaneTrail[]>([]);
  const snapshotRef = useRef<PlanesResponse | null>(null);

  // The long lines for a snapshot, or the same array when nothing changed.
  const fullFor = useRef((data: PlanesResponse): PlaneTrail[] => {
    const at = snapshotInstant(data) ?? Date.now();
    let run = fullRunRef.current;
    if (!run) {
      // Start from the short line already drawn, so the switch shortens nothing.
      const lines = new Map<string, TrackLine>();
      for (const [id, history] of historyRef.current) {
        const line = lineFromHistory(history, at);
        if (line) lines.set(id, line);
      }
      run = { lines, at: -1, trails: [], joined: new Set(), dirty: true };
      fullRunRef.current = run;
    }
    if (at === run.at && !run.dirty) return run.trails;
    const moved = at !== run.at;
    if (moved) run.lines = stepFullHistory(run.lines, data.planes, at);

    const present = new Set(run.lines.keys());
    // A line the store no longer holds can be asked for and joined again. A join reads time,
    // so doing it twice adds nothing that is already there.
    for (const id of run.joined) if (!present.has(id) || !storedLineStore.get(id)) run.joined.delete(id);
    const startsAt = new Map<string, number>();
    for (const id of storedLineStore.loadedIds()) {
      const line = run.lines.get(id);
      const held = storedLineStore.get(id);
      if (!line || held?.status !== "ready" || run.joined.has(id)) continue;
      joinStoredLine(line, held.track);
      run.joined.add(id);
      startsAt.set(id, pointAt(line, 0).t);
    }
    capOverall(run.lines, storedLineStore.loadedIds());

    run.trails = fullTrails(run.lines, data.planes);
    run.at = at;
    run.dirty = false;
    // Last, with the run settled: these tell the store's listeners, and this hook is one.
    storedLineStore.retain(present);
    for (const [id, t] of startsAt) storedLineStore.setFrom(id, t);
    return run.trails;
  }).current;

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
        const at = snapshotInstant(data) ?? Date.now();

        for (const o of data.planes) {
          const cur: TrailPoint = {
            lat: o.lat,
            lon: o.lon,
            altKm: o.altKm ?? 0,
            t: heardAt(at, (o.meta as { posAgeS?: unknown } | undefined)?.posAgeS),
          };
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
        shortTrailsRef.current = trails;
        snapshotRef.current = data;
        const result = {
          objects: data.planes,
          trails: fullOnRef.current ? fullFor(data) : trails,
          fetchedAt: snapshotInstant(data),
        };
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
  }, [fullFor]);

  // The saved switch. Here as well as in Map settings, because a reload has to keep the long
  // lines whether or not that panel is ever opened.
  const wantsFull = opts.fullTrail === true;
  useEffect(() => {
    if (wantsFull) fullTrailStore.hydrate();
  }, [wantsFull]);

  // The switch moved, or a stored line arrived: draw again from what the last poll brought.
  useEffect(() => {
    const redraw = (trails: PlaneTrail[]) => {
      const result = { ...lastGoodRef.current, trails };
      lastGoodRef.current = result;
      setLayer(result);
    };
    if (!fullOn) {
      if (fullRunRef.current) {
        fullRunRef.current = null;
        storedLineStore.clear();
        redraw(shortTrailsRef.current);
      }
      return;
    }
    const show = () => {
      const data = snapshotRef.current;
      if (!data) return;
      const before = fullRunRef.current?.trails;
      const trails = fullFor(data);
      if (trails !== before) redraw(trails);
    };
    show();
    return storedLineStore.subscribe(() => {
      const run = fullRunRef.current;
      if (!run) return;
      // Only an answer that adds a line changes the drawing. `setFrom` also lands here.
      const waiting = [...storedLineStore.loadedIds()].some((id) => !run.joined.has(id) && run.lines.has(id));
      if (!waiting) return;
      run.dirty = true;
      show();
    });
  }, [fullOn, fullFor]);

  // PER-SOURCE, not the one global scope. Areas are additive, so this source is
  // unrestricted when World has it on and cropped to the rings of the areas that
  // asked for it otherwise. The map-rail Draw filter still applies on top of both.
  // See lib/shell/sourceScope.ts.
  //
  // `unscoped` is the Sources rail's PREVIEW of a switched-off layer
  // (lib/shell/sourcePreview.ts): the source is on nowhere, so its rings are an empty
  // list and the crop would return nothing. The preview shows the layer as it would
  // look with World switched on, so it skips the per-source rings and keeps the rest.
  const scope = useScope();
  const sourceRings = useSourceScopes("planes");
  const rings = opts.unscoped ? null : sourceRings;
  // The cropped line array, kept while nothing it was cut from has changed, so a crop does not
  // cost a `setData` on the polls that bring nothing new (see the note on `usePlanes`).
  const cropRef = useRef<{ trails: PlaneTrail[]; scope: unknown; rings: unknown; out: PlaneTrail[] } | null>(null);
  return useMemo(() => {
    const objects = filterToScopes(filterToScope(layer.objects, scope, (o) => o), rings, (o) => o);
    if (objects === layer.objects) return layer; // unrestricted: same array, same identity
    const held = cropRef.current;
    if (held && held.trails === layer.trails && held.scope === scope && held.rings === rings) {
      return { objects, trails: held.out, fetchedAt: layer.fetchedAt };
    }
    const keep = new Set(objects.map((o) => o.id));
    const out = layer.trails.filter((t) => keep.has(t.id));
    cropRef.current = { trails: layer.trails, scope, rings, out };
    return { objects, trails: out, fetchedAt: layer.fetchedAt };
  }, [layer, scope, rings]);
}
