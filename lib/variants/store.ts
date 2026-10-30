"use client";
import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { BUILTIN_BY_ID, BUILTIN_VARIANTS, DEFAULT_VARIANT_ID } from "@/lib/variants/builtins";
import type { OverrideDelta, PanelPlacement, Variant } from "@/lib/variants/types";
import { resolveSignals } from "@/lib/variants/resolveSignals";
import { diffFromVariant, isEmptyDelta } from "@/lib/variants/diff";
import { layersStore, DEFAULT_STATE, expandLegacyLayers, type LayerState } from "@/lib/layers";
import { expandRetiredSignalIds, expandRetiredSignalSet } from "@/lib/layerAliases";
import { inspectorStore } from "@/lib/shell/inspector";
import { signalsStore, type SignalState } from "@/lib/signals/store";
import { uiStore } from "@/lib/shell/ui";
import { mapViewStore } from "@/lib/mapView";
import { decodeViewState } from "@/lib/share/url";
import { activePresetStore } from "@/lib/console/activePreset";
import {
  applyViewSet as writeViewSet,
  sameViewSet,
  viewSetFromWorld,
  worldFromViewSet,
  type ViewSet,
} from "@/lib/console/viewSources";

interface VariantStoreState {
  activeId: string;
  userVariants: Variant[]; // populated by the SP1b editor; [] in SP1a
  overrides: Record<string, OverrideDelta>;
  layoutOverrides: Record<string, PanelPlacement[]>; // SP1b
  /**
   * EACH VIEW'S OWN WHOLE-MAP SOURCES, keyed by board (preset) id: Globe, Streets, News
   * or a saved board. Full sets, not deltas (see viewSetFromWorld), so a later variant
   * switch cannot reinterpret them. Written by captureView on every change to World once
   * bootDone() has run; read by bootstrap and by applyPreset when a view is opened.
   *
   * It lives here, in tn.variant.v1, so it adds no storage key, no Supabase migration
   * and no /privacy row: the key already syncs whole. `overrides` is STILL WRITTEN
   * exactly as before, because older builds and other devices read it.
   */
  views?: Record<string, ViewSet>;
}

export const PERSIST_KEY = "tn.variant.v1";
const PERSIST_VERSION = 1;

let state: VariantStoreState = { activeId: DEFAULT_VARIANT_ID, userVariants: [], overrides: {}, layoutOverrides: {} };
let applying = false; // guard: suppress override-capture while seeding
let subscribed = false; // guard: subscribe captureOverride exactly once
/**
 * False until bootDone(). Nothing is filed under a view while the console boots: the
 * board is still being chosen (saved, link, first-run seed) and a write in that window
 * would file a half-applied set under the wrong board. bootstrap clears it again so a
 * second boot (StrictMode, tests) is gated the same way.
 */
let viewsLive = false;
/** The set bootstrap applied for the board the browser was last on, filed by bootDone. */
let bootFiling: { board: string; set: ViewSet } | null = null;
const listeners = new Set<() => void>();

export function resolveVariant(id: string): Variant {
  const all = [...BUILTIN_VARIANTS, ...state.userVariants];
  return all.find((v) => v.id === id) ?? BUILTIN_BY_ID[DEFAULT_VARIANT_ID];
}

function applyVariant(v: Variant, override?: OverrideDelta, sigFromUrl?: string[]) {
  applying = true;
  try {
    const layers = { ...DEFAULT_STATE, ...v.layers, ...override?.layers } as LayerState;
    // applyWorld, not applyExact: a variant is a configuration OF THE GLOBE, and
    // captureOverride below reads World back. Aiming it at the edited context would
    // write an area on the way in and read World on the way out.
    layersStore.applyWorld(layers);

    let signals: SignalState = { ...resolveSignals(v.signals), ...override?.signals };
    // URL sig= is the authoritative on-set for a shared view — replace rather than merge with any local override.
    if (sigFromUrl) { signals = {}; for (const id of sigFromUrl) signals[id] = true; }
    signalsStore.applyWorld(signals);

    uiStore.setTheme(override?.theme ?? v.theme);
    if (typeof document !== "undefined") document.documentElement.style.setProperty("--accent", v.accent);
    if (v.view && typeof window !== "undefined") mapViewStore.flyToPoint({ lat: v.view.lat, lon: v.view.lon, zoom: v.view.zoom });
  } finally {
    applying = false;
  }
}

