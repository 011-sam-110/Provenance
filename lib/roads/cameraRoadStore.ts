"use client";
// The page-wide store of camera roads (lib/roads/nearCamera.ts), behind the camera
// detail, the camera wall's tiles and the God's eye cards.
//
// ONE POLL FOR THE PAGE. Every surface that shows a camera's road subscribes its
// cameras here, ref-counted, and the store asks /api/camera-road for all of them in
// batches of 40, 200 ms after the last change, then again every 2 minutes while anyone
// still holds them. A wall of nine tiles is one request, not nine.
//
// A FAILED POLL KEEPS THE LAST ANSWER. A camera that had a road keeps it, as the
// camera wall's weather does (camslot.conditions.store.ts).
//
// The React hook reads a version number, not a derived object, so useSyncExternalStore
// gets the same snapshot until the store changes.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CAMERA_ROAD_MAX, cameraRoadParam, type CameraAt, type CameraRoad } from "@/lib/roads/nearCamera";

const REFRESH_MS = 120_000;
const DEBOUNCE_MS = 200;

const roads = new Map<string, CameraRoad>();
const askedAt = new Map<string, number>();
const held = new Map<string, { cam: CameraAt; refs: number }>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

function changed() {
  version += 1;
  for (const l of listeners) l();
}

async function ask(cams: CameraAt[]) {
  const qs = cams.map((c) => `c=${encodeURIComponent(cameraRoadParam(c))}`).join("&");
  try {
    const res = await fetch(`/api/camera-road?${qs}`);
    if (!res.ok) return;
    const body = (await res.json()) as { roads?: Record<string, CameraRoad> };
    let any = false;
    for (const [id, road] of Object.entries(body.roads ?? {})) {
      roads.set(id, road);
      any = true;
    }
    if (any) changed();
  } catch {
    // Kept: the last answer stays on screen.
  }
}

function due(now: number): CameraAt[] {
  const out: CameraAt[] = [];
  for (const [id, h] of held) {
    const at = askedAt.get(id);
    // Less a second: an ask lands up to DEBOUNCE_MS after the poll's tick, and a strict
    // REFRESH_MS would skip every other tick.
    if (at == null || now - at >= REFRESH_MS - 1000) out.push(h.cam);
  }
  return out;
}

function flush() {
  timer = null;
  const now = Date.now();
  const cams = due(now);
  for (const c of cams) askedAt.set(c.id, now);
  for (let i = 0; i < cams.length; i += CAMERA_ROAD_MAX) void ask(cams.slice(i, i + CAMERA_ROAD_MAX));
}

function schedule() {
  if (timer == null) timer = setTimeout(flush, DEBOUNCE_MS);
  if (poll == null && held.size > 0) poll = setInterval(schedule, REFRESH_MS);
}

/** Hold these cameras' roads until the returned function is called. */
export function holdCameraRoads(cams: readonly CameraAt[]): () => void {
  for (const cam of cams) {
    const h = held.get(cam.id);
    if (h) h.refs += 1;
    else held.set(cam.id, { cam, refs: 1 });
  }
  schedule();
  return () => {
    for (const cam of cams) {
      const h = held.get(cam.id);
      if (!h) continue;
      h.refs -= 1;
      if (h.refs <= 0) held.delete(cam.id);
    }
    if (held.size === 0 && poll != null) {
      clearInterval(poll);
      poll = null;
    }
  };
}

/** The camera's road, once the store has an answer for it. */
export function cameraRoadOf(id: string): CameraRoad | undefined {
  return roads.get(id);
}

/** Calls `fn` whenever an answer arrives. */
export function onCameraRoads(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getVersion = () => version;

/** Pure: a stable key for a list of cameras, so a re-render with the same cameras holds nothing new. */
export function camerasKey(cams: readonly CameraAt[]): string {
  return cams.map((c) => cameraRoadParam(c)).join("|");
}

/**
 * Holds these cameras' roads while the component is mounted, and returns a lookup that
 * changes only when an answer arrives.
 */
export function useCameraRoads(cams: readonly CameraAt[]): (id: string) => CameraRoad | undefined {
  const key = camerasKey(cams);
  useEffect(() => holdCameraRoads(cams),
    // The key stands for the list: a new array with the same cameras holds nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
  const v = useSyncExternalStore(onCameraRoads, getVersion, getVersion);
  return useMemo(() => {
    void v;
    return (id: string) => roads.get(id);
  }, [v]);
}
