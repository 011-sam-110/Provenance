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

  await page.goto("/");
  // Pre-set the "tour seen" flag — the first-run overlay is modal and would
  // intercept every click below. Same shape lib/shell/tour.ts persists.
  await page.evaluate(() =>
    // `d`, not `data` — that is the key PersistEnvelope actually writes, so the
    // old spelling parsed to undefined and this seed never suppressed anything.
    // The .tn-tour-skip click below was covering for it.
    localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } })),
  );

  await page.goto("/?lat=22&lon=128&z=5&base=light");
  await page.waitForTimeout(6000);
  await page.locator(".tn-tour-skip").click({ timeout: 3000 }).catch(() => {});

  // Turn the cables layer on from the Sources rail.
  await page.locator("button.tn-rail-fab").click();
  await page.locator("input.tn-cat-search").fill("submarine");
  const row = page.locator(".tn-layer-row", { hasText: "Submarine cables" });
  await row.locator(".tn-toggle").click();
  await expect(row.locator(".tn-layer-count")).toHaveText(/\d{3}/, { timeout: 150_000 });
  await page.locator(".tn-rail-collapse").click();
  await page.waitForTimeout(1500);

  // Sweep the pointer until a cable names itself.
  let found: { x: number; y: number; label: string } | null = null;
  for (let y = 300; y <= 560 && !found; y += 6) {
    for (let x = 700; x <= 1060 && !found; x += 6) {
      await page.mouse.move(x, y);
      const tip = page.locator(".tn-linetip");
      if (await tip.count()) found = { x, y, label: (await tip.innerText()).trim() };
    }
  }
  expect(found, "no cable was hoverable anywhere across the north Pacific").not.toBeNull();
  expect(found!.label.length, "the hovered cable has no name to show").toBeGreaterThan(0);

  // Still named with the pointer held still — the state a user actually sees.
  await expect(page.locator(".tn-linetip")).toHaveText(found!.label);

  // The click must open the cable the hover promised, not a different one.
  await page.mouse.click(found!.x, found!.y);
  const dossier = page.locator(".tn-dossier");
  await expect(dossier).toBeVisible({ timeout: 5000 });
  expect(await dossier.getAttribute("aria-label")).toBe(found!.label);
  await expect(dossier).toContainText("Submarine cables");
});