/**
 * Saved overrides and user variants, with retired layer keys expanded.
 *
 * This store is the ONE place holding layer state that was WRITTEN under the old
 * vocabulary and is replayed onto the globe on every boot. Left alone, an override
 * saying `{cameras: false}` would land as an unknown key on a spread over
 * DEFAULT_STATE and quietly do nothing — so someone who had deliberately switched
 * the cameras off would find them back on, with no event to explain it.
 *
 * Returns only the two fields it touches, so the caller's spread stays honest about
 * what this function is allowed to change.
 */
function migrateLayerKeys(saved: VariantStoreState): Partial<VariantStoreState> {
  const overrides: Record<string, OverrideDelta> = {};
  for (const [id, delta] of Object.entries(saved.overrides ?? {})) {
    let d = delta?.layers ? { ...delta, layers: expandLegacyLayers(delta.layers) } : delta;
    // Retired signal ids too: an override saying `{"emsc-quakes": true}` would
    // otherwise turn on a layer that no longer exists, which draws nothing.
    if (d?.signals) d = { ...d, signals: expandRetiredSignalSet(d.signals) };
    overrides[id] = d;
  }
  const userVariants = (saved.userVariants ?? []).map((v) => {
    let u = v?.layers ? { ...v, layers: expandLegacyLayers(v.layers) } : v;
    if (u?.signals) {
      u = {
        ...u,
        signals: {
          ...u.signals,
          ...(u.signals.ids ? { ids: expandRetiredSignalIds(u.signals.ids) } : {}),
          ...(u.signals.exclude ? { exclude: expandRetiredSignalIds(u.signals.exclude) } : {}),
        },
      };
    }
    return u;
  });
  // Retired keys inside a saved view are expanded like the ones in an override, and a
  // malformed entry is dropped rather than half-trusted: this file is synced from
  // accounts and hand-editable in a browser, and a bad `views.streets` must cost that
  // one view its memory, never the boot.
  const views: Record<string, ViewSet> = {};
  const rawViews = saved.views && typeof saved.views === "object" && !Array.isArray(saved.views) ? saved.views : {};
  for (const [id, raw] of Object.entries(rawViews)) {
    const clean = cleanView(raw);
    if (clean) views[id] = clean;
  }
  return { overrides, userVariants, views };
}

/** A saved view in its current vocabulary, or null when it is not a view at all. */
function cleanView(raw: unknown): ViewSet | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { layers?: unknown; signals?: unknown };
  if (!v.layers || typeof v.layers !== "object" || Array.isArray(v.layers)) return null;
  if (!Array.isArray(v.signals) || !v.signals.every((s) => typeof s === "string")) return null;
  const layers = { ...DEFAULT_STATE, ...expandLegacyLayers(v.layers) };
  const signals = expandRetiredSignalIds(v.signals as string[]);
  // Through the World shape and back: floors missing layers, orders and de-duplicates
  // the signals, and drops an id the registry no longer has.
  return viewSetFromWorld(worldFromViewSet({ layers, signals }));
}

/** The set a variant (and its override) puts on World, without the URL's `sig`. */
function variantSet(v: Variant, override?: OverrideDelta): ViewSet {
  const layers = { ...DEFAULT_STATE, ...v.layers, ...override?.layers };
  const signals = { ...resolveSignals(v.signals), ...override?.signals };
  return viewSetFromWorld({ ...layers, ...signals });
}

function persist() { savePersisted(PERSIST_KEY, PERSIST_VERSION, state); }
function emit() { for (const l of listeners) l(); }

/**
 * File World's whole set under the board that is open, when it differs from what is
 * filed. Reads WORLD directly rather than the edited context, so it is right whichever
 * context the EDITING bar points at (a toggle inside an area changes no World object
 * and files nothing). Runs BEFORE the edit guard in captureOverride for that reason.
 */
