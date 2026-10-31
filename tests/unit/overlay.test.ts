import { beforeEach, expect, test } from "vitest";
import { overlay } from "@/lib/overlay";
import type { WorldObject } from "@/lib/world";
import { railTabStore } from "@/lib/console/railTab";
import { sourcesRailStore } from "@/lib/console/sourcesRail";
import { openPanel, readPanel } from "@/lib/console/consolePanel";

const cam: WorldObject = {
  kind: "camera",
  id: "tfl:JamCams_00001.07450",
  lat: 51.5174,
  lon: -0.2126,
  label: "A40 Westway/Woodger Rd",
  meta: { available: true },
};

beforeEach(() => {
  overlay.close();
  railTabStore.set("sources");
  sourcesRailStore.setOpen(false);
});

test("starts (and resets) closed", () => {
  expect(overlay.get().object).toBeNull();
});

test("open() exposes the clicked object", () => {
  overlay.open(cam);
  expect(overlay.get().object).toBe(cam);
});

test("close() clears the open object", () => {
  overlay.open(cam);
  overlay.close();
  expect(overlay.get().object).toBeNull();
});

test("opening a second object replaces the first (single-window)", () => {
  const other: WorldObject = { ...cam, id: "tfl:other", label: "Other" };
  overlay.open(cam);
  overlay.open(other);
  expect(overlay.get().object).toBe(other);
});

test("subscribers are notified on open and close", () => {
  let n = 0;
  const unsub = overlay.subscribe(() => n++);
  overlay.open(cam); // 1
  overlay.close(); // 2
  unsub();
  overlay.open(cam); // not counted (unsubscribed)
  expect(n).toBe(2);
});

test("close() is a no-op (no emit) when already closed", () => {
  let n = 0;
  const unsub = overlay.subscribe(() => n++);
  overlay.close(); // already closed by beforeEach → early return, no emit
  unsub();
  expect(n).toBe(0);
});

test("open() brings up the Inspector panel", () => {
  overlay.open(cam);
  expect(railTabStore.get().tab).toBe("inspector");
  expect(sourcesRailStore.get().open).toBe(true);
});

test("close() from Sources goes back to Sources, and the panel stays open", () => {
  // Someone reading a dossier they opened from the Sources list goes back to that list.
  openPanel("sources");
  overlay.open(cam);
  expect(readPanel()).toBe("inspector");
  overlay.close();
  expect(readPanel()).toBe("sources");
  expect(sourcesRailStore.get().open).toBe(true);
});

test("close() of an object clicked with no panel open gives the map back", () => {
  overlay.open(cam);
  expect(readPanel()).toBe("inspector");
  overlay.close();
  expect(readPanel()).toBeNull();
});

test("open() over a tool lands on the object, and close() goes back to the tool", () => {
  openPanel("draw");
  overlay.open(cam);
  expect(readPanel()).toBe("inspector");
  overlay.close();
  expect(readPanel()).toBe("draw");
});
