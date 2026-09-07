import { beforeEach, describe, expect, it } from "vitest";
import {
  clearVideoFatal,
  markVideoFatal,
  resetVideoFatal,
  videoRecentlyFatal,
} from "@/lib/cameras/videoFatal";
import { RETRY_AFTER_MS } from "@/lib/console/widgets/camslot.health";

// The component that uses this cannot be unit tested here — vitest runs in the
// node environment and no React testing library is installed — which is exactly
// why the decision lives in its own module. `now` is a parameter rather than a
// clock read, so none of this needs fake timers.

const ID = "caltrans:d11-543";

describe("the video fatal memo", () => {
  beforeEach(() => { resetVideoFatal(); });

  it("does not skip a stream that has never failed", () => {
    expect(videoRecentlyFatal(ID, 1_000)).toBe(false);
  });

  it("skips the handshake for a stream that just failed fatally", () => {
    markVideoFatal(ID, 1_000);
    expect(videoRecentlyFatal(ID, 1_000)).toBe(true);
  });

  it("keeps skipping right up to the retry window, and stops exactly at it", () => {
    markVideoFatal(ID, 1_000);
    expect(videoRecentlyFatal(ID, 1_000 + RETRY_AFTER_MS - 1)).toBe(true);
    // At the boundary the stream becomes eligible again. A memo with no expiry
    // is the invisible false negative: one bad handshake and the camera never
    // plays video again for the life of the tab, with nothing saying why.
    expect(videoRecentlyFatal(ID, 1_000 + RETRY_AFTER_MS)).toBe(false);
  });

  it("forgets the entry as it expires, so a long session does not accumulate dead ids", () => {
    markVideoFatal(ID, 1_000);
    // Reading past the window is what evicts it; asking again at a time INSIDE
    // the original window must still say false, which it only can if the entry
    // was actually deleted rather than merely reported stale.
    expect(videoRecentlyFatal(ID, 1_000 + RETRY_AFTER_MS)).toBe(false);
    expect(videoRecentlyFatal(ID, 1_500)).toBe(false);
  });

  it("forgets a stream the moment frames arrive, without waiting out the window", () => {
    markVideoFatal(ID, 1_000);
    expect(videoRecentlyFatal(ID, 1_100)).toBe(true);
    clearVideoFatal(ID);
    expect(videoRecentlyFatal(ID, 1_100)).toBe(false);
  });

  it("tracks streams independently, so one dead camera does not mute its neighbours", () => {
    markVideoFatal(ID, 1_000);
    expect(videoRecentlyFatal("scdot:77", 1_000)).toBe(false);
  });
});
