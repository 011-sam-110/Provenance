/**
 * The CAMERA figures the landing page's opening sentence rests on.
 *
 * WHY THEY ARE COPIED HERE AND NOT IMPORTED. `CAMERA_FEED_COUNT` already exists in
 * `lib/sources/registry.ts` and would never rot if the page imported it. It is not
 * imported on purpose: that module is the barrel that pulls all ~17 adapters, and
 * CLAUDE.md records what happened the last time a component reached into it for one
 * integer — `ConsoleShell.tsx` dragged every adapter into the BROWSER bundle and the
 * `node:http2` import inside one of them broke three production builds. The landing
 * page is a server component so it would not repeat that exactly, but the shape is the
 * same and the cost is real. Three integers do not justify it.
 *
 * SO THEY ARE PINNED INSTEAD. `tests/unit/landing-camera-facts.test.ts` recomputes all
 * three the same way their real owners do — the feed count by importing the registry,
 * the country count by the `country: "XX"` scan `claude-md-counts.test.ts` already uses,
 * the webcam count by reading `public/webcams/manifest.json` — and fails if any has
 * moved. A red there means the page is about to state a number the repo no longer ships;
 * update this file, do not edit the test.
 *
 * Measured 2026-09-12.
 */
export const CAMERA_FACTS = {
  /** Operator feeds in `lib/sources/registry.ts` — 16 hand-written adapters + 1 admitted by discovery. */
  feeds: 17,
  /**
   * Distinct countries the adapters DECLARE, counted from literal `country: "XX"`
   * assignments: BA, BR, CA, EE, FI, GB, IS, NZ, PR, RS, US.
   */
  countries: 11,
  /**
   * Webcams in the committed Windy catalogue (`public/webcams/manifest.json`, 196 static
   * tiles). These are NOT operator feeds and the page must never merge the two totals —
   * the catalogue is a harvested third-party inventory, which is why the sentence counts
   * it separately.
   */
  webcams: 70698,
} as const;
