import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Two things about the Sources rail that no other test can see, both found by trying
// to land a legibility pass on it.
//
// vitest here is `environment: "node"` and collects `tests/unit/**/*.test.ts` only, so
// nothing in this suite renders a component or resolves a stylesheet. These are source
// assertions, which are normally the weak kind. They are here because the two failures
// below are SILENT: each one leaves every other test in the repo green, ships, and
// then hides data or hides a control.

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const CATALOG = "components/shell/SourceCatalog.tsx";
const CSS = "app/globals.css";

describe("the time window keeps a live setter", () => {
  it("THE ONLY CALLER OF timeWindowStore.set IS STILL RENDERED SOMEWHERE MOUNTED", () => {
    // The failure this exists for, caught in review rather than in a test run.
    //
    // `TimeWindowControl` is the only thing in the app that calls
    // `timeWindowStore.set`. `ConsoleTopBar.tsx` also renders one, but NOTHING renders
    // ConsoleTopBar — it is dead code — so SourceCatalog is the single live host.
    //
    // The window is persisted as `tn.timewindow.v1` and hydrated on mount. So deleting
    // this one render does not merely remove a control: it strands anyone who ever
    // chose "1h" at 1h permanently, with older events missing from the Events widget
    // and no way anywhere in the product to put it back. The default is "all", which
    // never filters, so a developer who never touched the control sees nothing wrong.
    //
    // If the rail should lose it, the same change has to give it another home — the
    // Events widget is the honest one, since that is what the window filters. Moving
    // it will fail this test, which is the point: update the assertion deliberately,
    // naming the new host, rather than deleting the control and the test together.
    const src = read(CATALOG);
    expect(src).toMatch(/import\s+TimeWindowControl\s+from\s+"@\/components\/shell\/TimeWindowControl"/);
    expect(src).toContain("<TimeWindowControl />");
  });

  it("the control is still the thing that sets the store", () => {
    // Guards the other half: a refactor that keeps the component but moves the setter
    // out of it would satisfy the assertion above while breaking the same way.
    expect(read("components/shell/TimeWindowControl.tsx")).toContain("timeWindowStore.set");
  });
});

describe("the rail header does not scroll away", () => {
  it("IS STICKY, because it lives inside the rail's own scroll container", () => {
    // `.tn-rail` sets `overflow-y: auto` and `.tn-rail-header` is a child of it, so
    // without this the title AND the ‹ close button leave the viewport together as
    // soon as the source list is scrolled — which is exactly the complaint that
    // prompted this pass. An earlier attempt answered it by turning the title itself
    // into a second close button; that does not work, because the title scrolls away
    // for the same reason the chevron does.
    const css = read(CSS);
    const block = css.slice(css.indexOf(".tn-rail-header {"));
    const rule = block.slice(0, block.indexOf("}") + 1);
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*0/);
    // Opaque, or the list shows through it while scrolling under it.
    expect(rule).toMatch(/background:\s*var\(--tn-surface\)/);
  });

  it("AND THE RAIL HAS NO TOP PADDING, or rows show through ABOVE the pinned header", () => {
    // Found by measuring the first version of this in the browser, not by reading it.
    // `.tn-rail` is its own scroll container, and a scroll container clips at its
    // PADDING box, so scrolled content is painted through the top padding. With
    // `padding: 12px ...` on the rail and `margin-top: -12px` on the header, sticky
    // pins the header's MARGIN box to the scrollport, which left the border box 12px
    // lower and a source row visible in the strip above it —
    // `elementsFromPoint(railLeft + w/2, railTop + 6)` returned `.tn-src-row`.
    //
    // The fix is that the header carries that 12px itself. Restoring a top padding
    // here re-opens the gap in a way no other test can see, so this asserts the
    // FIRST value of the shorthand and nothing else about the rule.
    const css = read(CSS);
    const block = css.slice(css.indexOf(".tn-rail {"));
    const rule = block.slice(0, block.indexOf("}") + 1);
    const padding = /padding:\s*([^;]+);/.exec(rule);
    expect(padding).not.toBeNull();
    expect(padding![1].trim().split(/\s+/)[0]).toBe("0");
  });
});