function captureView() {
  if (!viewsLive) return;
  const board = activePresetStore.get();
  if (!board) return;
  const next = viewSetFromWorld(inspectorStore.get().world);
  if (sameViewSet(state.views?.[board], next)) return;
  state = { ...state, views: { ...state.views, [board]: next } };
  persist();
  emit();
}

function captureOverride() {
  if (applying) return;
  captureView();
  // Only World's toggles belong to a variant. layersStore/signalsStore are views onto
  // the source contexts and are what this is subscribed to, so without this guard
  // every toggle made INSIDE an area would be captured as the variant's override and
  // replayed onto the globe on the next boot — the leak the contexts model exists to
  // prevent.
  if (inspectorStore.get().editing !== null) return;
  const v = resolveVariant(state.activeId);
  // `.editing` RATHER THAN `.get()`, AND THE GUARD ABOVE IS NOT ENOUGH ON ITS OWN.
  // `.get()` is the UNION now — on in World or in any area — so with the rail pointed
  // at World and one area quietly holding Fires, the union says Fires is on and this
  // would persist it as a WORLD override. The next boot then applies it to the globe,
  // and a source the user scoped to one ring is suddenly planet-wide with no way to
  // trace how. Past the guard, `.editing` is World's own set by definition.
  const delta = diffFromVariant(
    { layers: layersStore.editing(), signals: signalsStore.editing(), theme: uiStore.get().theme },
    v,
  );
  const next = { ...state.overrides };
  if (isEmptyDelta(delta)) delete next[state.activeId]; else next[state.activeId] = delta;
  state = { ...state, overrides: next };
  persist();
  emit();
}

