import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withinWindow } from "@/lib/shell/timeWindow";

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

describe("the time window cannot strand anyone", () => {
  // WHAT CHANGED, 2026-09-05. This block used to assert that SourceCatalog still
  // rendered <TimeWindowControl />, because that was the only live caller of
  // timeWindowStore.set and deleting it would strand anyone who had chosen "1h" --
  // filtered forever, with no control anywhere to undo it.
  //
  // The control has now been taken off the rail deliberately. So the old assertion is
  // gone, but the FAILURE it protected against is not, and this is the same guard
  // rewritten around the thing that actually prevents it now: with no setter mounted,
  // `hydrate()` must not restore a persisted window. Either half alone is the bug --
  // a control with no hydration merely forgets your choice, but hydration with no
  // control silently filters your data with no way back.
  //
  // Stated as one rule, so it stays true whichever way this is taken later:
  //   a persisted window may be restored ONLY IF something mounted can change it.

  // The two components that could plausibly host it. ConsoleTopBar used to be a third
  // and was deleted in the same change: nothing rendered it, so its <TimeWindowControl />
  // was the dead import of a dead component -- a "host" that would have made this check
  // pass while no user could reach the control.
  const HOSTS = ["components/shell/SourceCatalog.tsx", "components/console/ConsoleWorkspace.tsx"];
  const setterIsMounted = HOSTS.some((f) => read(f).includes("<TimeWindowControl />"));

  it("has no mounted setter today -- if this flips, the assertion below must flip too", () => {
    expect(setterIsMounted).toBe(false);
  });

  it("DOES NOT RESTORE A PERSISTED WINDOW while nothing can change it", async () => {
    // Behavioural, not a source grep: seed the exact key a real visitor would already
    // have in localStorage from before the control was removed, then hydrate.
    const store: Record<string, string> = {
      "tn.timewindow.v1": JSON.stringify({ v: 1, d: "1h" }),
    };
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = "window" in g;
    g.window = {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
      },
    };
    try {
      const { timeWindowStore, windowMsFor } = await import("@/lib/shell/timeWindow");
      timeWindowStore.hydrate();
      if (setterIsMounted) {
        expect(timeWindowStore.get()).toBe("1h"); // a setter exists: honouring it is correct
      } else {
        // No setter: the saved "1h" must NOT come back, or this visitor is stranded.
        expect(timeWindowStore.get()).toBe("all");
        expect(windowMsFor(timeWindowStore.get())).toBeNull(); // null = never filters
      }
      // Either way the saved value is left on disk, so restoring the control restores
      // the user's choice rather than silently discarding it.
      expect(store["tn.timewindow.v1"]).toBeTruthy();
    } finally {
      if (!hadWindow) delete g.window;
    }
  });

  it("still filters correctly if the feature is ever remounted", () => {
    // The store and its pure predicate are intact, not half-deleted -- so bringing the
    // control back is a re-mount, not a rebuild.
    const now = Date.parse("2026-09-05T12:00:00Z");
    const oneHour = 60 * 60 * 1000;
    expect(withinWindow("2026-09-05T11:30:00Z", oneHour, now)).toBe(true);
    expect(withinWindow("2026-09-05T09:00:00Z", oneHour, now)).toBe(false);
    expect(withinWindow(null, oneHour, now)).toBe(true); // never hide undated data
    expect(withinWindow("2026-09-05T09:00:00Z", null, now)).toBe(true); // "all" never filters
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
