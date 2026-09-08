"use client";
// Per-scene chrome: which widget TYPES are hidden on a board, plus a small open
// bag of per-board "quick settings" (today: just `compactCards`). This is the
// persistence half of the Apple-style nav panel — `lib/console/navPanel.ts`
// owns whether the panel is OPEN; this file owns what a scene's panel is
// showing and what it remembers between visits.
//
// ── WHY A SIBLING STORE, NOT A FIELD ON `ShellLayout` (nav-spec §2) ──────────
// `boards.ts`'s `BoardArchive` holds real ARRANGEMENTS — rects, rail order,
// sizes — and `layoutSignature()` reads it to decide the "customised" dot and
// what Reset throws away. Folding `hidden`/`quick` in there would mean editing
// `sanitizeLayout`, editing (or deliberately excluding fields from)
// `layoutSignature`, editing the `?c=` share-link codec, and making a product
// call about whether hiding a widget should light the "customised" dot and get
// thrown away by Reset. None of that was asked for, and getting any of it
// wrong silently breaks Reset or a shared link for every board, not just this
// feature.
//
// Keeping chrome in its OWN store means resetting a board's layout does not
// un-hide its widgets or touch its quick settings — exactly the way resetting
// a board does not change your language or theme. It also means this file
// never imports `sanitize.ts`, `reducers.ts`, or `store.ts`'s writing half, so
// a bug here cannot corrupt a real layout and a bug in the layout engine can't
// corrupt this.
//
// ── WHY MODULE STATE + LISTENER SET, NOT REACT CONTEXT ───────────────────────
// Same shape as every other shell store in this tree — `activePreset.ts`,
// `mapRail.ts`, `lib/shell/ui.ts` — module-level state, a listener `Set`,
// `useSyncExternalStore` for the React binding. `setHidden`/`setQuick` have to
// be callable from plain DOM event handlers in the nav panel's checkboxes,
// which is the same reason those other stores aren't context.
//
// ── SCENE = BOARD = PRESET, ONE THING (nav-spec §0) ──────────────────────────
// `sceneId` everywhere below is exactly a `ConsolePreset.id` / board id — the
// same id `activePresetStore` tracks and `boards.ts` archives under. This file
// does not invent a second meaning for "scene."

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { activePresetStore } from "@/lib/console/activePreset";
import { shellLayoutStore } from "@/lib/console/store";
import { readBoardLayout } from "@/lib/console/boards";
import { presetById } from "@/lib/console/presets";
import { visibleShell } from "@/lib/terminal/rowBudget";

const KEY = "tn.console.sceneChrome.v1";
const VERSION = 1;

export interface SceneChrome {
  /** Widget TYPE ids hidden on this scene. Absent id = visible (default). */
  hidden: string[];
  /** Open bag, written only via setQuick(). Today's only read key: compactCards. */
  quick: Record<string, unknown>;
}

/** Shared default for any scene never touched. Frozen so a caller reading it
 *  off `get()` for an unknown scene cannot mutate the shared instance instead
 *  of going through `setHidden`/`setQuick` — the same trap a fresh `{ hidden:
 *  [], quick: {} }` literal returned per call would not catch, and would also
 *  break `useSceneChrome`'s `useSyncExternalStore` identity contract below. */
export const DEFAULT_SCENE_CHROME: SceneChrome = Object.freeze({ hidden: [], quick: {} });

type ChromeMap = Record<string /* board id */, SceneChrome>;

let chrome: ChromeMap = {};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(KEY, VERSION, chrome);
}

/**
 * Reshape whatever `loadPersisted` handed back into something every reader
 * here can trust, rather than crashing on it later.
 *
 * The threat is the exact one `boards.ts` names for its own archive: "another
 * tab, an older build, or a user with devtools can have written anything."
 * This store can't corrupt a layout (nothing that writes `ShellLayout` reads
 * it), but a malformed entry — `hidden` not really an array, say — would blow
 * up `visibleWidgets`'s `.includes()` call the first time that scene rendered.
 * So every entry is reshaped on the way IN, once, at hydrate; `get()` and the
 * writers never have to defend against a bad shape again.
 */
function sanitizeChromeMap(raw: unknown): ChromeMap {
  if (!raw || typeof raw !== "object") return {};
  const out: ChromeMap = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const hiddenRaw = (v as { hidden?: unknown }).hidden;
    const quickRaw = (v as { quick?: unknown }).quick;
    out[id] = {
      hidden: Array.isArray(hiddenRaw) ? hiddenRaw.filter((x): x is string => typeof x === "string") : [],
      quick:
        quickRaw && typeof quickRaw === "object" && !Array.isArray(quickRaw)
          ? { ...(quickRaw as Record<string, unknown>) }
          : {},
    };
  }
  return out;
}

