"use client";
// IP location: the one look-up in flight, and the areas it draws on the map.
//
// NOT PERSISTED AND NOT SYNCED, on purpose. A dropped map pin is saved and, with an
// account, synced (tn.map.pins.v1 is in lib/account/syncKeys.ts). A typed IP can be a
// person's, so it never becomes a pin: this store lives in memory only, a new look-up
// replaces the old one, and closing the dossier clears the area from the map.
//
// The door is the search box (components/console/MapSearch.tsx): an IP or a domain
// gets a "Locate network" row. Choosing it calls `locate`, which also points the six
// recon tools at the same target, opens the network dossier (components/NetworkDetail
// .tsx) and flies the map to the area, never closer than MAX_IP_ZOOM.

import { useSyncExternalStore } from "react";
import { networkTargetOf, type GeoResult } from "@/lib/recon/geo";
import { areasOf, viewOfAreas, type GeoArea } from "@/lib/recon/geoArea";
import { reconTargetStore } from "@/lib/recon/targetStore";
import { loadOutlines } from "@/lib/shell/askPlaceLookup";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { overlay } from "@/lib/overlay";
import { mapViewStore } from "@/lib/mapView";

export type IpLocateStatus = "idle" | "loading" | "ready" | "error";

export interface IpLocateState {
  status: IpLocateStatus;
  /** The normalised target, "" when idle. */
  target: string;
  result: GeoResult | null;
  areas: GeoArea[];
}

/** The overlay id of the network dossier: this prefix plus the target. */
export const NETWORK_ID_PREFIX = "net:";

const IDLE: IpLocateState = { status: "idle", target: "", result: null, areas: [] };
let state: IpLocateState = IDLE;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** A country's display name, from the repo's own centroid table. */
export function countryName(iso2: string): string {
  return centroidByIso2(iso2)?.name ?? iso2;
}

export const ipLocateStore = {
  get(): IpLocateState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Look up an IP or a domain. Anything else is ignored. */
  async locate(raw: string): Promise<void> {
    const t = networkTargetOf(raw);
    if (!t) return;
    const mine = ++seq;
    state = { status: "loading", target: t.value, result: null, areas: [] };
    emit();
    reconTargetStore.set(t.value);
    overlay.open({
      kind: "network",
      id: `${NETWORK_ID_PREFIX}${t.value}`,
      // No coordinates: this object is not a point, so the Inspector's export gives a
      // table and never a GeoJSON point (components/shell/InspectorPanel.tsx, hasPlace).
      lat: Number.NaN,
      lon: Number.NaN,
      label: t.value,
      typeLabel: "Network location",
    });
    let result: GeoResult | null = null;
    try {
      const res = await fetch(`/api/recon/geo?target=${encodeURIComponent(t.value)}`);
      result = (await res.json()) as GeoResult;
    } catch {
      result = null;
    }
    if (mine !== seq) return;
    if (!result || !result.ok) {
      state = { status: "error", target: t.value, result, areas: [] };
      emit();
      return;
    }
    const outlines = await loadOutlines();
    if (mine !== seq) return;
    const areas = areasOf(
      result.locations,
      (iso2) => {
        const iso3 = centroidByIso2(iso2)?.iso3;
        return iso3 ? outlines.get(iso3) : undefined;
      },
      countryName,
    );
    state = { status: "ready", target: t.value, result, areas };
    emit();
    const view = viewOfAreas(areas);
    if (view) mapViewStore.flyToPoint(view);
  },
  /** Forget the look-up and take its area off the map. */
  clear(): void {
    if (state === IDLE) return;
    seq++;
    state = IDLE;
    emit();
  },
};

// Closing the dossier, or opening anything else in it, clears the area. The check runs
// after `locate` has set its own state, so its own overlay.open() never clears it.
overlay.subscribe(() => {
  if (state.status === "idle") return;
  const open = overlay.get().object;
  if (!open || open.id !== `${NETWORK_ID_PREFIX}${state.target}`) ipLocateStore.clear();
});

export function useIpLocate(): IpLocateState {
  return useSyncExternalStore(ipLocateStore.subscribe, ipLocateStore.get, () => IDLE);
}
