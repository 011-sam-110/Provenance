import { expect, test, type Page } from "@playwright/test";

// The console never calls a still "live".
//
// Until 2026-10-27 a camera was `live` when its stream URL passed the /api/hls allowlist,
// and the HUD's "Live" block counted `camerasOnline`: every camera whose feed answered,
// about 19,000 refreshing stills among them. Now `live` means the stream played at its
// last check, with a warm-up after a start (lib/liveness/playcheck.ts). This spec drives
// /app and reads the three places the console labels cameras: a camera's own panel, the
// HUD's Live block and the top bar's stat line.
//
// Run it with PLAYCHECK=off on the server (`PLAYCHECK=off npm run e2e -- live-label`) so
// no check can turn the chosen camera live between the two reads. With the check on it
// still holds, and it skips if the chosen camera started playing in that gap.

interface Row {
  id: string;
  source: string;
  live: boolean;
  available: boolean;
}

/**
 * The page's own /api/cameras answer: what the map, the HUD and the stat line count.
 *
 * Taken through a route, not `response.json()`: the body is about 7 MB, and Chromium
 * evicts it from the inspector cache before the test can read it (seen 2026-10-27). The
 * route fetches it, keeps the text, and hands the page the same bytes.
 */
async function pageCameras(page: Page, url: string): Promise<Row[]> {
  let resolve!: (rows: Row[]) => void;
  const got = new Promise<Row[]>((r) => (resolve = r));
  await page.route("**/api/cameras", async (route) => {
    const response = await route.fetch({ timeout: 150_000 });
    const body = await response.text();
    resolve((JSON.parse(body) as { cameras: Row[] }).cameras);
    await route.fulfill({ response, body });
  });
  await page.goto(url);
  return got;
}

test("a still camera's panel, the HUD and the stat line call no still live", async ({ page, request }) => {
  test.setTimeout(300_000);

  // A cold registry asks every feed; warm it so the page's own fetch is not the slow one.
  const warm = await request.get("/api/cameras", { timeout: 200_000 });
  expect(warm.ok()).toBeTruthy();
  const before = (await warm.json()).cameras as Row[];
  // The case M1 exists for: an allowlisted Caltrans stream that failed its check. Before
  // M1 this camera was "Live" with "● Streaming". There is none while the warm-up runs
  // (and none with PLAYCHECK=off), so then any still will do.
  const still =
    before.find((c) => c.source === "caltrans" && !c.live && c.available) ??
    before.find((c) => !c.live && c.available);
  expect(still, "the registry offered no still camera").toBeTruthy();

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tn.hud.v1",
      JSON.stringify({ v: 1, d: { enabled: true, variant: "full", animate: false, opacity: 100 } }),
    );
  });
  const rows = await pageCameras(
    page,
    `/app?layers=livecams,staticcams&obj=${encodeURIComponent(still!.id)}`,
  );
  const row = rows.find((c) => c.id === still!.id);
  test.skip(!row || row.live, "the chosen camera started playing between the two reads");

  // 1. The camera's own panel: "Available", a picture, and no "Live" or "Streaming".
  const panel = page.locator(".cam-detail");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator(".cam-status")).toHaveText("Available");
  await expect(panel).not.toContainText("Streaming");
  await expect(panel.locator("video")).toHaveCount(0);

  // 2. The HUD's Live block: its camera cell is video that played, and nothing else.
  const video = rows.filter((c) => c.live).length;
  const stills = rows.length - video;
  const counts = page.locator('[data-tn-hud-block="counts"]');
  await expect(counts).toBeVisible();
  await expect(counts.locator('[data-tn-flap="VID"]')).toContainText(`VID: ${video.toLocaleString("en-US")}`);
  await expect(counts.locator('[data-tn-flap="CAM"]')).toHaveCount(0);
  const online = rows.filter((c) => c.available).length;
  const hud = (await counts.textContent()) ?? "";
  expect(hud).not.toContain(online.toLocaleString("en-US"));
  expect(hud).not.toContain(stills.toLocaleString("en-US"));

  // 3. The stat line: video counted as video, stills as stills, "live" beside no count.
  const stat = page.getByTestId("stat-line");
  await expect(stat).toContainText(`${video.toLocaleString("en-US")} video cams`);
  await expect(stat).toContainText("still cams");
  expect((await stat.textContent()) ?? "").not.toMatch(/\d[\d,]*\s+live/i);
});
