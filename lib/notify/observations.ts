"use client";
// What we knew last time, per (area, source). This is the state that turns a
// stateless feed into a stream of transitions.
//
// PERSISTED, deliberately. If it lived only in memory, every reload would be a
// fresh seed (G1) and the first poll after a refresh would announce nothing — so a
// user who reloads during an incident would miss it. Persisting means a reload
// picks up where it left off.
//
// PRUNED on hydrate against the pairs that are actually armed, so disarming a rule
// does not leave its observation behind forever. localStorage is small and shared.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { Observation } from "@/lib/notify/types";

const KEY = "tn.notify.obs.v1";
const VERSION = 1;

/** The composite key. A "|" cannot appear in an area id ("area:<epoch>") or a
 *  signal id, so no two pairs can collide. */
export function obsKey(areaId: string, sourceId: string): string {
  return `${areaId}|${sourceId}`;
}

function isObservation(v: unknown): v is Observation {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<Observation>;
  return (
    !!o.rows && typeof o.rows === "object" && !Array.isArray(o.rows) &&
    typeof o.count === "number" && Number.isFinite(o.count) &&
    typeof o.lastOk === "number" && Number.isFinite(o.lastOk) &&
    Array.isArray(o.dueFired) &&
    typeof o.quietFired === "boolean"
  );
}

/** PURE: keep only well-shaped observations for pairs that are still armed. */
export function pruneObservations(
  saved: unknown,
  liveKeys: ReadonlySet<string>,
): Record<string, Observation> {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const out: Record<string, Observation> = {};
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (!liveKeys.has(k)) continue;
    if (!isObservation(v)) continue;
    out[k] = v;
  }
  return out;
}

let obs: Record<string, Observation> = {};

export const observationsStore = {
  /** `undefined` means never observed — the engine reads that as the seed case. */
  get(areaId: string, sourceId: string): Observation | undefined {
    return obs[obsKey(areaId, sourceId)];
  },
  put(areaId: string, sourceId: string, next: Observation) {
    obs = { ...obs, [obsKey(areaId, sourceId)]: next };
    savePersisted(KEY, VERSION, obs);
  },
  hydrate(liveKeys: ReadonlySet<string>) {
    obs = pruneObservations(loadPersisted<unknown>(KEY, VERSION), liveKeys);
    savePersisted(KEY, VERSION, obs);
  },
  /** Test-only: drop everything. */
  __reset() { obs = {}; },
};

export { EMPTY_OBSERVATION };
