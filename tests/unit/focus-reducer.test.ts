// tests/unit/focus-reducer.test.ts
import { describe, it, expect } from "vitest";
import { createDefaultLayout } from "@/lib/console/types";
import { setFocus, addWidget, removeWidget } from "@/lib/console/reducers";

describe("focus reducer", () => {
  it("defaults to no focused widget", () => {
    expect(createDefaultLayout().focusedWidgetId).toBeNull();
  });

  it("setFocus sets and clears the focused id", () => {
    const l0 = createDefaultLayout();
    const l1 = setFocus(l0, "wabc");
    expect(l1.focusedWidgetId).toBe("wabc");
    expect(setFocus(l1, null).focusedWidgetId).toBeNull();
  });

  it("removing the focused widget clears focus", () => {
    let l = addWidget(createDefaultLayout(), "events", "w1", { segment: "left" });
    l = setFocus(l, "w1");
    l = removeWidget(l, "w1");
    expect(l.focusedWidgetId).toBeNull();
  });

  it("removing a different widget leaves focus intact", () => {
    let l = addWidget(createDefaultLayout(), "events", "w1", { segment: "left" });
    l = addWidget(l, "markets", "w2", { segment: "left" });
    l = setFocus(l, "w1");
    l = removeWidget(l, "w2");
    expect(l.focusedWidgetId).toBe("w1");
  });
});
