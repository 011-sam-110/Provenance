import { beforeEach, expect, test } from "vitest";
import { railTabStore } from "@/lib/console/railTab";

beforeEach(() => railTabStore.set("sources"));

test("starts on the Sources tab", () => {
  expect(railTabStore.get().tab).toBe("sources");
});

test("set() moves between tabs", () => {
  railTabStore.set("inspector");
  expect(railTabStore.get().tab).toBe("inspector");
  railTabStore.set("sources");
  expect(railTabStore.get().tab).toBe("sources");
});

test("set() to the current tab does not emit", () => {
  let n = 0;
  const unsub = railTabStore.subscribe(() => n++);
  railTabStore.set("sources"); // already sources → no emit
  railTabStore.set("inspector"); // 1
  railTabStore.set("inspector"); // no emit
  unsub();
  expect(n).toBe(1);
});