export const sceneChromeStore = {
  /** Never returns undefined; an unknown/never-touched sceneId reads as DEFAULT_SCENE_CHROME. */
  get(sceneId: string): SceneChrome {
    return chrome[sceneId] ?? DEFAULT_SCENE_CHROME;
  },

  /** hidden=true adds typeId to the hidden set, false removes it. No-ops (no
   *  emit) if already in that state — the same "a redundant write must not
   *  wake every subscriber" contract `mapRail.ts`'s `set()` keeps. */
  setHidden(sceneId: string, typeId: string, hidden: boolean): void {
    const current = chrome[sceneId] ?? DEFAULT_SCENE_CHROME;
    const isHidden = current.hidden.includes(typeId);
    if (hidden === isHidden) return;
    const nextHidden = hidden ? [...current.hidden, typeId] : current.hidden.filter((t) => t !== typeId);
    chrome = { ...chrome, [sceneId]: { hidden: nextHidden, quick: current.quick } };
    emit();
  },

  /** Shallow-merges patch into quick — never replaces the bag, so a second
   *  quick setting can be added later without migrating what the first one
   *  already wrote for every scene. */
  setQuick(sceneId: string, patch: Record<string, unknown>): void {
    const current = chrome[sceneId] ?? DEFAULT_SCENE_CHROME;
    chrome = { ...chrome, [sceneId]: { hidden: current.hidden, quick: { ...current.quick, ...patch } } };
    emit();
  },

  /** Drops a scene's chrome entirely (hidden set AND quick bag). Not wired to
   *  any UI in v1 — exported for tests and for a future "reset chrome" action. */
  resetScene(sceneId: string): void {
    if (!(sceneId in chrome)) return;
    const next = { ...chrome };
    delete next[sceneId];
    chrome = next;
    emit();
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Pull persisted chrome back in. Call once, client-side, from ConsoleShell,
   *  next to `shellLayoutStore.hydrate()`. */
  hydrate(): void {
    const saved = loadPersisted<ChromeMap>(KEY, VERSION);
    if (saved) chrome = sanitizeChromeMap(saved);
    for (const l of listeners) l();
    // No savePersisted() here on purpose: hydrate READS. A visit that never
    // touches chrome must leave a missing key missing, not immediately rewrite
    // it as `{}` — the same reason `activePresetStore.hydrate()` only re-emits.
  },
};

/** React binding. Returns DEFAULT_SCENE_CHROME (by reference, not a fresh
 *  object — useSyncExternalStore needs stable identity across renders with no
 *  change) when sceneId is null. */
export function useSceneChrome(sceneId: string | null): SceneChrome {
  return useSyncExternalStore(
    sceneChromeStore.subscribe,
    () => (sceneId === null ? DEFAULT_SCENE_CHROME : sceneChromeStore.get(sceneId)),
    () => DEFAULT_SCENE_CHROME,
  );
}

/**
 * The widget TYPE ids a scene's board actually holds RIGHT NOW, independent of
 * whether that scene is the active one:
 *  - the active scene → `shellLayoutStore.get().widgets`, the live render,
 *    including anything the user has dragged/added/removed since the board
 *    was applied;
 *  - a saved (edited) board → its archived layout, `readBoardLayout(id)`;
 *  - a built-in preset that has never been edited → its authored template,
 *    `presetById(id).build(visibleShell())` — this mirrors exactly what
 *    `applyPreset` itself does to answer the same "what does this board hold"
 *    question (saved layout wins, template is the fallback);
 *  - anything else (an unknown id, or a custom preset with no saved board and
 *    therefore no reachable template — `presets.ts`'s `loadCustom()` is
 *    module-private and not exported) → `[]`, rather than throwing on a
 *    preset id that does not resolve.
 *
 * NOT deduplicated by type — a board can hold more than one instance of the
 * same widget type, and this reports one entry per instance. The nav panel,
 * which wants one row per TYPE, dedupes on its own side.
 *
 * Imports `boards.ts`/`presets.ts`/`rowBudget.ts`, which is why this function
 * lives here and not in a nav-shell component file.
 */
export function boardWidgetTypes(sceneId: string): string[] {
  if (sceneId === activePresetStore.get()) {
    return shellLayoutStore.get().widgets.map((w) => w.type);
  }
  const saved = readBoardLayout(sceneId);
  if (saved) return saved.widgets.map((w) => w.type);
  const preset = presetById(sceneId);
  if (preset) return preset.build(visibleShell()).widgets.map((w) => w.type);
  return [];
}

/**
 * The render-time filter. Pure — takes a widgets array and the id whose chrome
 * should apply (normally `activePresetStore.get()`), returns the subset to
 * actually mount. `sceneId=null` (no board applied yet, or a `?c=` layout with
 * no board) means "hide nothing."
 *
 * This is a paint-time filter only: it never reorders, resizes, or drops a
 * widget from the underlying layout, so unhiding puts a tile back exactly
 * where it was and every capacity/counter that reads the raw widget list is
 * untouched.
 *
 * Generic over `{ type: string }` rather than importing `WidgetInstance` so
 * this function has zero coupling to `lib/console/types.ts`.
 */
export function visibleWidgets<T extends { type: string }>(widgets: T[], sceneId: string | null): T[] {
  if (sceneId === null) return widgets;
  const { hidden } = sceneChromeStore.get(sceneId);
  if (hidden.length === 0) return widgets;
  return widgets.filter((w) => !hidden.includes(w.type));
}
