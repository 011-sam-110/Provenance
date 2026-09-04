import { describe, it, expect } from "vitest";
import { encodeViewState, decodeViewState, type ViewState } from "@/lib/share/url";

describe("url signal params", () => {
  it("round-trips sig", () => {
    const qs = encodeViewState({ sig: ["earthquakes", "cyber-c2"] });
    const back = decodeViewState(new URLSearchParams(qs));
    expect(back.sig).toEqual(["earthquakes", "cyber-c2"]);
  });
  it("drops unknown signal ids", () => {
    const back = decodeViewState(new URLSearchParams("sig=earthquakes,not-a-signal"));
    expect(back.sig).toEqual(["earthquakes"]);
  });
});

/**
 * The board is NOT a URL param, and this is the guard that keeps it that way.
 *
 * `?v=` was a deep link until the server had to read it back — `generateMetadata`
 * picking a per-board social card — which opted the whole `/app` route into a
 * per-request render, cached nowhere. Re-adding a `v` here would be harmless on its
 * own; it would become harmful again the moment someone wired it to a card, which is
 * exactly how it happened the first time. See tests/unit/console-static.test.ts for
 * the other half.
 */
describe("the board is not carried in the URL", () => {
  it("never emits v, even when handed one", () => {
    // Deliberately cast: `v` is not on ViewState any more, and the point of the test
    // is that a caller who still believes in it gets nothing.
    const qs = encodeViewState({ v: "intel" } as unknown as ViewState);
    expect(new URLSearchParams(qs).has("v")).toBe(false);
  });
  it("ignores a legacy ?v= on the way in", () => {
    const back = decodeViewState(new URLSearchParams("v=intel&sig=earthquakes"));
    expect("v" in back).toBe(false);
    expect(back.sig).toEqual(["earthquakes"]); // the rest of the link still works
  });
});
