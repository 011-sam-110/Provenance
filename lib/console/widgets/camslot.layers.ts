"use client";
// ── Arming the picker turns its pins on ──────────────────────────────────────
//
// Picking cameras off a map with no camera pins on it is not a hard mode to get
// into — until now it was the DEFAULT one for webcams, which ship off. The tool
// then failed in the one way this codebase works hardest to avoid: it answered a
// question it had never asked. `camslot.area.ts` and `WorldMap.pickBoxSelection`
// both had to carry a branch distinguishing "your ring is empty" from "we were
// not looking", and the best either could do was tell the user to go and find a
// layer toggle and then repeat the gesture.
//
// So the arming step switches the layers on itself. Asked for directly: "make it
// so the pick cameras for a wall automatically turns on cameras and webcams".
//
// WHY A MODULE AND NOT A LINE IN EACH BUTTON. Three separate controls arm
// picking — the map rail's Cameras flyout, its By area button (via
// startAreaPick), and "◎ Pick cameras on the map" inside an empty camera wall.
// The trap is identical from all three, so the fix has to be. `armPicking()` is
// the one door, and a fourth entry point added later gets the behaviour by using
// the same function rather than by remembering this.
//
// WHY NOT INSIDE pickStore.setMode(). That was the first shape and it is wrong.
// camslot.pick.ts is the basket MODEL: it is imported by node unit tests, and
// layersStore.set persists through localStorage on every emit, so the store would
// have grown a jsdom dependency to serve a concern that is not its own. Arming is
// a UI act; the basket is a data structure.
//
// WHY IT DOES NOT PUT THE LAYERS BACK. Stopping picking leaves them on. Turning
// off a layer the user can currently see is a bigger surprise than leaving one
// on, and it would also be a guess: nothing records whether the user had cameras
// on before they started, so "restore" would mean "turn off", which is a
// different thing and wrong for anyone who had them on all along.
//
// THE COST, STATED RATHER THAN BURIED. `webcams` defaults to false on purpose and
// is deliberately excluded from the layer presets — lib/layers.ts explains why it
// is a keyed, rate-limited global sample that stays opt-in. This reverses that for
// one gesture, and that is a real trade, not an oversight. What keeps it honest is
// WHERE the call sits: it fires on the arming action, never on mount and never on
// opening the flyout, so nothing fetches Windy until someone has deliberately
// pressed a button that says it is about to collect cameras. The opt-in did not
// disappear; it moved from a toggle users could not find to the gesture they
// actually performed.

import { layersStore, type LayerKey } from "@/lib/layers";
import { pickStore } from "@/lib/console/widgets/camslot.pick";

/**
 * The core layers a camera pick draws from.
 *
 * These are exactly the two stores the pick paths read — `loadedCamerasStore`
 * (road cameras) and `loadedWebcamsStore` (the Windy sample) — and each is
 * populated only while its layer is on, because WorldMap gates the feed
 * component itself (`{layers.webcams && <WebcamsFeed …/>}`). Switching the layer
 * on is therefore what starts the fetch, not merely what reveals it.
 *
 * Exported so a test can assert the list rather than restate it.
 */
export const PICK_LAYERS: readonly LayerKey[] = ["cameras", "webcams"];

/**
 * Switch on every layer a pick can draw from. Idempotent — `layersStore.set`
 * early-returns when the value is unchanged, so this neither re-emits nor
 * re-persists for a layer that was already on.
 */
export function revealPickLayers(): void {
  for (const key of PICK_LAYERS) layersStore.set(key, true);
}

/**
 * Arm picking: the pins come on, then the mode goes on.
 *
 * ORDER MATTERS, though only by a frame. The feed components mount off the layer
 * state, so switching the layers first means the fetch is already in flight by the
 * time the tray appears — rather than the user seeing "SELECTED 0" over an empty
 * map for a beat and concluding the tool is broken.
 */
export function armPicking(): void {
  revealPickLayers();
  pickStore.setMode("picking");
}
