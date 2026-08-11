import { describe, expect, it } from "vitest";
// Side-effect import: registers every console widget exactly as the app does.
import "@/lib/console/widgets";
import { getWidgetType, listWidgetTypes } from "@/lib/console/registry";
import {
  genericCoreIds,
  rollupWidgetId,
  sourceWidgetId,
  widgetTypeForGroup,
  widgetTypeForSource,
} from "@/lib/console/sourceWidgets";
import { catalogByGroup, CORE_IDS, SOURCE_CATALOG } from "@/lib/sources/catalog";
import { SIGNALS } from "@/lib/signals/registry";

// THE BUG THIS FILE EXISTS FOR.
//
// The Source Catalog rail's ＋ button used to write a placement into variantStore's
// dock layout. Nothing has rendered that layout since the console rebuild, so the
// click persisted state, ticked the rail's own "N ▦" counter, and changed nothing
// on screen — the button was dead while looking like it worked.
//
// The fix is a mapping from a catalog source to a REGISTERED console widget type,
// and the thing worth testing is exactly that: every row the rail can show must
// resolve to a widget type the console can actually render. A mapping that points
// at an unregistered id is the same failure wearing a different hat.

describe("every catalog row maps to a widget the console can render", () => {
  it("resolves a registered widget type for every source in the catalog", () => {
    const unrenderable = SOURCE_CATALOG.map((s) => ({ id: s.id, type: widgetTypeForSource(s.id) })).filter(
      (x) => !getWidgetType(x.type),
    );
    expect(
      unrenderable,
      `these rail rows would add a widget type nothing renders:\n  ${unrenderable
        .map((x) => `${x.id} → ${x.type}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("resolves a registered roll-up widget for every catalog category", () => {
    const missing = catalogByGroup()
      .map((g) => ({ group: g.group, type: widgetTypeForGroup(g.group) }))
      .filter((x) => !getWidgetType(x.type));
    expect(missing).toEqual([]);
  });

  it("sends a signal to its own per-signal card, not a generic leaf", () => {
    for (const s of SIGNALS) expect(widgetTypeForSource(s.id)).toBe(`signal:${s.id}`);
  });

  it("reuses the bespoke card when a core layer already has one", () => {
    // Planes are shown by the Aviation card. Adding a second "Planes" widget beside
    // it would be two cards over one feed, which is how a workspace fills with noise.
    expect(widgetTypeForSource("planes")).toBe("aviation");
    expect(widgetTypeForSource("cameras")).toBe("cameras");
    expect(widgetTypeForSource("satellites")).toBe("satellites");
  });

  it("falls back to a generic leaf only for core sources with no bespoke card", () => {
    for (const id of genericCoreIds(CORE_IDS)) {
      expect(widgetTypeForSource(id)).toBe(sourceWidgetId(id));
      expect(getWidgetType(sourceWidgetId(id))).toBeDefined();
    }
    // Whatever that set is today, it must not have swallowed a core layer that
    // already has a bespoke card.
    expect(genericCoreIds(CORE_IDS)).not.toContain("planes");
  });

  it("gives every registered roll-up a title that names its category", () => {
    for (const g of catalogByGroup()) {
      const t = getWidgetType(rollupWidgetId(g.group))!;
      expect(t.title).toContain(g.group);
      expect(t.category).toBe(g.group);
    }
  });

  it("registers no roll-up or leaf that the catalog no longer describes", () => {
    const known = new Set([
      ...catalogByGroup().map((g) => rollupWidgetId(g.group)),
      ...genericCoreIds(CORE_IDS).map(sourceWidgetId),
    ]);
    const orphans = listWidgetTypes()
      .map((t) => t.id)
      .filter((id) => (id.startsWith("rollup:") || id.startsWith("source:")) && !known.has(id));
    expect(orphans).toEqual([]);
  });
});
