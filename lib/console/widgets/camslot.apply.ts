"use client";

import { arrangeBoard, addWidget, removeWidget } from "@/lib/console/reducers";
import { shellLayoutStore, nextWidgetId } from "@/lib/console/store";
import { getMapInstance } from "@/lib/map/instance";
import { revealPickLayers } from "@/lib/console/widgets/camslot.layers";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { loadedWebcamsStore } from "@/lib/webcams/loaded";
import { startCircleDraw } from "@/lib/console/widgets/camslot.circle";
import { planMonitor, type MonitorPlan } from "@/lib/console/widgets/camslot.monitor";
import { WALL_TILES, type FanOutTile } from "@/lib/console/widgets/camslot.fanout";
import { ROW_PX, GAP_PX } from "@/lib/terminal/layoutGrid";
import type { ShellLayout } from "@/lib/console/types";

/**
 * Dwell for a tile that holds more than one stream.
 *
 * A still tile switches by swapping an <img> src. A VIDEO tile switches by
 * destroying an hls.js instance and building another, which costs a manifest
 * fetch and a fresh buffer before the first frame — at the still default of 8s a
 * tile would spend most of its life buffering rather than showing anything.
 *
 * 30s is REASONED FROM THAT COST AND NOT MEASURED. It is the number in this
 * feature most likely to be wrong, and `scripts/verify-streets-area.mjs` times a
 * switch precisely so it can be corrected with evidence rather than taste.
 */
export const VIDEO_DWELL_MS = 30_000;

/** A camera tile's opening height in px. Mirrors camslot.create.ts's constant —
 *  the "M" preset, so a new tile opens on a size the ⋯ menu highlights. */
const TILE_HEIGHT_PX = 280;

/**
 * Replace a wall's tiles with a planned set. PURE, so the layout arithmetic is
 * testable without a store or a map.
 *
 * REPLACES rather than appends. Drawing a second area means "monitor this
 * instead", not "monitor both" — and appending would silently walk the board past
 * nine tiles on every redraw.
 *
 * `mintId` IS A PARAMETER so this stays pure and deterministic under test. Minting
 * ids inside would make a function that claims to be pure return a different
 * layout on every call, and a test could then only assert the SHAPE of an id, not
 * the layout. The app passes the store's own minter, so ids keep the `w<base36>`
 * format every other widget in the console uses.
 */
export function tilesToLayout(
  l: ShellLayout,
  tiles: readonly FanOutTile[],
  rows: number,
  mintId: () => string,
): ShellLayout {
  let next = l;
  for (const w of [...l.widgets]) next = removeWidget(next, w.id);

  for (const t of tiles) {
    next = addWidget(next, "camslot", mintId(), {
      segment: "left",
      height: TILE_HEIGHT_PX,
      config: {
        name: t.name,
        streams: t.streams,
        // A tile with one stream never rotates, so its interval is inert; giving
        // it the video dwell anyway would be a claim about behaviour that does
        // not happen. The default is right for it.
        ...(t.streams.length > 1 ? { intervalMs: VIDEO_DWELL_MS } : {}),
      },
    });
  }

  // No `tiles.length` guard: every widget was removed above, so on an empty plan
  // `arrangeBoard` is arranging nothing and returns the same board. The guard that
  // used to be here read as protecting something and protected nothing — the test
  // below ("leaves an empty tile list as an empty board") passes either way, which
  // is how it was caught.
  return arrangeBoard(next, rows);
}

export interface ApplyResult { ok: boolean; message: string; created: number }

/** Put a planned wall onto the open board and remember the area that made it. */
export function applyMonitorPlan(plan: MonitorPlan, ring: readonly [number, number][]): ApplyResult {
  if (plan.tiles.length === 0) {
    return { ok: false, message: plan.message, created: 0 };
  }
  const rows = Math.floor((typeof window === "undefined" ? 900 : window.innerHeight) / (ROW_PX + GAP_PX));
  shellLayoutStore.replace((l) => ({
    ...tilesToLayout(l, plan.tiles, rows, nextWidgetId),
    watch: { ring: [...ring] as [number, number][] },
  }));
  return { ok: true, message: plan.message, created: plan.tiles.length };
}

/**
 * Start the Streets area gesture.
 *
 * Turns the camera layers on first, for the reason camslot.layers.ts gives: a
 * ring that closes onto an empty result because a layer was off is the tool
 * refusing a request it understood. The guarantee belongs to the GESTURE, so it
 * lives here rather than in the button that starts it.
 */
export function startStreetsArea(): { ok: boolean; message?: string } {
  const map = getMapInstance();
  if (!map) return { ok: false, message: "The map is not ready yet." };

  revealPickLayers();

  const ok = startCircleDraw(map as never, {
    onFinish: (ring) => {
      const plan = planMonitor(
        { ring, cameras: loadedCamerasStore.get(), webcams: loadedWebcamsStore.get() },
        WALL_TILES,
      );
      const res = applyMonitorPlan(plan, ring);
      toast(res.message);
    },
  });
  return ok ? { ok: true } : { ok: false, message: "Could not start drawing." };
}

function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: message }));
}
