import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { normalizeTflNotices } from "@/lib/roads/tfl";
import { TFL_OPERATOR, roadTitle } from "@/lib/signals/roads";
import { pickCameraRoad, type CameraRoad } from "@/lib/roads/nearCamera";

/**
 * The camera's road (lib/roads/nearCamera.ts) where people look at a camera: its panel in
 * the console and its card in the God's eye view. Each says what the road operator says
 * about the road under the camera, in the operator's words, with how near it is.
 *
 * One camera is placed on the closed stretch of the A243 Hook Road from a verbatim TfL
 * row (tests/fixtures/tfl-road-disruptions-mixed.json), and /api/camera-road is answered
 * through the same pure function the route uses, so the test reads what the page draws.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md.
 */

test.describe.configure({ timeout: 150_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

const NOTICES = normalizeTflNotices(
  JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8")),
);
const HOOK = NOTICES.find((n) => n.id === "TIMS-236919")!;
const [LON, LAT] = HOOK.closedLines[0][0];
const CAM = {
  id: "tfl:JamCams_00001.e2e01",
  source: "tfl",
  name: "A243 Hook Road",
  lat: LAT,
  lon: LON,
  available: true,
  live: false,
  country: "GB",
  refreshSeconds: 300,
  attribution: "Powered by TfL Open Data",
  license: "OGL v2",
};
const ROAD: CameraRoad = pickCameraRoad(
  CAM,
  ["TfL"],
  [{ operator: "TfL", credit: TFL_OPERATOR.credit, notices: NOTICES, readAt: Date.now() - 60_000 }],
  roadTitle,
);

async function answerRoad(page: Page) {
  const asked: string[] = [];
  await page.route(/\/api\/camera-road\?/, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ roads: { [CAM.id]: ROAD } }) });
  });
  return asked;
}

test("the camera's panel says what TfL says about its road, and credits TfL", async ({ page }) => {
  expect(ROAD.state).toBe("notice");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/cameras", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ cameras: [CAM] }) }),
  );
  await page.route(/\/api\/camera\/tfl/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ camera: CAM }) }),
  );
  const asked = await answerRoad(page);
  await page.goto(`/app?layers=livecams,staticcams&lat=${LAT}&lon=${LON}&z=14&obj=${encodeURIComponent(CAM.id)}`);

  const block = page.getByTestId("camera-road");
  await expect(block).toContainText(roadTitle(HOOK), { timeout: 90_000 });
  await expect(block).toHaveAttribute("data-tone", "closed");
  await expect(block).toContainText(`${HOOK.closure} · Minimal · under 10 m from this camera`);
  await expect(block).toContainText("Powered by TfL Open Data");
  // It asked for this camera by its place and id, once.
  expect(asked.length).toBe(1);
  expect(decodeURIComponent(asked[0])).toContain(`,${CAM.id}`);
});

test("the God's eye card carries the same road, in one line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/api\/near\?/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ cameras: [{ ...CAM, km: 0.01 }] }) }),
  );
  await answerRoad(page);
  await page.goto(`/eye?lat=${LAT}&lon=${LON}&z=16&tilt=45&heading=0`);
  await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });

  const line = page.locator('a[href^="/camera/"] p[data-tone]');
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line).toHaveAttribute("data-tone", "closed");
  await expect(line).toContainText(roadTitle(HOOK));
  await expect(line).toContainText("under 10 m");
  await expect(line).toHaveAttribute("title", new RegExp(`${HOOK.closure}`));
});
