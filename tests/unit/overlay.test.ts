import { beforeEach, expect, test } from "vitest";
import { overlay } from "@/lib/overlay";
import type { WorldObject } from "@/lib/world";
import { railTabStore } from "@/lib/console/railTab";
import { sourcesRailStore } from "@/lib/console/sourcesRail";

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

test("open() points the Sources rail at the Inspector tab and expands it", () => {
  overlay.open(cam);
  expect(railTabStore.get().tab).toBe("inspector");
  expect(sourcesRailStore.get().open).toBe(true);
});

test("close() returns the rail to the Sources tab but leaves it open", () => {
  overlay.open(cam);
  overlay.close();
  expect(railTabStore.get().tab).toBe("sources");
  expect(sourcesRailStore.get().open).toBe(true);
});
