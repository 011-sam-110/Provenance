"use client";
// Don't poll a tab nobody is looking at.
//
// We run a lot of concurrent pollers — 35 signal layers, planes at 12s, cameras,
// markets, news, the event fan-out — and every one of them used to keep firing in
// a background tab. On a laptop with the console left open in a spare tab that is
// pure heat and battery, and on the upstreams it is quota we spend on nobody.
//
// The rule: while the document is hidden, skip the tick. On becoming visible,
// refresh IMMEDIATELY rather than waiting out the remainder of the interval, so
// coming back to the tab shows current data rather than whatever was on screen
// when you left. Combined with the honest freshness chip this reads correctly:
// the chip ages while you are away, then snaps back to live on return, which is
// exactly what happened.
//
// SSR-safe: `document` is absent on the server, where nothing is hidden.

export function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Run `cb` whenever the document becomes visible. Returns an unsubscribe.
 * Dormant-safe on the server, where it is a no-op.
 */
export function onVisible(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") cb();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

/**
 * Should a poller that last succeeded at `lastOk` refresh now that the tab is
 * visible again? Pure, so the "don't stampede every layer on every tab focus"
 * rule is testable.
 *
 * Refresh when we have never succeeded, or when the data is already older than
 * its own cadence. Flicking between two tabs must NOT re-fetch 35 layers each
 * time — hence the cadence check rather than an unconditional reload.
 */
export function shouldRefreshOnVisible(lastOk: number | null, refreshMs: number, now: number): boolean {
  if (lastOk == null) return true;
  return now - lastOk >= Math.max(1_000, refreshMs);
}
