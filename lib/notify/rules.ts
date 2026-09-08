"use client";
// The area-owned rule set. Persisted to the user's own localStorage; no account,
// no server — the lib/shell/notifications.ts idiom, and it shares that file's
// channels and its `dispatch`.
//
// THE COERCION IS THE POINT. A rule naming an area that has been deleted, or a
// source that has been retired, is DROPPED rather than repaired. Retargeting it to
// some surviving area would leave the user watching a place they never asked about,
// and would do it silently. Four signal layers were retired on 2026-09-05; any rule
// pointing at one of them should simply cease to exist.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import type { AreaRule, Direction, TriggerKind, TriggerParams } from "@/lib/notify/types";
import { WORLD_AREA_ID } from "@/lib/notify/types";

const KEY = "tn.notify.rules.v1";
const VERSION = 1;

const KINDS: readonly TriggerKind[] = [
  "appears", "disappears", "enters", "leaves",
  "crosses", "count", "state", "due", "quiet",
];
const DIRS: readonly Direction[] = ["atOrAbove", "below"];

/** PURE: a persisted params blob → valid TriggerParams, or null if it cannot be trusted. */
function coerceParams(raw: unknown): TriggerParams | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as {
    kind?: unknown; field?: unknown; dir?: unknown;
    level?: unknown; to?: unknown; leadMs?: unknown; silentMs?: unknown;
  };
  const kind = p.kind as TriggerKind;
  if (!KINDS.includes(kind)) return null;

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

  switch (kind) {
    case "appears": case "disappears": case "enters": case "leaves":
      return { kind };
    case "crosses": {
      const field = str(p.field), level = num(p.level);
      const dir = DIRS.includes(p.dir as Direction) ? (p.dir as Direction) : null;
      return field && dir && level != null ? { kind, field, dir, level } : null;
    }
    case "count": {
      const level = num(p.level);
      const dir = DIRS.includes(p.dir as Direction) ? (p.dir as Direction) : null;
      return dir && level != null ? { kind, dir, level } : null;
    }
    case "state": {
      const field = str(p.field), to = str(p.to);
      return field && to ? { kind, field, to } : null;
    }
    case "due": {
      const leadMs = num(p.leadMs);
      return leadMs != null && leadMs > 0 ? { kind, leadMs } : null;
    }
    case "quiet": {
      const silentMs = num(p.silentMs);
      return silentMs != null && silentMs > 0 ? { kind, silentMs } : null;
    }
  }
}

/** PURE: persisted blob → the rules that still name something real. */
export function coerceRules(
  saved: unknown,
  knownAreaIds: ReadonlySet<string>,
  knownSourceIds: ReadonlySet<string>,
): AreaRule[] {
  if (!Array.isArray(saved)) return [];
  const out: AreaRule[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<AreaRule> & { channels?: Partial<AreaRule["channels"]> };
    if (typeof r.id !== "string" || typeof r.areaId !== "string" || typeof r.sourceId !== "string") continue;
    if (r.areaId !== WORLD_AREA_ID && !knownAreaIds.has(r.areaId)) continue;
    if (!knownSourceIds.has(r.sourceId)) continue;
    const params = coerceParams(r.params);
    if (!params) continue;
    const c = (r.channels ?? {}) as Partial<AreaRule["channels"]>;
    out.push({
      id: r.id,
      areaId: r.areaId,
      sourceId: r.sourceId,
      params,
      channels: { browser: c.browser === true, telegram: c.telegram === true, discord: c.discord === true },
      enabled: r.enabled === true,
      createdAt: typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    });
  }
  return out;
}

let rules: AreaRule[] = [];
const listeners = new Set<() => void>();

// getSnapshot MUST return a stable reference between emits. `.filter()` returns a new
// array every call, and useSyncExternalStore compares by identity — a deriving
// snapshot is an infinite render loop, and React's default error for it names the
// hook rather than the cause. Memoised per area, cleared on every write.
let byArea = new Map<string, AreaRule[]>();

function emit() {
  byArea = new Map();
  for (const l of listeners) l();
  savePersisted(KEY, VERSION, rules);
}

export const rulesStore = {
  get(): AreaRule[] { return rules; },
  forArea(areaId: string): AreaRule[] {
    const hit = byArea.get(areaId);
    if (hit) return hit;
    const built = rules.filter((r) => r.areaId === areaId);
    byArea.set(areaId, built);
    return built;
  },
  add(rule: AreaRule) { rules = [rule, ...rules]; emit(); },
  remove(id: string) { rules = rules.filter((r) => r.id !== id); emit(); },
  setEnabled(id: string, on: boolean) {
    rules = rules.map((r) => (r.id === id ? { ...r, enabled: on } : r));
    emit();
  },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  hydrate(knownAreaIds: ReadonlySet<string>, knownSourceIds: ReadonlySet<string>) {
    rules = coerceRules(loadPersisted<unknown>(KEY, VERSION), knownAreaIds, knownSourceIds);
    emit();
  },
};

/** Every rule, for a caller that has to count across MANY areas in one render.
 *  `forArea` is memoised per area but is still a per-area call, and a component
 *  mapping over a changing list of areas cannot call a hook once per row. */
export function useAllRules(): AreaRule[] {
  return useSyncExternalStore(rulesStore.subscribe, rulesStore.get, rulesStore.get);
}

export function useAreaRules(areaId: string): AreaRule[] {
  return useSyncExternalStore(
    rulesStore.subscribe,
    () => rulesStore.forArea(areaId),
    () => rulesStore.forArea(areaId),
  );
}
