import { afterEach, expect, test } from "vitest";
import { shellLayoutStore } from "@/lib/console/store";
import { createDefaultLayout, MAX_WIDGETS } from "@/lib/console/types";

afterEach(() => shellLayoutStore.replace(createDefaultLayout()));

test("add returns the new id and lands the widget", () => {
  const r = shellLayoutStore.add("aviation", { segment: "left" });
  expect(r.ok).toBe(true);
  expect(shellLayoutStore.get().widgets.find((w) => w.id === r.id)?.type).toBe("aviation");
});

test("add past the widget cap is rejected with ok:false", () => {
  for (let i = 0; i < MAX_WIDGETS; i++) shellLayoutStore.add("aviation");
  const r = shellLayoutStore.add("aviation");
  expect(r.ok).toBe(false);
  expect(shellLayoutStore.get().widgets.length).toBe(MAX_WIDGETS);
});

test("subscribers fire on mutation", () => {
  let n = 0;
  const unsub = shellLayoutStore.subscribe(() => n++);
  shellLayoutStore.add("events");
  shellLayoutStore.stage("clock");
  unsub();
  shellLayoutStore.add("events"); // not counted
  expect(n).toBe(2);
});
