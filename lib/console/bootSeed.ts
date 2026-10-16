"use client";
// THE BOARD STEP OF CONSOLE BOOT, out of ConsoleShell so it runs without React.
//
// ConsoleShell's hydrate effect runs variantStore.bootstrap() first, and that is the
// step that puts World's map state back: the variant, the user's saved toggles (the
// override delta in tn.variant.v1) and a shared link's `?sig=`. Everything here runs
// AFTER it, so anything here that writes World's set overwrites what bootstrap restored.
//
// THAT IS WHAT THE OLD FIRST-RUN SEED DID ON EVERY RELOAD. Its test was "the board has
// no widgets", and the landing board (Globe) HAS no widgets by design, so the seed was
// not first-run at all: it fired on every boot of anyone who was on Globe.
// applyPreset("overview") then switched every signal off and the core layers back to
// the board's floor, after bootstrap had restored them. captureOverride saw that write,
// so the next save of tn.variant.v1 made the loss permanent. A `?sig=` link lost its
// layers the same way, and the URL writer then dropped `sig` from the address bar.
// Measured on prod: one reload turned every saved signal toggle off.
//
// So the seed now needs a TRUE first run: nothing saved by the variant spine and no
// board ever opened. A returning user keeps the board their layout hydrated to and the
// map state bootstrap restored.

import { applyPreset, presetById, DEFAULT_PRESET_ID } from "@/lib/console/presets";
import { decodeLayout } from "@/lib/console/share";
import { shellLayoutStore } from "@/lib/console/store";
import { signalsStore, type SignalState } from "@/lib/signals/store";
import { decodeViewState } from "@/lib/share/url";

export interface BootSeedInput {
  /** `?c=`: an encoded layout from a share link. */
  c: string | null;
  /** `?preset=`, as given. Validated here against the registry. */
  preset: string | null;
  /** True when `preset` names a board that exists. */
  presetKnown: boolean;
  /** Widgets on the board after shellLayoutStore.hydrate(). */
  widgetCount: number;
  /** No saved variant state and no saved active board: this browser has never booted the console. */
  firstRun: boolean;
  /** `?sig=` as decodeViewState read it; undefined when the link has none. */
  sig: string[] | undefined;
}

export type BootBoard =
  | { kind: "layout"; encoded: string }
  | { kind: "preset"; id: string }
  | { kind: "none" };

export interface BootSeedPlan {
  board: BootBoard;
  /**
   * The signal on-set to put back on World after the board is applied, or null.
   *
   * A preset writes World's whole signal set. A `?sig=` link is the authoritative
   * on-set for a shared view (variantStore applies it the same way), so when a preset
   * runs at boot the link's set is applied again on top of it. `?c=` writes only the
   * layout, so it needs nothing re-applied.
   */
  reassertSig: string[] | null;
}

/** Pure: which board to open at boot, and whether `?sig=` must be applied again after it. */
export function planBootSeed(input: BootSeedInput): BootSeedPlan {
  // `?c=` outranks `?preset=`: a saved layout is a complete workspace someone chose to
  // share, a preset is only a starting point, so a link carrying both means the layout.
  if (input.c) return { board: { kind: "layout", encoded: input.c }, reassertSig: null };
  // VALIDATED AGAINST THE REGISTRY, never applied as given: applyPreset on an unknown
  // id would be a silent no-op. An unrecognised id falls through to the first-run seed.
  let board: BootBoard = { kind: "none" };
  if (input.preset && input.presetKnown) board = { kind: "preset", id: input.preset };
  else if (input.firstRun && input.widgetCount === 0) board = { kind: "preset", id: DEFAULT_PRESET_ID };
  const reassertSig = board.kind === "preset" && input.sig ? input.sig : null;
  return { board, reassertSig };
}

/** Pure: is this the first boot of the console in this browser? */
export function isFirstRun(state: { restoredVariant: boolean; activeBoard: string | null }): boolean {
  return !state.restoredVariant && state.activeBoard === null;
}

/**
 * Open the boot board. Call once from ConsoleShell, after every store has hydrated.
 * `firstRun` comes from isFirstRun().
 */
export function seedBoard(params: URLSearchParams, firstRun: boolean): void {
  const presetParam = params.get("preset");
  const plan = planBootSeed({
    c: params.get("c"),
    preset: presetParam,
    presetKnown: Boolean(presetParam && presetById(presetParam)),
    widgetCount: shellLayoutStore.get().widgets.length,
    firstRun,
    sig: decodeViewState(params).sig,
  });
  if (plan.board.kind === "layout") {
    const l = decodeLayout(plan.board.encoded);
    if (l) shellLayoutStore.replace(l);
  } else if (plan.board.kind === "preset") {
    applyPreset(plan.board.id, { track: false });
  }
  if (plan.reassertSig) {
    const on: SignalState = {};
    for (const id of plan.reassertSig) on[id] = true;
    signalsStore.applyWorld(on);
  }
}
