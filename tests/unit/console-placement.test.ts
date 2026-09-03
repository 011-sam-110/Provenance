// tests/unit/console-placement.test.ts
//
// lib/console/placement.ts is a one-request store: exactly one pending
// "where should this widget go?" question at a time, never persisted (a
// reload must not resurrect a half-asked question). vitest runs in the node
// environment here, so there is no `window` and no DOM — these tests exercise
// the store only, not the picker component, following the house idiom in
// tests/unit/console-boards.test.ts (stub `window`, import modules
// dynamically inside each test).

import { afterEach, beforeEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function installStorage(): void {
  // placement.ts never calls localStorage, but stubbing window keeps this
  // test file consistent with every other console store test and safe if a
  // future edit adds a read of it.
  (globalThis as { window?: unknown }).window = { localStorage: undefined };
}

beforeEach(async () => {
  installStorage();
  // The store is a module-level singleton, so it survives between tests in
  // this file (dynamic import returns the same cached instance) — reset any
  // request a previous test left pending before the next one starts.
  const { placementStore } = await import("@/lib/console/placement");
  placementStore.cancel();
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("a fresh store has no pending request", async () => {
  const { placementStore } = await import("@/lib/console/placement");
  expect(placementStore.get()).toBeNull();
});

test("ask() sets the pending request", async () => {
  const { placementStore } = await import("@/lib/console/placement");
  placementStore.ask({ type: "wildfires", label: "Wildfires" });
  expect(placementStore.get()).toEqual({ type: "wildfires", label: "Wildfires" });
});

test("cancel() clears the pending request", async () => {
  const { placementStore } = await import("@/lib/console/placement");
  placementStore.ask({ type: "wildfires", label: "Wildfires" });
  placementStore.cancel();
  expect(placementStore.get()).toBeNull();
});

test("a second ask() REPLACES the pending request rather than queuing it", async () => {
  const { placementStore } = await import("@/lib/console/placement");
  placementStore.ask({ type: "wildfires", label: "Wildfires" });
  placementStore.ask({ type: "flights", label: "Flights", config: { region: "EU" }, height: 240 });
  // Only the second question is live — there is no queue to drain later.
  expect(placementStore.get()).toEqual({
    type: "flights", label: "Flights", config: { region: "EU" }, height: 240,
  });
});

test("subscribe() fires on every change, and the returned function unsubscribes", async () => {
  const { placementStore } = await import("@/lib/console/placement");
  let calls = 0;
  const unsubscribe = placementStore.subscribe(() => { calls += 1; });

  placementStore.ask({ type: "wildfires", label: "Wildfires" });
  expect(calls).toBe(1);

  placementStore.ask({ type: "flights", label: "Flights" });
  expect(calls).toBe(2);

  placementStore.cancel();
  expect(calls).toBe(3);

  unsubscribe();
  placementStore.ask({ type: "ships", label: "Ships" });
  // The listener was removed — a fourth ask() must not reach it.
  expect(calls).toBe(3);
});

test("cancel() on an already-empty store does not notify subscribers", async () => {
  const { placementStore } = await import("@/lib/console/placement");
  let calls = 0;
  placementStore.subscribe(() => { calls += 1; });
  placementStore.cancel();
  // Nothing was pending, so there is nothing to announce — a spurious emit
  // here would re-render every subscriber for a no-op.
  expect(calls).toBe(0);
});

test("usePlacementRequest's server snapshot MUST be null", () => {
  // useSyncExternalStore takes three arguments: subscribe, client snapshot,
  // server snapshot. There is no jsdom here to actually render the hook and
  // observe SSR behaviour, so this reads the source directly for the third
  // argument — it must be a literal `() => null`, never `placementStore.get`
  // or anything that could read a pending request. A question is raised by a
  // client-side click; claiming one exists during server rendering would
  // hydrate a modal the server never had a reason to draw.
  const src = readFileSync(join(process.cwd(), "lib", "console", "placement.ts"), "utf8");
  const call = src.match(/useSyncExternalStore\(([\s\S]*?)\);/);
  expect(call, "usePlacementRequest must call useSyncExternalStore").not.toBeNull();
  const args = call![1].split(",").map((s) => s.trim());
  expect(args[2]).toBe("() => null");
});
