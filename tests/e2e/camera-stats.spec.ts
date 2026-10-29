import { expect, test, type Locator, type Page } from "@playwright/test";

// The camera stats strip in the console's top bar (components/terminal/CameraStats.tsx).
//
// At 1440 px and at 390 px: the strip shows its counts, opens its breakdown and closes
// again, never says "live", and every number in it names its source on keyboard focus.
// Operator names are the operators' own and are shown as written (one of them is "Live
// Traffic NSW"), so the operator list is read without its name column.
//
// Run against a production build (`npm run build && npm run start`). The first request
// asks every camera feed, so the spec warms /api/camera-stats before it opens the page.
// It writes one desktop and one phone screenshot to test-results/camera-stats/.

const SHOTS = "test-results/camera-stats";
const LIVE = /\blive\b/i;

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  const res = await request.get("/api/camera-stats", { timeout: 200_000 });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  for (const part of ["road", "refresh", "play", "webcams", "operators"]) {
    expect(typeof body[part].source, part).toBe("string");
    expect(body[part], part).toHaveProperty("at");
  }
  expect(body.road.total).toBeGreaterThan(0);
});

/** The text a reader sees, without the operators' own names. */
async function textWithoutOperatorNames(root: Locator): Promise<string> {
  return root.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".op-n").forEach((n) => n.remove());
    return copy.textContent ?? "";
  });
}

/** Focus each number that has a source and read its tooltip. */
async function everyNumberHasASource(page: Page, root: Locator): Promise<number> {
  const tip = page.locator("#cs-tip");
  const numbers = root.locator("[data-tip]");
  const n = await numbers.count();
  for (let i = 0; i < n; i++) {
    const num = numbers.nth(i);
    if (!(await num.isVisible())) continue;
    await num.focus();
    await expect(tip, `number ${i}: ${await num.textContent()}`).toBeVisible();
    await expect(tip).toContainText("Source:");
    expect((await tip.textContent()) ?? "").not.toMatch(LIVE);
    await expect(num).toHaveAttribute("aria-describedby", "cs-tip");
  }
  return n;
}

test("desktop: the strip, its breakdown and the operator list", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");

  const strip = page.getByTestId("camera-stats");
  await expect(strip).toBeVisible({ timeout: 60_000 });
  await expect(strip).toHaveAttribute("aria-label", /^Road and public operator cameras: [\d,]+ video, [\d,]+ stills/, {
    timeout: 120_000,
  });
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  for (const label of ["Video", "Stills", "Countries", "Operators", "Counted", "Webcams"]) {
    await expect(strip.locator(".cs-desk .cs-lab", { hasText: label })).toBeVisible();
  }
  expect((await strip.textContent()) ?? "").not.toMatch(LIVE);
  expect((await strip.getAttribute("aria-label")) ?? "").not.toMatch(LIVE);

  // WEBCAMS takes the one hairline every other number has: a single ::before, no ::after.
  const web = strip.locator('[data-k="webcams"]');
  expect(await web.evaluate((el) => getComputedStyle(el, "::after").content)).toBe("none");
  expect(await web.evaluate((el) => getComputedStyle(el, "::before").width)).toBe("1px");

  // Hover: each segment says what it counts and where it comes from.
  const tip = page.locator("#cs-tip");
  for (const k of ["video", "stills", "countries", "operators", "counted", "webcams"]) {
    await strip.locator(`[data-k="${k}"]`).hover();
    await expect(tip, k).toBeVisible();
    await expect(tip).toContainText("Source:");
    expect((await tip.textContent()) ?? "").not.toMatch(LIVE);
  }

  // Keyboard focus on the strip: the sources of all its numbers.
  await page.mouse.move(5, 600);
  await strip.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(strip).toBeFocused();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Source:");
  await expect(tip).toContainText("Webcams:");

  // Open: the breakdown is a dialog under the strip, its title takes focus.
  await page.keyboard.press("Enter");
  const panel = page.locator("#cs-panel");
  await expect(panel).toBeVisible();
  await expect(strip).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel.locator("#cs-panel-title")).toBeFocused();
  await expect(panel.locator(".cs-box tbody tr")).toHaveCount(6);
  await expect(panel).toContainText(/First check running|played at the last check|No results yet/);
  await expect(panel).not.toContainText("Picture age");
  expect(await textWithoutOperatorNames(panel)).not.toMatch(LIVE);
  expect(await everyNumberHasASource(page, panel)).toBeGreaterThan(8);

  await page.mouse.move(5, 600);
  await panel.locator("#cs-panel-title").focus();
  await page.screenshot({ path: `${SHOTS}/desktop-1440.jpg`, type: "jpeg", quality: 82 });

  // The operator list, with licences: six first, then all of them.
  await panel.getByRole("button", { name: "Per-operator coverage" }).click();
  const ops = panel.locator("#cs-ops");
  await expect(ops).toBeVisible();
  await expect(ops).toContainText("Licence stated");
  await expect(ops).toContainText("No licence stated");
  const rows = ops.locator(".op");
  const shown = await rows.count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(6);
  const more = ops.locator(".cl-more");
  if (await more.count()) {
    const all = Number(((await more.textContent()) ?? "").match(/\d+/)?.[0]);
    await more.click();
    await expect(rows).toHaveCount(all);
  }
  expect(await textWithoutOperatorNames(ops)).not.toMatch(LIVE);
  await everyNumberHasASource(page, ops);

  // Escape closes it and gives focus back to the strip.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  await expect(strip).toBeFocused();
});

