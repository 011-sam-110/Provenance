import { expect, test } from "vitest";
import { cameraFilterStore } from "@/lib/cameraFilter";

// `liveOnly` was removed with the camera tier split — "only cameras with a playable
// stream" is the `livecams` layer toggle now, not a tick hidden under the camera
// legend. See lib/cameraFilter.ts. What is left here is the OPERATOR filter, and the
// assertions below are the same ones minus that axis.
test("passes() respects region toggles and ignores the live flag", () => {
  // Default: every region visible.
  expect(cameraFilterStore.passes("tfl", false)).toBe(true);
  expect(cameraFilterStore.passes("caltrans", true)).toBe(true);

  // The live flag is NOT a filter here any more — a still camera from a visible
  // operator passes, which is what lets the Static cams layer draw anything at all.
  expect(cameraFilterStore.passes("caltrans", false)).toBe(true);

  // Hiding a region drops it even when live.
  cameraFilterStore.toggleRegion("caltrans");
  expect(cameraFilterStore.passes("caltrans", true)).toBe(false);
  expect(cameraFilterStore.passes("caltrans", false)).toBe(false);

  // Unknown sources default to visible.
  expect(cameraFilterStore.passes("mystery", true)).toBe(true);

  // Reset the singleton so other tests are unaffected.
  cameraFilterStore.toggleRegion("caltrans");
});
