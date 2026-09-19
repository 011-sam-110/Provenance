import { expect, test } from "vitest";
// Side-effect import: the registry is filled by the widget modules on import, the
// same way SourceRow and CommandPalette populate it before asking it anything.
import "@/lib/console/widgets";
import { getWidgetType } from "@/lib/console/registry";
import { RAIL_SOURCES } from "@/lib/console/sources/railSources";
import { buildSourceSections } from "@/lib/console/sources/sections";
import { widgetTypeForSource, genericCoreIds } from "@/lib/console/sourceWidgets";
import { isSourceWidgetOpen } from "@/lib/widgets/dock";
import { CORE_IDS } from "@/lib/sources/catalog";
import { NEWS_ATTRIBUTION } from "@/lib/news/sources";

// World Headlines could be placed only from the shortcuts palette, which means it
// could be placed only by someone who already knew it existed. These tests pin the
// rail route end to end: the row is there, its ＋ resolves to the real widget, and
// nothing about it claims to paint the map.

const rows = buildSourceSections(RAIL_SOURCES).flatMap((s) =>
  s.rows.map((r) => ({ ...r, section: s.id })),
);
const news = rows.find((r) => r.id === "news");

test("the Sources rail carries a World Headlines row", () => {
  expect(news, "no news row in the rail — it is back to shortcuts-only").toBeDefined();
  expect(news!.label).toBe("World Headlines");
});

test("the row sits in a section that already existed, not a heading of its own", () => {
  // Intel folds into "Conflict & security", beside the News coverage layer. A row
  // landing in "other" means its group was never mapped in sections.ts.
  expect(news!.section).toBe("security");
  expect(news!.group).toBe("Intel");
});

// THE ACTUAL REGRESSION. widgetTypeForSource used to ask kindOf() first, and
// kindOf() answers "signal" for every id it does not recognise — so the ＋ asked
// for a "signal:news" widget that no registry entry defines, getWidgetType()
// returned undefined, and SourceRow disabled the button as "has no dashboard
// widget". The row would have been visible and dead.
test("the row's ＋ resolves to the registered World Headlines widget", () => {
  const type = widgetTypeForSource("news");
  expect(type).toBe("headlines");
  const widget = getWidgetType(type);
  expect(widget, "the ＋ would render disabled").toBeDefined();
  expect(widget!.title).toBe("World Headlines");
});

test("the ＋ lights up once the widget is on the workspace", () => {
  expect(isSourceWidgetOpen("news", new Set(["headlines"]))).toBe(true);
  expect(isSourceWidgetOpen("news", new Set(["aviation"]))).toBe(false);
});

test("the row claims no map layer, so the rail draws it no toggle", () => {
  expect(news!.widgetOnly).toBe(true);
});

test("the rail credits the same feeds the widget does", () => {
  expect(news!.attribution).toBe(NEWS_ATTRIBUTION);
  expect(getWidgetType("headlines")!.help!.source).toBe(NEWS_ATTRIBUTION);
});

// Routing news through the bespoke-widget map must not change what the four core
// layers resolve to, which is what genericCoreIds reads the same map for.
test("the core layers still resolve exactly as before", () => {
  expect(widgetTypeForSource("livecams")).toBe("camslot");
  expect(widgetTypeForSource("planes")).toBe("aviation");
  expect(widgetTypeForSource("satellites")).toBe("satellites");
  expect(widgetTypeForSource("staticcams")).toBe("camslot");
  // EMPTY, where it used to hold the old `webcams` row: every core row now has a
  // bespoke card, so nothing falls through to the generic leaf.
  expect(genericCoreIds(CORE_IDS)).toEqual([]);
});