test("phone: two numbers in the boards row, a bottom sheet", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  const strip = page.getByTestId("camera-stats");
  await expect(strip).toBeVisible({ timeout: 60_000 });
  await expect(strip).toHaveAttribute("aria-label", /^Road and public operator cameras/, { timeout: 120_000 });
  const line = strip.locator(".cs-pline");
  await expect(line).toBeVisible();
  // The icons replace the words on a phone; the row's spoken name still says both.
  await expect(line.locator('[data-glyph="video"]')).toBeVisible();
  await expect(line.locator('[data-glyph="stills"]')).toBeVisible();
  expect(await page.locator(".tnx-hdr").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expect(strip.locator(".cs-pfresh")).toContainText(/counted/);
  await expect(strip.locator(".cs-desk").first()).toBeHidden();
  expect((await strip.textContent()) ?? "").not.toMatch(LIVE);

  // The strip shares the boards row and is a full touch target.
  const box = await strip.boundingBox();
  const tabs = await page.locator(".tnx-hdr-boards").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(box!.y - tabs!.y)).toBeLessThan(2);

  await strip.click();
  const sheet = page.locator("#cs-panel");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveClass(/cs-sheet/);
  await expect(sheet).toHaveAttribute("role", "dialog");
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(strip).toHaveAttribute("aria-expanded", "true");
  expect(await textWithoutOperatorNames(sheet)).not.toMatch(LIVE);
  expect(await everyNumberHasASource(page, sheet)).toBeGreaterThan(8);

  const close = sheet.getByRole("button", { name: "Close" });
  const closeBox = await close.boundingBox();
  expect(closeBox!.width).toBeGreaterThanOrEqual(44);
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);

  await sheet.locator("#cs-panel-title").focus();
  await sheet.locator(".sh-body").evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/phone-390.jpg`, type: "jpeg", quality: 82 });

  await close.click();
  await expect(sheet).toBeHidden();
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  await expect(strip).toBeFocused();
});

test("narrower desktops drop operators, then webcams, then countries, and cut nothing off", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const strip = page.getByTestId("camera-stats");
  await expect(strip).toHaveAttribute("aria-label", /^Road and public operator cameras/, { timeout: 120_000 });

  const ALL = ["video", "stills", "countries", "operators", "counted", "webcams"];
  const without = (...gone: string[]) => ALL.filter((k) => !gone.includes(k));
  const plan: [number, string[]][] = [
    [1920, ALL],
    [1440, ALL],
    [1420, ALL],
    [1419, without("operators")],
    [1320, without("operators")],
    [1319, without("operators", "webcams")],
    [1240, without("operators", "webcams")],
    [1239, without("operators", "webcams", "countries")],
    [1180, without("operators", "webcams", "countries")],
    [1179, ALL],
    [1100, ALL],
    [1000, ALL],
  ];
  const seen = [];
  for (const [width, shown] of plan) {
    await page.setViewportSize({ width, height: 900 });
    const m = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as HTMLElement;
      const hdr = q(".tnx-hdr");
      const boards = q(".tnx-hdr-boards");
      const right = q(".tnx-hdr-right");
      const s = q('[data-testid="camera-stats"]');
      const shown = Array.from(s.querySelectorAll<HTMLElement>("[data-k]"))
        .filter((e) => getComputedStyle(e).display !== "none")
        .map((e) => e.dataset.k);
      return {
        hdrOver: hdr.scrollWidth - hdr.clientWidth,
        boardsOver: boards.scrollWidth - boards.clientWidth,
        rightEdge: Math.round(right.getBoundingClientRect().right),
        stripLeft: Math.round(s.getBoundingClientRect().left),
        stripWidth: Math.round(s.getBoundingClientRect().width),
        stripTop: Math.round(s.getBoundingClientRect().top),
        brandWidth: Math.round(q(".tnx-hdr-brand").getBoundingClientRect().width),
        boardsWidth: boards.scrollWidth,
        rightWidth: Math.round(right.getBoundingClientRect().width),
        shown,
      };
    });
    seen.push({ width, ...m, want: shown });
  }
  console.log(JSON.stringify(seen));
  for (const r of seen) {
    expect(r.shown, `shown at ${r.width}px`).toEqual(r.want);
    expect(r.boardsOver, `board tabs cut off at ${r.width}px`).toBeLessThanOrEqual(0);
    expect(r.hdrOver, `header overflows at ${r.width}px`).toBeLessThanOrEqual(0);
    expect(r.rightEdge, `right cluster past the edge at ${r.width}px`).toBeLessThanOrEqual(r.width);
    // Below 1180px the strip is a thin row of its own under the bar.
    if (r.width < 1180) expect(r.stripTop, `strip on its own row at ${r.width}px`).toBeGreaterThanOrEqual(30);
    else expect(r.stripTop).toBeLessThan(4);
  }
});
