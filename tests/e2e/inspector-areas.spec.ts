import { test, expect, type Page } from "@playwright/test";

// The Inspector, end to end: the tab renders a saved area, and LOADING one actually
// crops the map.
//
// WHY THE PRECONDITIONS ARE HALF THIS FILE. The central claim — "loading an area
// crops the map" — has a failure mode that looks exactly like a pass. If the basemap
// never loads, the map draws nothing, and "nothing drawn" is indistinguishable in a
// screenshot from "perfectly cropped". A run using the repo's
// playwright.preview.config.ts hits that: its context-level extraHTTPHeaders
// CORS-preflights tiles.openfreemap.org, which answers 405 to any OPTIONS, and the
// basemap dies silently. So this file asserts, before it asserts anything else:
//
//   1. at least one 200 from the tile host — the basemap is really up;
//   2. the world count is greater than zero — there is something to crop.
//
// Without (2) the test passes on a build where the signal layer is simply broken,
// which is the vacuous-assertion trap: 0 < 0 is false, but 0 features cropped to 0
// features would sail through a naive "fewer after loading" check if the world count
// were never checked.

// Kharkiv, as [lon, lat] — the polygon order lib/shell/scope.ts uses.
const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

const SIGNAL = "earthquakes"; // global, keyless, and reliably non-empty

async function boot(page: Page) {
  await page.addInitScript(
    ({ ring, signal }) => {
      // The launch sequence is a position:fixed inset:0 layer; without this stamp a
      // click lands on the plate instead of the control under it. Copied from
      // map-rail.spec.ts for the reason stated there.
      window.localStorage.setItem(
        "tn.terminal.boot.v1",
        JSON.stringify({ v: 1, d: { seenVersion: 1 } }),
      );
      // World's source set belongs to the VARIANT spine, not to this store — see
      // inspectorStore.hydrate. So the signal is switched on the way a user's own
      // toggle persists: as a captured override under tn.variant.v1. Seeding it in
      // tn.inspector.v1 would be silently discarded on boot, which is what the
      // first run of this spec discovered.
      window.localStorage.setItem(
        "tn.variant.v1",
        JSON.stringify({
          v: 1,
          d: {
            activeId: "explore",
            userVariants: [],
            overrides: { explore: { signals: { [signal]: true } } },
            layoutOverrides: {},
          },
        }),
      );
      window.localStorage.setItem(
        "tn.inspector.v1",
        JSON.stringify({
          v: 1,
          d: {
            world: {},
            loaded: null,
            areas: [
              {
                id: "area:1",
                label: "Kharkiv",
                polygon: ring,
                bbox: [36.0, 49.8, 36.5, 50.2],
                createdAt: 1,
                sources: { [signal]: true },
              },
            ],
          },
        }),
      );
    },
    { ring: RING, signal: SIGNAL },
  );
}

/** Features currently in the aggregated signal source — what the map is really drawing. */
function drawnSignals(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: unknown }).__map as
      | { getSource: (id: string) => { serialize?: () => { data?: { features?: unknown[] } } } | undefined }
      | undefined;
    const data = map?.getSource("signals")?.serialize?.().data;
    return Array.isArray(data?.features) ? data.features.length : -1;
  });
}

test("the Inspector lists a saved area, and loading it crops the map", async ({ page }) => {
  const tileStatuses: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("tiles.openfreemap.org")) tileStatuses.push(r.status());
  });

  await boot(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  // PRECONDITION 1 — the basemap is genuinely up, so "nothing drawn" cannot be
  // mistaken for "cropped".
  await expect
    .poll(() => tileStatuses.filter((s) => s === 200).length, {
      message: "no 200 from tiles.openfreemap.org — the basemap never loaded, so no " +
        "claim about what the map draws can be trusted",
      timeout: 45_000,
    })
    .toBeGreaterThan(0);

  // PRECONDITION 2 — the world context is drawing real features.
  await expect
    .poll(() => drawnSignals(page), {
      message: "the signal source never filled under World — nothing to crop",
      timeout: 45_000,
    })
    .toBeGreaterThan(0);
  const worldCount = await drawnSignals(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".tn-rail")).toBeVisible();

  // The context bar is rendered in BOTH tabs and names what a toggle would write.
  await expect(page.locator(".tn-ctxbar")).toBeVisible();

  await page.getByRole("tab", { name: "Inspector" }).click();
  await expect(page.locator(".tn-insp-row")).toHaveCount(1);
  await expect(page.locator(".tn-insp-label")).toHaveText("Kharkiv");
  // Nothing is loaded yet, so no row carries the pill.
  await expect(page.locator(".tn-insp-pill", { hasText: "LOADED" })).toHaveCount(0);

  // Open the dossier from the index row, and load from there.
  await page.locator(".tn-insp-row").click();
  await expect(page.getByRole("button", { name: "Load this area" })).toBeVisible();
  await page.getByRole("button", { name: "Load this area" }).click();

  await expect(page.locator(".tn-insp-pill", { hasText: "LOADED" })).toHaveCount(1);

  // THE CLAIM. Kharkiv holds a small fraction of the world's earthquakes, so the
  // drawn count must fall. Strictly fewer, not merely different.
  await expect
    .poll(() => drawnSignals(page), {
      message: `the map still draws ${worldCount} features after loading an area — it did not crop`,
      timeout: 30_000,
    })
    .toBeLessThan(worldCount);
});
