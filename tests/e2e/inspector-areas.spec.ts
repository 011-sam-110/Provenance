import { test, expect, type Page } from "@playwright/test";

// The Inspector, end to end: the tab renders a saved area, and LOADING one actually
// crops the map.
//
// WHY THE PRECONDITIONS ARE HALF THIS FILE. The central claim — "loading an area
// crops the map" — has a failure mode that looks exactly like a pass. If the basemap
// never loads, the map draws nothing, and "nothing drawn" is indistinguishable from
// "perfectly cropped". A run using the repo's playwright.preview.config.ts hits that:
// its context-level extraHTTPHeaders CORS-preflights tiles.openfreemap.org, which
// answers 405 to any OPTIONS, and the basemap dies silently. Reach a protected
// preview with a _vercel_share COOKIE instead — see PREVIEW_SHARE_URL below.
//
// So this file asserts, before it asserts anything else:
//
//   1. at least one 200 from the tile host — the basemap is really up;
//   2. the world count is greater than zero — there is something to crop.
//
// Without (2) the test passes on a build where the signal layer is simply broken:
// 0 features cropped to 0 features would sail through a naive "fewer after loading"
// check if the world count were never asserted.

// Kharkiv, as [lon, lat] — the polygon order lib/shell/scope.ts uses.
const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

const SIGNAL = "earthquakes"; // global, keyless, and reliably non-empty

// lib/basemaps.ts: DEFAULT_BASEMAP is "streets", whose style is
// tiles.openfreemap.org/styles/liberty. Measured against a preview: 200s arrive from
// this host and none from basemaps.cartocdn.com, which only serves the dark variant.
const TILE_HOST = "tiles.openfreemap.org";

// Reaching a protection-enabled preview WITHOUT setting a request header, because a
// header is what CORS-preflights the tile host and silently kills the basemap.
// PREVIEW_SHARE_URL is a _vercel_share link; visiting it once sets the auth cookie
// for the rest of the run. Unset (a local run, or an unprotected deployment) this is
// a no-op.
const SHARE_URL = process.env.PREVIEW_SHARE_URL;

test.beforeEach(async ({ page }) => {
  if (SHARE_URL) await page.goto(SHARE_URL, { waitUntil: "domcontentloaded" });
});

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
      // Only the AREAS are seeded. World's set belongs to the variant spine, not to
      // this store — see inspectorStore.hydrate — and seeding tn.variant.v1 to switch
      // the signal on was measured NOT to take. The test toggles it through the rail
      // instead, which is the path a user actually takes.
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
    if (r.url().includes(TILE_HOST)) tileStatuses.push(r.status());
  });

  await boot(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  // PRECONDITION 1 — the basemap is genuinely up, so "nothing drawn" cannot be
  // mistaken for "cropped".
  await expect
    .poll(() => tileStatuses.filter((s) => s === 200).length, {
      message: `no 200 from ${TILE_HOST} — the basemap never loaded, so no claim ` +
        "about what the map draws can be trusted",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".tn-rail")).toBeVisible();

  // The context bar is rendered in BOTH tabs and names what a toggle would write.
  await expect(page.locator(".tn-ctxbar")).toHaveText(/World/);

  // Switch the signal on for WORLD, through the rail. The row carries its own id, and
  // the switch is .tn-src-toggle — .tn-src-label only opens the provenance popover.
  await page.getByRole("tab", { name: "Sources" }).click();
  await page.getByLabel("Search sources").fill("earthquake");
  const row = page.locator(`[data-source-row="${SIGNAL}"]`);
  await expect(row).toHaveCount(1);
  if ((await row.getAttribute("data-on")) !== "true") await row.locator(".tn-src-toggle").click();
  await expect(row).toHaveAttribute("data-on", "true");

  // PRECONDITION 2 — the world context is drawing real features.
  await expect
    .poll(() => drawnSignals(page), {
      message: "the signal source never filled under World — nothing to crop",
      timeout: 90_000,
    })
    .toBeGreaterThan(0);
  const worldCount = await drawnSignals(page);

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
  await expect(page.locator(".tn-ctxbar")).toHaveText(/Kharkiv/);

  // THE CLAIM. Kharkiv holds a small fraction of the world's earthquakes, so the
  // drawn count must fall. Strictly fewer, not merely different.
  await expect
    .poll(() => drawnSignals(page), {
      message: `the map still draws ${worldCount} features after loading an area — it did not crop`,
      timeout: 30_000,
    })
    .toBeLessThan(worldCount);
});
