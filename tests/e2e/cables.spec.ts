import { test, expect } from "@playwright/test";

// Submarine cables draw as ~1px routes. Clicking one used to be a coin-flip —
// a probe of 676 clicks across the busiest cable region on Earth opened a cable
// 23% of the time, and in a quiet ocean you would simply never hit one. The
// layer's dossier (owners, ready-for-service date, length, every landing point)
// was therefore unreachable, which made the layer read as decoration.
//
// The fix is a transparent wide hit layer plus a hover highlight. What has to
// stay true, and is what this test pins:
//   • hovering near a route names it — you know WHICH of ~700 crossing lines
//     you are about to open, before you commit to the click;
//   • clicking that same spot opens THAT cable — the highlight cannot point at
//     one cable while the click opens another.
//
// Real mouse, not dispatched MouseEvents: MapLibre clears hover state on the
// next frame when the OS pointer is elsewhere, so synthetic events cannot
// observe this at all.
test("hovering a submarine cable names it, and clicking there opens that cable", async ({ page }) => {
  // The cables adapter enriches ~700 routes from a keyless upstream on first load.
  test.setTimeout(240_000);

  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await page.goto("/app");
  await page.waitForFunction(
    () => (window as unknown as { __map?: { isStyleLoaded(): boolean } }).__map?.isStyleLoaded(),
    undefined,
    { timeout: 60_000 },
  );

  // Turn the cables layer on from the Sources panel.
  await page.locator('nav[data-rail="console"] [data-rail-entry="sources"]').click();
  await page.getByLabel("Search sources").fill("submarine");
  const row = page.locator('[data-source-row="cables"]');
  const read = page.waitForResponse((r) => r.url().includes("/api/signals/cables") && r.ok(), { timeout: 150_000 });
  await row.locator(".tn-src-toggle").click();
  await expect(row).toHaveAttribute("data-on", "true");
  await read;
  await page.getByRole("button", { name: "Close sources" }).click();

  // The north Pacific, where the routes are thick enough to find by sweeping.
  await page.evaluate(() => {
    (window as unknown as { __map: { jumpTo(o: unknown): void } }).__map.jumpTo({ center: [128, 22], zoom: 5 });
  });
  await page.waitForTimeout(2500);

  // Sweep the pointer until a cable names itself.
  let found: { x: number; y: number; label: string } | null = null;
  for (let y = 300; y <= 560 && !found; y += 6) {
    for (let x = 700; x <= 1060 && !found; x += 6) {
      await page.mouse.move(x, y);
      // The element is always there, and hidden until a cable is under the pointer.
      const tip = page.locator(".tn-linetip:not([hidden])");
      if (await tip.count()) found = { x, y, label: (await tip.innerText()).trim() };
    }
  }
  expect(found, "no cable was hoverable anywhere across the north Pacific").not.toBeNull();
  expect(found!.label.length, "the hovered cable has no name to show").toBeGreaterThan(0);

  // Still named with the pointer held still — the state a user actually sees.
  await expect(page.locator(".tn-linetip")).toHaveText(found!.label);

  // The click must open the cable the hover promised, not a different one.
  await page.mouse.click(found!.x, found!.y);
  const dossier = page.locator(".tn-inspector[role=dialog]");
  await expect(dossier).toBeVisible({ timeout: 5000 });
  expect(await dossier.getAttribute("aria-label")).toBe(found!.label);
  await expect(dossier).toContainText("Submarine cables");
});
