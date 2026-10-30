import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The "Track vehicles" switch on a live camera's video, end to end: the real page,
// the real worker, the real model, on a fixed clip so the result does not depend on
// the time of day in California.
//
// The clip is 12 s of Caltrans CCTV 178 (I-110 north of Exposition Blvd, Los Angeles),
// recorded through /api/hls on 2026-10-29 at 17:41 PDT and re-cut as HLS
// (tests/fixtures/vehicle-tracking/README.md). The test answers every
// /api/hls?id= request with it, so whichever live camera the registry offers plays
// this clip.
//
// GOOGLE CHROME, NOT PLAYWRIGHT'S CHROMIUM: the bundled Chromium has no H.264
// decoder, and every live camera Provenance plays is H.264.

test.use({ channel: "chrome", viewport: { width: 1280, height: 900 } });

const FIXTURE = join(__dirname, "..", "fixtures", "vehicle-tracking");
const SHOTS = join(__dirname, "..", "..", "test-results", "vehicle-tracking");

async function serveFixtureStream(page: Page) {
  const playlist = readFileSync(join(FIXTURE, "index.m3u8"), "utf8").replace(/^(seg\d+\.mpegts)$/gm, "/__vt-fixture/$1");
  await page.route(/\/api\/hls\?id=/, (route) =>
    route.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: playlist }),
  );
  await page.route(/\/__vt-fixture\/seg\d+\.mpegts$/, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    return route.fulfill({ status: 200, contentType: "video/mp2t", body: readFileSync(join(FIXTURE, name)) });
  });
}

test("Track vehicles outlines and follows the cars on a live camera", async ({ page, request }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  const { cameras } = await (await request.get("/api/cameras")).json();
  const live = (cameras as { id: string; live?: boolean }[]).find((c) => c.live);
  test.skip(!live, "the registry offers no live camera right now");

  // A cold server answers 404 for a camera page until its registry snapshot has loaded
  // (seen on the first run against a fresh dev server), so wait for the page itself.
  const path = `/camera/${encodeURIComponent(live!.id)}`;
  await expect.poll(async () => (await request.get(path)).status(), { timeout: 60_000 }).toBe(200);

  await serveFixtureStream(page);
  await page.goto(path);

  const video = page.locator(".tn-cam-frame video");
  await expect(video).toBeVisible();
  // Loop the 12 s clip so the test never runs out of traffic.
  await video.evaluate((v: HTMLVideoElement) => {
    v.loop = true;
    void v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30_000 }).toBeGreaterThan(0.5);

  const overlay = page.getByTestId("vehicle-tracking");
  await expect(overlay).toHaveAttribute("data-phase", "off");
  await page.getByRole("button", { name: "Track vehicles" }).click();

  // The model and runtime download once, then the detector reports its backend.
  await expect(overlay).toHaveAttribute("data-phase", "on", { timeout: 90_000 });
  const backend = await overlay.getAttribute("data-backend");
  expect(["webgpu", "wasm"]).toContain(backend);

  // A busy freeway: several vehicles must be outlined at once, and the tracker must
  // have given out several IDs.
  await expect.poll(async () => Number(await overlay.getAttribute("data-in-view")), { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(async () => Number(await overlay.getAttribute("data-seen")), { timeout: 60_000 }).toBeGreaterThanOrEqual(6);

  await expect(overlay.getByText(/vehicles? in view/)).toBeVisible();
  await expect(overlay.getByText(/tracked since you switched it on/)).toBeVisible();
  await expect(overlay.getByText(/Nothing is sent or stored/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop tracking" })).toHaveAttribute("aria-pressed", "true");

  // The outlines are on the canvas: some of its pixels must be painted.
  const painted = await page.locator(".tn-cam-frame canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(500);

  await page.locator(".tn-cam-frame").screenshot({ path: join(SHOTS, `tracking-on-${backend}.png`) });

  await page.getByRole("button", { name: "Stop tracking" }).click();
  await expect(overlay).toHaveAttribute("data-phase", "off");
  await expect(overlay.getByText(/vehicles? in view/)).toHaveCount(0);
});
