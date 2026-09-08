// WHEN THE SOURCES RAIL MUST OFFER A WAY OUT OF A DRAWN AREA.
//
// Two separate models can put a drawn ring between the user and the whole world,
// and lib/map/aoi.ts is explicit that they are not the same thing:
//
//   the SCOPE   one ring at a time, a FILTER over the whole console
//               (lib/shell/scope.ts — `mode: "aoi"`, cleared by `clearAoi()`)
//   the AREAS   the Inspector's list, all live at once, each carrying its own
//               sources (lib/shell/inspector.ts — `editing` points the rail at one)
//
// The map rail's "Restrict results to an area" flyout used to set the first and
// held the ONLY `clearAoi` call in the product. It is gone, and an `aoi` scope
// SURVIVES A RELOAD by design — `coerceSavedScope` keeps it, and its own comment
// justifies that by saying the drawn area "IS both settable and clearable from
// the map rail". That justification expired with the flyout, so without a
// replacement anyone who ever drew one stays filtered with nothing on screen to
// say why.
//
// THE PREDICATE IS AN `OR`, AND THAT IS THE WHOLE POINT. Gating the control on
// `editing` alone reads correctly — "put an ✕ next to the area you are editing" —
// and would miss the exact population it exists for: a returning user whose
// persisted state is a filtered scope with the rail pointed at World, because
// drawing a scope ring never set `editing` in the first place.
//
// Pure and DOM-free so it can be pinned in the node vitest environment; there are
// no component tests in this repo, so a rule left inside the JSX has no guard at
// all. See tests/unit/clear-area.test.ts.

import type { ScopeMode } from "@/lib/shell/scope";

/**
 * Pure: should the context switcher show its "clear the drawn area" control?
 *
 * @param editingAreaId which context the Sources rail writes to; null is World.
 * @param scopeMode     the console-wide scope's mode.
 */
export function needsClearArea(editingAreaId: string | null, scopeMode: ScopeMode): boolean {
  return editingAreaId !== null || scopeMode === "aoi";
}

/**
 * Pure: the control's accessible name.
 *
 * It states the EFFECT and names the area, because "✕" read out on its own is a
 * glyph and this is the one control standing between a user and a filter they
 * cannot otherwise remove. The same string is the `title`, so a pointer user and
 * a screen-reader user are told the same thing.
 */
export function clearAreaLabel(areaLabel: string | null): string {
  return areaLabel
    ? `Clear ${areaLabel} and go back to World`
    : "Clear the drawn area and go back to World";
}
