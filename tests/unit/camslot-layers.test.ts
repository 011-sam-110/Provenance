import { afterEach, beforeEach, expect, test } from "vitest";
import { layersStore } from "@/lib/layers";
import { pickStore } from "@/lib/console/widgets/camslot.pick";
import { PICK_LAYERS, armPicking, revealPickLayers } from "@/lib/console/widgets/camslot.layers";

// What this file is for, and what it deliberately cannot say.
//
// It pins ONE promise: arming the camera picker switches on the layers the picker
// reads from. That promise is worth a test rather than a comment because it is
// invisible in the UI — the button that arms picking is not the control that shows
// the layers, so nothing on screen goes red if the wiring is dropped, and the bug
// it prevents ("no cameras in that area") reads as a truthful answer rather than
// as a failure.
//
// The node environment bounds the claim. Nothing here renders, so this does NOT
// cover the flyout's buttons, the WorldMap feed components that mount off the
// layer state, or whether Windy actually answers. It covers the store contract the
// three arming routes share.

// Both stores are module singletons, so state leaks between tests unless it is
// reset. "none" is the honest baseline here rather than "all": it is the only
// preset that leaves BOTH cameras and webcams off, which is the state the change
// exists to fix. (webcams is false in every preset — see lib/layers.ts — so an
// "all" baseline would make the webcams assertions pass for the wrong reason.)
beforeEach(() => {
  layersStore.applyPreset("none");
  pickStore.setMode("off");
});
afterEach(() => {
  layersStore.applyPreset("none");
  pickStore.setMode("off");
});

test("the picker draws from exactly the cameras and webcams layers", () => {
  // Pinned as a list, not asserted loosely, because it is the whole contract: if a
  // third source of pins is added to the pick paths and not added here, arming will
  // silently stop covering it.
  expect(PICK_LAYERS).toEqual(["cameras", "webcams"]);
});

test("revealPickLayers switches both pick layers on from cold", () => {
  expect(layersStore.get().cameras).toBe(false);
  expect(layersStore.get().webcams).toBe(false);

  revealPickLayers();

  expect(layersStore.get().cameras).toBe(true);
  expect(layersStore.get().webcams).toBe(true);
});

test("armPicking turns the pins on as well as the mode", () => {
  // The regression this exists to catch: arming through pickStore.setMode alone,
  // which is what all three entry points used to do. Picking would be ON with
  // nothing on the map to pick, and the area path would then report "no cameras in
  // that area" — a confident wrong answer to a question never asked.
  armPicking();

  expect(pickStore.get().mode).toBe("picking");
  expect(layersStore.get().cameras).toBe(true);
  expect(layersStore.get().webcams).toBe(true);
});

test("arming leaves the other core layers alone", () => {
  // It reveals what the picker reads and nothing else. A camera pick is not a
  // reason to start the planes or satellites feeds ticking.
  armPicking();

  expect(layersStore.get().planes).toBe(false);
  expect(layersStore.get().satellites).toBe(false);
  // The base reference layer is untouched either way — "none" leaves it on.
  expect(layersStore.get().countries).toBe(true);
});

test("stopping picking leaves the layers up", () => {
  // Deliberate, and the reason is in camslot.layers.ts: nothing records what was on
  // before arming, so "restore" could only mean "turn off", which is a different
  // thing and wrong for a user who had cameras on all along.
  armPicking();
  pickStore.setMode("off");

  expect(pickStore.get().mode).toBe("off");
  expect(layersStore.get().cameras).toBe(true);
  expect(layersStore.get().webcams).toBe(true);
});

test("arming twice is idempotent", () => {
  armPicking();
  armPicking();

  expect(layersStore.get().cameras).toBe(true);
  expect(layersStore.get().webcams).toBe(true);
  expect(pickStore.get().mode).toBe("picking");
});

test("arming does not disturb a layer the user already turned on", () => {
  layersStore.set("planes", true);

  armPicking();

  expect(layersStore.get().planes).toBe(true);
});
