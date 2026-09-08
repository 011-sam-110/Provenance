import { test, expect, type Page } from "@playwright/test";
import { basemapWarmup, DEFAULT_BASEMAP } from "@/lib/basemaps";

// The Inspector, end to end, under the ADDITIVE model: every area is live at once,
// World draws everywhere, and an area's own sources are cropped to its ring.
//
// WHAT THIS FILE USED TO ASSERT, AND WHY IT IS INVERTED. The claim was "loading an
// area crops the map": one area was loaded at a time and while it was, it was the
// only thing drawn. Sam's report was that this took every global signal off the globe
// — see lib/shell/inspector.ts. Areas are additive now, so the two claims here are:
//
//   1. SWITCHING CONTEXT DRAWS NOTHING DIFFERENT. Pointing the rail at an area is
//      choosing a pen. This is the regression test for the reported bug, and it is
//      an equality on the feature count either side of the switch.
//   2. A SOURCE ON ONLY INSIDE AN AREA IS CROPPED TO THAT RING. Also an equality —
//      exactly the features inside it, not merely fewer than before.
//
// WHY THE PRECONDITIONS ARE HALF THIS FILE. Both claims have a failure mode that
// looks exactly like a pass. If the basemap never loads the map draws nothing, and
// "nothing drawn" is indistinguishable from "perfectly cropped"; if the signal layer
// is broken, 0 == 0 sails through claim 1. A run using the repo's
// playwright.preview.config.ts hits the first: its context-level extraHTTPHeaders
// CORS-preflights tiles.openfreemap.org, which answers 405 to any OPTIONS, and the
// basemap dies silently. Reach a protected preview with a _vercel_share COOKIE
// instead — see PREVIEW_SHARE_URL below.
//
// So this file asserts, before it asserts anything else:
//
//   1. at least one 200 from the tile host — the basemap is really up;
//   2. the world count is greater than zero — there is something to crop;
//   3. the count inside the ring is greater than zero AND less than the world count —
//      or "cropped correctly" and "dropped everything" land on the same number.

// The western Pacific, as [lon, lat] — the polygon order lib/shell/scope.ts uses.
//
// A SEISMICALLY ACTIVE box on purpose. Cropping to a quiet area (Kharkiv was the first
// draft) proves only that the count fell, because "kept the right features" and
// "dropped everything" both land on 0.
const RING: [number, number][] = [
  [90, -60],
  [180, -60],
  [180, 70],
  [90, 70],
];
const BBOX: [number, number, number, number] = [90, -60, 180, 70];

const SIGNAL = "earthquakes"; // global, keyless, and reliably non-empty
const AREA_LABEL = "West Pacific";

// The host the active basemap's imagery actually comes from, DERIVED rather than
// typed. It was hardcoded to `tiles.openfreemap.org` while DEFAULT_BASEMAP was
// `streets`; the default is now `satellite` (Esri World Imagery), so a literal
// here would wait forever for tiles from a host this page no longer touches —
// and it would do it as a TIMEOUT, which reads like a broken page rather than a
// stale constant.
//
// `basemapWarmup` returns every origin the default basemap fetches from. The
// first is the tile host for both kinds of entry: a vector style's own origin,
// or a raster style's tile template.
const TILE_HOST = new URL(basemapWarmup(DEFAULT_BASEMAP).preconnect[0]).host;

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
    ({ ring, box, signal, label }) => {
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
            editing: null,
            areas: [
              {
                id: "area:1",
                label,
                polygon: ring,
                bbox: box,
                createdAt: 1,
                sources: { [signal]: true },
              },
            ],
          },
        }),
      );
    },
    { ring: RING, box: BBOX, signal: SIGNAL, label: AREA_LABEL },
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

/** How many of the drawn features fall inside the ring. The ring is a rectangle, so
 *  point-in-polygon and the bbox test are the same predicate here. */
