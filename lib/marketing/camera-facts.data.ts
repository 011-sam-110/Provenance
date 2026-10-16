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
 * Measured 2026-09-12; feeds re-measured 2026-10-16 after the source audit's US and world
 * camera feeds (17 -> 52, see registry.ts).
 */
export const CAMERA_FACTS = {
  /**
   * Operator feeds in `lib/sources/registry.ts` — 51 hand-written adapters (cars.ts
   * registers six, one per CARS state) + 1 admitted by discovery. Six of the 51 are keyed
   * and hold no cameras until their free key is set (`docs/API_KEYS.md` section 8), so the
   * drawn count is lower on a deployment without them.
   */
  feeds: 52,
  /**
   * Distinct countries the adapters DECLARE, counted from literal `country: "XX"`
   * assignments: AU, BA, BR, CA, EE, ES, FI, FR, GB, HK, HU, IS, LT, MK, NO, NZ, PR, RS, SI,
   * TW, US. SI comes only from the keyed DARS/DRSI feed.
   */
  countries: 21,
  /**
   * Webcams in the committed Windy catalogue (`public/webcams/manifest.json`, 196 static
   * tiles). These are NOT operator feeds and the page must never merge the two totals —
   * the catalogue is a harvested third-party inventory, which is why the sentence counts
   * it separately.
   */
  webcams: 70698,
} as const;
