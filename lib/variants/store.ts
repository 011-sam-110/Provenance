"use client";
import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { BUILTIN_BY_ID, BUILTIN_VARIANTS, DEFAULT_VARIANT_ID } from "@/lib/variants/builtins";
import type { OverrideDelta, PanelPlacement, Variant } from "@/lib/variants/types";
import { resolveSignals } from "@/lib/variants/resolveSignals";
import { diffFromVariant, isEmptyDelta } from "@/lib/variants/diff";
import { layersStore, DEFAULT_STATE, type LayerState } from "@/lib/layers";
import { inspectorStore } from "@/lib/shell/inspector";
import { signalsStore, type SignalState } from "@/lib/signals/store";
import { uiStore } from "@/lib/shell/ui";
import { cameraFilterStore } from "@/lib/cameraFilter";
import { mapViewStore } from "@/lib/mapView";
import { decodeViewState } from "@/lib/share/url";

interface VariantStoreState {
  activeId: string;
  userVariants: Variant[]; // populated by the SP1b editor; [] in SP1a
  overrides: Record<string, OverrideDelta>;
  layoutOverrides: Record<string, PanelPlacement[]>; // SP1b
}

const PERSIST_KEY = "tn.variant.v1";
const PERSIST_VERSION = 1;

let state: VariantStoreState = { activeId: DEFAULT_VARIANT_ID, userVariants: [], overrides: {}, layoutOverrides: {} };
let applying = false; // guard: suppress override-capture while seeding
let subscribed = false; // guard: subscribe captureOverride exactly once
const listeners = new Set<() => void>();

export function resolveVariant(id: string): Variant {
  const all = [...BUILTIN_VARIANTS, ...state.userVariants];
  return all.find((v) => v.id === id) ?? BUILTIN_BY_ID[DEFAULT_VARIANT_ID];
}

function applyVariant(v: Variant, override?: OverrideDelta, sigFromUrl?: string[]) {
  applying = true;
  try {
    const layers = { ...DEFAULT_STATE, ...v.layers, ...override?.layers } as LayerState;
    layersStore.applyExact(layers);

    let signals: SignalState = { ...resolveSignals(v.signals), ...override?.signals };
    // URL sig= is the authoritative on-set for a shared view — replace rather than merge with any local override.
    if (sigFromUrl) { signals = {}; for (const id of sigFromUrl) signals[id] = true; }
    signalsStore.applyExact(signals);

    uiStore.setTheme(override?.theme ?? v.theme);
    cameraFilterStore.setLiveOnly(v.cameraFilter?.liveOnly ?? false);
    if (typeof document !== "undefined") document.documentElement.style.setProperty("--accent", v.accent);
    if (v.view && typeof window !== "undefined") mapViewStore.flyToPoint({ lat: v.view.lat, lon: v.view.lon, zoom: v.view.zoom });
  } finally {
    applying = false;
  }
}

function persist() { savePersisted(PERSIST_KEY, PERSIST_VERSION, state); }
function emit() { for (const l of listeners) l(); }

function captureOverride() {
  if (applying) return;
  // Only World's toggles belong to a variant. layersStore/signalsStore now project
  // whichever source context is loaded, and they are what this is subscribed to, so
  // without this guard every toggle made INSIDE an area — and the act of loading one
  // — would be captured as the variant's override. Unloading would then leave the
  // globe wearing the area's set, which is exactly the leak the contexts model
  // exists to prevent.
  if (inspectorStore.get().loaded !== null) return;
  const v = resolveVariant(state.activeId);
  const delta = diffFromVariant(
    { layers: layersStore.get(), signals: signalsStore.get(), theme: uiStore.get().theme },
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
   */
  bootstrap(params: URLSearchParams) {
    const saved = loadPersisted<VariantStoreState>(PERSIST_KEY, PERSIST_VERSION);
    if (saved) state = { ...state, ...saved };
    const url = decodeViewState(params);
    const id =
      (BUILTIN_BY_ID[state.activeId] || state.userVariants.find((v) => v.id === state.activeId))
        ? state.activeId
        : DEFAULT_VARIANT_ID;
    state = { ...state, activeId: id };
    applyVariant(resolveVariant(id), state.overrides[id], url.sig);
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
  },
  setActive(id: string) {
    const v = resolveVariant(id);
    state = { ...state, activeId: v.id };
    applyVariant(v, state.overrides[v.id]);
    persist();
    emit();
  },
  resetToVariant() {
    const next = { ...state.overrides };
    delete next[state.activeId];
    state = { ...state, overrides: next };
    applyVariant(resolveVariant(state.activeId));
    persist();
    emit();
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