function drawnInsideRing(page: Page): Promise<number> {
  return page.evaluate(([w, s, e, n]) => {
    const map = (window as unknown as { __map?: unknown }).__map as {
      getSource: (id: string) => { serialize?: () => { data?: { features?: unknown[] } } } | undefined;
    };
    const features = (map.getSource("signals")?.serialize?.().data?.features ?? []) as {
      geometry?: { type?: string; coordinates?: [number, number] };
    }[];
    let k = 0;
    for (const f of features) {
      if (f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      if (lon >= w && lon <= e && lat >= s && lat <= n) k++;
    }
    return k;
  }, BBOX);
}

/**
 * Point the Sources rail at a context through the switcher.
 *
 * "above the tabs" is what this used to say; the rail's tab strip is gone and the
 * switcher is the first control in it now.
 *
 * `:not(.tn-ctxbar-draw)` because that menu also carries a "Draw an area" ACTION
 * sharing the row class. No context name collides with its text today, so this is
 * a guard against a future one rather than a fix — but a context picker that could
 * silently arm a draw is not a failure anyone would enjoy debugging.
 */
async function switchContext(page: Page, name: string) {
  await page.locator(".tn-ctxbar").click();
  await page.locator(".tn-ctxbar-opt:not(.tn-ctxbar-draw)", { hasText: name }).first().click();
  await expect(page.locator(".tn-ctxbar")).toHaveText(new RegExp(name));
}

test("switching context draws nothing different, and an area's own source is cropped to its ring", async ({
  page,
}) => {
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

  // The switcher names what a toggle would write, and it starts on World.
  await expect(page.locator(".tn-ctxbar")).toHaveText(/World/);

  // The areas block sits in the rail's one scroll, under the search box.
  await expect(page.locator(".tn-insp-row")).toHaveCount(1);
  await expect(page.locator(".tn-insp-label")).toHaveText(AREA_LABEL);
  // The rail is pointed at World, so no row carries the pill.
  await expect(page.locator(".tn-insp-pill", { hasText: "EDITING" })).toHaveCount(0);

  // Switch the signal on for WORLD, through the rail. The row carries its own id, and
  // the switch is .tn-src-toggle — .tn-src-label only opens the provenance popover.
  await page.getByLabel("Search sources").fill("earthquake");
  const row = page.locator(`[data-source-row="${SIGNAL}"]`);
  await expect(row).toHaveCount(1);
  if ((await row.getAttribute("data-on")) !== "true") await row.locator(".tn-src-toggle").click();
  await expect(row).toHaveAttribute("data-on", "true");

  // PRECONDITION 2 — World is drawing real features, uncropped.
  await expect
    .poll(() => drawnSignals(page), {
      message: "the signal source never filled under World — nothing to crop",
      timeout: 90_000,
    })
    .toBeGreaterThan(0);
  const worldCount = await drawnSignals(page);

  // PRECONDITION 3 — the ring is neither empty nor the whole world.
  const insideCount = await drawnInsideRing(page);
  expect(insideCount).toBeGreaterThan(0);
  expect(insideCount).toBeLessThan(worldCount);

  // ── CLAIM 1: switching context is invisible on the map ────────────────────
  //
  // The regression test for the reported bug. Under the old exclusive model this
  // number collapsed to the ring's contents the moment an area was selected, taking
  // every global signal off the globe. It must not move at all.
  await switchContext(page, AREA_LABEL);
  await expect(page.locator(".tn-insp-pill", { hasText: "EDITING" })).toHaveCount(1);
  // The area's own row now ticks from the AREA's set, which has the signal on.
  await expect(row).toHaveAttribute("data-on", "true");
  expect(await drawnSignals(page)).toBe(worldCount);

  // ── CLAIM 2: with World off, only the area's ring survives ────────────────
  //
  // An equality rather than "fewer than before", which would also pass on a build
  // that simply drops everything.
  await switchContext(page, "World");
  await row.locator(".tn-src-toggle").click();
  await expect(row).toHaveAttribute("data-on", "false");

  await expect
    .poll(() => drawnSignals(page), {
      message:
        `the map draws neither ${worldCount} (uncropped) nor ${insideCount} ` +
        "(the features inside the ring) after switching World's copy off",
      timeout: 30_000,
    })
    .toBe(insideCount);

  // ...and every one of them really is inside the ring, rather than a coincidental
  // count of the wrong features.
  expect(await drawnInsideRing(page)).toBe(insideCount);
});