export const variantStore = {
  /**
   * The ONLY load-time hydration path. Call once from ConsoleShell.
   *
   * `params` is still read — for `sig`, the signal divergence a shared link carries.
   * It is NOT read for the board: `?v=` was removed from the deep-link codec because
   * the server had to read it to mint a per-board social card, which made the whole
   * `/app` route dynamic. The board now comes from persisted state or the default,
   * so a legacy `/app?v=aviation` link opens the default board.
   *
   * RETURNS whether saved state was found, i.e. whether this browser has booted the
   * console before (this method persists on every boot, so the key exists from the
   * second boot on). The boot seed reads it to tell a true first run from a returning
   * user: see lib/console/bootSeed.ts.
   *
   * `board` is the board (preset) the browser was last on, read from storage by the
   * caller BEFORE the active-board store hydrates (hydrating it earlier would make the
   * layout store file the saved layout under it: see ConsoleShell). When that board has
   * a view of its own (`views[board]`), World is put to exactly that set; otherwise the
   * set comes from the variant and its `overrides` delta as it always did, which is how
   * a browser that saved before views existed gets its one old set back, filed under
   * the board it was last on by bootDone().
   */
  bootstrap(params: URLSearchParams, board: string | null = null): boolean {
    viewsLive = false;
    bootFiling = null;
    const saved = loadPersisted<VariantStoreState>(PERSIST_KEY, PERSIST_VERSION);
    if (saved) state = { ...state, ...saved, ...migrateLayerKeys(saved) };
    const url = decodeViewState(params);
    const id =
      (BUILTIN_BY_ID[state.activeId] || state.userVariants.find((v) => v.id === state.activeId))
        ? state.activeId
        : DEFAULT_VARIANT_ID;
    state = { ...state, activeId: id };
    const view = board ? state.views?.[board] : undefined;
    if (view) {
      // The view's layers stand in for the override's, and its signals are applied as
      // the on-set (the same path a link's `sig` takes), so nothing of the variant's own
      // signal defaults leaks in. The override's theme still applies. A link's `sig`
      // replaces the view's signals exactly as it replaces an override's.
      const override = { ...state.overrides[id], layers: view.layers } as OverrideDelta;
      applyVariant(resolveVariant(id), override, url.sig ?? view.signals);
    } else {
      applyVariant(resolveVariant(id), state.overrides[id], url.sig);
      // This board has no view yet: the set just applied is its old single set. Hold it
      // (without the link's `sig`, which belongs to the link's board) for bootDone.
      if (board) bootFiling = { board, set: variantSet(resolveVariant(id), state.overrides[id]) };
    }
    // Subscribe ONCE, after the initial seed, so the seed isn't mis-captured as an
    // override and listeners don't stack on re-bootstrap (StrictMode / tests).
    if (!subscribed) {
      subscribed = true;
      layersStore.subscribe(captureOverride);
      signalsStore.subscribe(captureOverride);
      uiStore.subscribe(captureOverride);
    }
    persist();
    emit();
    return saved !== null;
  },
  setActive(id: string) {
    const v = resolveVariant(id);
    state = { ...state, activeId: v.id };
    applyVariant(v, state.overrides[v.id]);
    captureView(); // applyVariant ran under the guard, so the open view is filed here
    persist();
    emit();
  },
  resetToVariant() {
    const next = { ...state.overrides };
    delete next[state.activeId];
    state = { ...state, overrides: next };
    applyVariant(resolveVariant(state.activeId));
    captureView();
    persist();
    emit();
  },
  /**
   * The console has finished booting: the board is chosen and World is final. From here
   * on every change to World is filed under the open board (captureView).
   *
   * Files, once: the set bootstrap applied for the board the browser was last on, if it
   * had no view yet (the migration of a browser that saved before views existed, and the
   * way a shared link to ANOTHER board leaves this browser's own board intact), then
   * World as it stands under the board now open (a first visit's template, or a link's
   * sources filed under the link's board).
   */
  bootDone() {
    viewsLive = true;
    const views = { ...state.views };
    let changed = false;
    if (bootFiling && !views[bootFiling.board]) {
      views[bootFiling.board] = bootFiling.set;
      changed = true;
    }
    bootFiling = null;
    const active = activePresetStore.get();
    if (active) {
      const next = viewSetFromWorld(inspectorStore.get().world);
      if (!sameViewSet(views[active], next)) {
        views[active] = next;
        changed = true;
      }
    }
    if (changed) {
      state = { ...state, views };
      persist();
      emit();
    }
  },
  /** A board's own whole-map set, or null when it has none yet (a first visit). */
  viewSet(board: string): ViewSet | null {
    return state.views?.[board] ?? null;
  },
  /** Forget a board's set: "Reset this board" wants the template back. */
  forgetView(board: string) {
    if (!state.views?.[board]) return;
    const next = { ...state.views };
    delete next[board];
    state = { ...state, views: next };
    persist();
    emit();
  },
  /** Put a view's set on World, exactly. */
  applyViewSet(v: ViewSet) {
    writeViewSet(v);
  },
  /** Effective panel layout for a variant: a saved layout override, else the variant's own panels. */
  layoutForVariant(id: string): PanelPlacement[] {
    return state.layoutOverrides[id] ?? resolveVariant(id).panels;
  },
  /** Persist a per-variant layout override (the draft-commit save). */
  commitLayout(id: string, placements: PanelPlacement[]) {
    state = { ...state, layoutOverrides: { ...state.layoutOverrides, [id]: placements } };
    persist();
    emit();
  },
  /** Drop a per-variant layout override (back to the variant's own panels). */
  resetLayout(id: string) {
    if (!state.layoutOverrides[id]) return;
    const next = { ...state.layoutOverrides };
    delete next[id];
    state = { ...state, layoutOverrides: next };
    persist();
    emit();
  },
  get(): VariantStoreState { return state; },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function useVariant(): { activeId: string; edited: boolean } {
  const snap = useSyncExternalStore(variantStore.subscribe, variantStore.get, variantStore.get);
  return { activeId: snap.activeId, edited: !!snap.overrides[snap.activeId] };
}

export function useLayout(id: string): PanelPlacement[] {
  const snap = useSyncExternalStore(variantStore.subscribe, variantStore.get, variantStore.get);
  return snap.layoutOverrides[id] ?? resolveVariant(id).panels;
}
